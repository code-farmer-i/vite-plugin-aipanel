/**
 * AIPanel × DeepSeek Harness 插件
 *
 * 运行在 dsh 宿主进程（Cordis 插件），向 dsh agent 提供 AIPanel 能力：
 *  1. run_diagnostics 审查工具（对标 opencode 质量门禁，手动触发 ESLint + tsc）
 *  2. tools/post-execute：编辑工具（write/edit）执行后自动追加诊断回报（不做回滚）
 *
 * 依赖策略：本插件保持"零运行时 @deepseek-ai 依赖"（全部 type-only import），
 * 只通过宿主注入的 ctx API + 纯数据对象（tool 定义 / 消息体）交互。
 * 因此产物可被 dsh 以 file:// 或 npm 包 + profile 安装两种方式加载，
 * 无需处理 @deepseek-ai/* 的 peer 依赖解析（profile 安装时 autoInstallPeers=false）。
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type {
  PostToolDecision,
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
  ToolRuntime,
  ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import type { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import type { UserMessage } from "@deepseek-ai/dsh-llm";

export const name = "aipanel";
export const inject = ["tools", "subprocess"];

/** 来自 provider.start() 生成的 cordis overlay 注入的 config */
export interface AipanelPluginConfig {
  /** 宿主工作目录（用于诊断的默认 cwd） */
  cwd?: string;
  /** 核心层 Vite 端口：用于访问 context 端点反查选中元素（与 MCP 同一地址体系） */
  vitePort?: number;
  /** 核心层 context 端点路径（由 overlay 从 @aipanel/core 的 CONTEXT_API_PATH 常量注入） */
  contextApiPath?: string;
  /** 编辑后是否自动补跑诊断 */
  autoDiagnose?: boolean;
}

/** 常见被诊断的源码扩展名 */
const JS_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
]);
const MUTATING_TOOLS = new Set(["write", "edit", "apply_patch"]);

/** 核心层 context 端点路径的兜底默认值（与 @aipanel/core 的 CONTEXT_API_PATH 保持一致；优先取 config 注入值） */
const DEFAULT_CONTEXT_API_PATH = "/__aipanel_context__";

/** 核心层 context 端点返回的选中元素（字段与 @aipanel/core SelectedElement 对应） */
interface ContextElement {
  /** 节点唯一 id（`@节点[n<id>]` 引用标记与上下文注入共用） */
  id?: string;
  filePath?: string | null;
  line?: number | null;
  column?: number | null;
  innerText?: string;
  description?: string;
  previewPageUrl?: string;
  previewPageTitle?: string;
}

/** 提取文本中的全部节点 id（`@节点[n<id>]` 标记） */
function collectNodeIds(text: string): string[] {
  const ids: string[] = [];
  const re = new RegExp("@节点\\[(n[0-9a-z]+)\\]", "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.push(m[1]);
  return ids;
}

/** 把单个选中元素组织成注入给 agent 的上下文文本块；开头带节点 id 供 agent 与消息标记关联 */
function buildNodeContext(e: ContextElement): string {
  const lines: string[] = [`节点 ID：${e.id ?? ""}`];
  if (e.filePath) lines.push(`源码文件路径：${e.filePath}${e.line ? `:${e.line}` : ""}`);
  if (e.line) lines.push(`代码所在行号：${e.line}`);
  if (e.column) lines.push(`代码所在列号：${e.column}`);
  if (e.description) lines.push(`DOM 元素选择器：${e.description}`);
  if (e.innerText) lines.push(`DOM 元素内部文本：${e.innerText.slice(0, 200)}`);
  if (e.previewPageUrl) lines.push(`用户选中节点时的页面 URL：${e.previewPageUrl}`);
  if (e.previewPageTitle) lines.push(`页面标题：${e.previewPageTitle}`);
  return lines.join("\n");
}

/** 诊断子进程的输出上限与宽限时间（避免大仓库输出撑爆上下文） */
const STDOUT_MAX_BYTES = 200_000;
const STDOUT_SPILL_MAX_BYTES = 2_000_000;
const STDERR_MAX_BYTES = 100_000;
const GRACE_MS = 30_000;

export function apply(ctx: Context, config: AipanelPluginConfig = {}) {
  const cwd = config.cwd ?? process.cwd();
  const autoDiagnose = config.autoDiagnose ?? true;
  const vitePort = config.vitePort ?? 0;
  const contextApiPath = config.contextApiPath ?? DEFAULT_CONTEXT_API_PATH;

  const tools: ToolRuntime = ctx.tools;
  const subprocess: SubprocessRuntime = ctx.subprocess;

  /** 以 npx 执行命令并收集 stdout；失败时返回错误信息（由调用方决定如何回报） */
  async function collectOutput(
    argv: string[],
    signal: AbortSignal,
  ): Promise<{ text: string; error?: string }> {
    try {
      const exe = await subprocess.resolveExecutable("npx", undefined, signal);
      const proc = subprocess.spawn({
        argv: [exe, ...argv],
        cwd,
        stdio: {
          stdin: "ignore",
          stdout: { maxBytes: STDOUT_MAX_BYTES, spill: { maxBytes: STDOUT_SPILL_MAX_BYTES } },
          stderr: { maxBytes: STDERR_MAX_BYTES },
        },
        graceMs: GRACE_MS,
        signal,
      });
      await proc.done;
      return { text: proc.collected.stdout?.readFrom(0)?.text ?? "" };
    } catch (e) {
      return { text: "", error: String(e) };
    }
  }

  /** 在目标目录运行 tsc/eslint，汇总诊断文本（collect 模式，带输出上限） */
  async function runDiagnostics(filePath: string, signal: AbortSignal): Promise<string> {
    const parts: string[] = [];

    // tsc：失败时注明跳过原因，便于排查宿主侧 npx 环境问题
    const tsc = await collectOutput(["tsc", "--noEmit", "--pretty", "false"], signal);
    if (tsc.error) parts.push("## tsc\n\n(diagnostics skipped: " + tsc.error + ")");
    else if (tsc.text.trim()) parts.push("## tsc\n\n" + tsc.text.trim());

    // eslint：未配置时静默忽略
    const eslint = await collectOutput(["eslint", filePath, "--format", "compact"], signal);
    if (eslint.text.trim()) parts.push("## eslint\n\n" + eslint.text.trim());

    return parts.join("\n\n");
  }

  // === 1) 审查工具：手动触发诊断 ===
  // 手写 ToolDefinition（等价于 defineTool 产物），避免运行时依赖 @deepseek-ai/dsh-tools
  const diagnosticsTool: ToolDefinition = {
    name: "run_diagnostics",
    description:
      "Run ESLint and TypeScript type checks on filePath and report problems. " +
      "Use after editing code to verify no lint/type errors before proceeding.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        filePath: {
          type: "string",
          description: "Absolute or cwd-relative file path to diagnose",
        },
      },
      required: ["filePath"],
    },
    output: {
      schema: { type: "string" },
      render: (_args: unknown, value: string) => [{ type: "text", text: value }],
    },
    async execute(args: unknown, exec: ToolRunContext) {
      const filePath = (args as { filePath?: unknown } | undefined)?.filePath;
      const target = typeof filePath === "string" ? path.resolve(cwd, filePath) : cwd;
      return runDiagnostics(target, exec.signal).catch((e) => "diagnostics failed: " + String(e));
    },
  };
  tools.register(diagnosticsTool);

  // === 2) 编辑后自动诊断（不做回滚） ===
  ctx.on(
    "tools/post-execute",
    async (
      exec: ToolExecution,
      result: Readonly<ToolExecutionResult>,
      next: () => Promise<PostToolDecision>,
    ) => {
      const decision = await next();
      if (!autoDiagnose) return decision;
      if (!MUTATING_TOOLS.has(exec.name)) return decision;
      if (result.isError) return decision;
      if (decision.kind !== "accept") return decision;

      // exec.arguments 是 unknown，写工具自行校验；这里只取用到的字段
      const filePath = (exec.arguments as { filePath?: unknown } | undefined)?.filePath;
      if (typeof filePath !== "string" || !filePath) return decision;
      if (!JS_EXTENSIONS.has(path.extname(filePath))) return decision;

      const diag = await runDiagnostics(path.resolve(cwd, filePath), exec.signal).catch(
        () => "diagnostics unavailable",
      );
      // 手写 createUserMessage 等价对象（role/content/source/id），避免运行时依赖 @deepseek-ai/dsh-llm
      const message = {
        role: "user" as const,
        id: randomUUID(),
        content: [
          {
            type: "text" as const,
            text: `Auto diagnostics after ${exec.name} (${filePath}):\n${diag}`,
          },
        ],
        source: { kind: "plugin" as const, plugin: name },
      } as UserMessage;
      return { kind: "accept", additionalContexts: [message] };
    },
  );

  // === 3) 选中元素上下文注入（按用户消息中的 @节点[id] 标记精确反查） ===
  // 用户在 AIPanel 页面选中元素后，client 侧把元素（带节点 id）写入核心层 context 端点，
  // dsh-client 把引用序列化为 `@节点[n<id>]` 标记铺进会话文本。这里在 agent/pre-step
  // 解析本次 step 用户消息中的标记，从核心层 context 端点按 id 反查对应元素，
  // 只注入用户实际引用的节点上下文（plugin source），并移除已注入 id 防止后续 step 重复。
  // 注入姿势与官方 session-reference 一致：改写 decision.messages，在引用后追加上下文消息。
  if (vitePort > 0) {
    const contextBase = `http://127.0.0.1:${vitePort}${contextApiPath}`;

    ctx.on(
      "agent/pre-step",
      async ({ signal }, next) => {
        const decision = await next();
        if (decision.kind === "reject") return decision;

        // 收集本次 step 用户消息中的节点 id（只处理 user source）
        const ids = new Set<string>();
        for (const message of decision.messages) {
          if (message.source.kind !== "user") continue;
          for (const block of message.content) {
            if (block.type !== "text") continue;
            for (const id of collectNodeIds(block.text)) ids.add(id);
          }
        }
        if (ids.size === 0) return decision;

        // 从核心层 context 端点拉取选中元素，按 id 反查（端点不可达时不注入，不阻塞会话）
        let elements: ContextElement[] = [];
        try {
          const res = await fetch(contextBase, { signal });
          if (res.ok) {
            const pc = (await res.json()) as { selectedElements?: ContextElement[] };
            elements = pc.selectedElements ?? [];
          }
        } catch {
          /* ignore */
        }
        const byId = new Map<string, ContextElement>();
        for (const el of elements) {
          if (el.id) byId.set(el.id, el);
        }
        const injected = [...ids]
          .map((id) => byId.get(id))
          .filter((el): el is ContextElement => el !== undefined);
        if (injected.length === 0) return decision;

        // 保留消息中的 `@节点[id]` 标记：durable user/message 以 decision.messages 持久化
        // （agent-loop 在 pre-step 后逐条 append），移除会导致用户气泡空白；标记 + 注入的
        // 上下文（含节点 ID）足以让模型理解引用指向哪个节点。

        const contextText = injected.map(buildNodeContext).join("\n\n---\n\n");
        const contextMessage = {
          role: "user" as const,
          id: randomUUID(),
          content: [
            {
              type: "text" as const,
              text: `以下是用户引用节点的完整上下文（节点 ID 与消息中的 @节点[id] 标记对应）：\n\n${contextText}`,
            },
          ],
          source: { kind: "plugin" as const, plugin: name },
        } as UserMessage;

        // 注入后清空端点 selectedElements：消息已消费这批节点上下文，防止残留/重复注入。
        try {
          await fetch(contextBase, { method: "DELETE", signal });
        } catch {
          /* ignore */
        }

        return { ...decision, messages: [...decision.messages, contextMessage] };
      },
      { prepend: true },
    );
  }
}
