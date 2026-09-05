/**
 * AIPanel × DeepSeek Harness 插件
 *
 * 运行在 dsh 宿主进程（Cordis 插件），向 dsh agent 提供 AIPanel 能力：
 *  1. run_diagnostics 审查工具（对标 opencode 质量门禁，手动触发 ESLint + vue-tsc）
 *  2. tools/post-execute：编辑工具（write/edit）执行后自动把诊断并入工具结果（不做回滚）
 *
 * 诊断引擎（ESLint/vue-tsc/格式化/全量诊断）统一由 @aipanel/core/node 提供，
 * 与 opencode 侧质量门禁共用同一实现，保证行为一致。
 *
 * 依赖策略：本插件保持"零运行时 @deepseek-ai 依赖"（全部 type-only import），
 * 只通过宿主注入的 ctx API + 纯数据对象（tool 定义 / 消息体）交互。
 * 因此产物可被 dsh 以 file:// 或 npm 包 + profile 安装两种方式加载，
 * 无需处理 @deepseek-ai/* 的 peer 依赖解析（profile 安装时 autoInstallPeers=false）。
 * @aipanel/core 在构建期被 esbuild bundle 进产物，运行时自包含。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type {
  PostToolDecision,
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
  ToolRuntime,
} from "@deepseek-ai/dsh-tools";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";
import {
  runAllChecks,
  runProjectDiagnostics,
  isJsFile,
  SEVERITY_ERROR,
  CONTEXT_API_PATH,
  createLogger,
  type DiagnosticItem,
  type EslintOutput,
  type TscResult,
} from "@aipanel/core/node";
import type { AIPanelDiagnosticEntry, SelectedElement } from "@aipanel/core";
import type { SettingsProvider } from "@deepseek-ai/dsh-settings";
import { setupEventRelay } from "./events-relay";

export const name = "aipanel";
export const inject = ["tools"];

const log = createLogger("DshPlugin");

/** 来自 provider.start() 生成的 cordis overlay 注入的 config */
export interface AipanelPluginConfig {
  /** 宿主工作目录（用于诊断的默认 cwd） */
  cwd?: string;
  /** 核心层 Vite 端口：用于访问 context 端点反查选中元素（与 MCP 同一地址体系） */
  vitePort?: number;
  /** 核心层 context 端点路径（由 overlay 从 @aipanel/core 的 CONTEXT_API_PATH 常量注入） */
  contextApiPath?: string;
  /** 宿主事件推送令牌（core 每轮启动随机）：与 eventsPath 配对启用 session/event 事件中继 */
  eventsToken?: string;
  /** 宿主事件推送路径（由 overlay 从 @aipanel/core 的 HOST_EVENTS_API_PATH 常量注入） */
  eventsPath?: string;
  /**
   * 编辑后是否自动补跑诊断。
   * 与 opencode 对齐：默认关闭，仅当显式配置为 true 或环境变量
   * OPENCODE_ENABLE_LINT=1 时开启。
   */
  autoDiagnose?: boolean;
  /**
   * 诊断功能总开关（provider option enableDiagnostics，默认开启，对齐 opencode enableLsp）。
   * false 时不注册 run_diagnostics 工具与编辑后自动诊断逻辑。
   * overlay 始终显式注入；缺失配置时按 fail-closed 处理（不注入）。
   */
  enableDiagnostics?: boolean;
  /**
   * 默认 Agent 预设（provider option agentPreset；对应 dsh settings agent-presets.default）。
   * 显式配置时本插件在启动期经 ctx.settings.update 写入，替代 provider 启动后的 RPC settings/mutate。
   */
  agentPreset?: string;
  /** 默认权限预设（provider option permissionPreset；对应 dsh settings permission.defaultPreset） */
  permissionPreset?: "read-only" | "workspace-write" | "danger-full-access";
  /** 繁忙时 Enter 键行为（provider option busyEnter；对应 dsh settings ui-conversation.busyEnter） */
  busyEnter?: "queue" | "steer";
}

const MUTATING_TOOLS = new Set(["write", "edit", "apply_patch"]);


/** 提取文本中的全部节点 id（`@节点[n<id>]` 标记） */
function collectNodeIds(text: string): string[] {
  const ids: string[] = [];
  const re = new RegExp("@节点\\[(n[0-9a-z]+)\\]", "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.push(m[1]);
  return ids;
}

/** 把单个选中元素组织成注入给 agent 的上下文文本块；开头带节点 id 供 agent 与消息标记关联 */
function buildNodeContext(e: SelectedElement): string {
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


/** 单条诊断分区（ESLint / vue-tsc） */
interface DiagnosticsSection {
  title: string;
  text: string;
}

/** run_diagnostics 的结构化 canonical 输出 */
interface DiagnosticsCanonical {
  title: string;
  sections: DiagnosticsSection[];
  diagnostics: AIPanelDiagnosticEntry[];
}

/** 把诊断引擎的结构化诊断项归一化为可展示/持久化条目（LSP 零基坐标 → 1-based） */
function toDiagnosticEntries(items: DiagnosticItem[]): AIPanelDiagnosticEntry[] {
  return items.map((d) => ({
    file: d.file ?? "",
    line: d.range.start.line + 1,
    column: d.range.start.character + 1,
    severity: d.severity === SEVERITY_ERROR ? "error" : "warning",
    message: d.message,
  }));
}

/** 由诊断引擎结果组装 run_diagnostics 的 canonical 值（文本分区 + 结构化诊断） */
function buildDiagnosticsCanonical(
  title: string,
  eslintOutput: EslintOutput,
  tscOutput: TscResult,
): DiagnosticsCanonical {
  return {
    title,
    sections: [
      { title: "ESLint", text: eslintOutput.text || "没有发现问题" },
      { title: "vue-tsc", text: tscOutput.rawOutput.trim() || "没有发现类型错误" },
    ],
    diagnostics: [
      ...toDiagnosticEntries(eslintOutput.diagnostics ?? []),
      ...toDiagnosticEntries(tscOutput.diagnostics ?? []),
    ],
  };
}

/** 从 canonical 值重组模型可见文本（与 formatDiagnosticsSections 分区格式一致） */
function renderDiagnosticsText(value: DiagnosticsCanonical): string {
  const body = value.sections.map((s) => `## ${s.title}\n\n${s.text}`).join("\n\n");
  return body ? `${value.title}\n\n${body}` : value.title;
}

/**
 * 启动期设置应用（agentPreset / permissionPreset / busyEnter）。
 *
 * 替代 provider 启动后的 RPC settings/mutate：宿主插件在 boot 期把 providerOptions
 * 直写 dsh 用户设置。命名空间由 dsh 各功能插件注册（agent-presets / permission /
 * ui-conversation），注册顺序可能晚于本插件 apply —— 这里按“已注册才写”轮询，
 * 超时后放弃（不阻塞启动）；settings 服务或命名空间缺失时仅告警。
 */
export function applyProviderSettings(
  ctx: Context,
  config: AipanelPluginConfig,
): void {
  const pending: { ns: string; patch: Record<string, unknown> }[] = [];
  if (typeof config.agentPreset === "string" && config.agentPreset) {
    pending.push({ ns: "agent-presets", patch: { default: config.agentPreset } });
  }
  if (typeof config.permissionPreset === "string" && config.permissionPreset) {
    pending.push({ ns: "permission", patch: { defaultPreset: config.permissionPreset } });
  }
  if (typeof config.busyEnter === "string" && config.busyEnter) {
    pending.push({ ns: "ui-conversation", patch: { busyEnter: config.busyEnter } });
  }
  if (pending.length === 0) return;

  // 官方 dsh settings 服务（@deepseek-ai/dsh-settings）：describe() 判定命名空间是否已注册，
  // update() 按命名空间写用户设置；命名空间注册顺序可能晚于本插件 apply，见下方轮询。
  const settings = ctx.get("settings") as SettingsProvider | undefined;
  if (!settings) {
    log.warn("settings service unavailable; provider settings not applied via plugin");
    return;
  }
  const registered = (ns: string): boolean =>
    settings.describe()?.some((d) => String(d.ns) === ns) ?? false;

  const APPLY_TIMEOUT_MS = 12000;
  const APPLY_INTERVAL_MS = 300;
  const deadline = Date.now() + APPLY_TIMEOUT_MS;
  let timer: NodeJS.Timeout | null = null;
  const applied = new Set<number>();

  const tick = () => {
    timer = null;
    let stillPending = false;
    for (let i = 0; i < pending.length; i++) {
      if (applied.has(i)) continue;
      const entry = pending[i];
      if (!registered(entry.ns)) {
        stillPending = true;
        continue;
      }
      void settings
        .update(entry.ns, entry.patch)
        .then(() => {
          applied.add(i);
          log.debug("applied provider setting via plugin", { ns: entry.ns });
        })
        .catch((err: unknown) => {
          // 单命名空间写入失败只告警，不阻塞（与 provider RPC 路径的降级一致）
          log.warn("failed to apply provider setting via plugin", {
            ns: entry.ns,
            error: err instanceof Error ? err.message : String(err),
          });
          applied.add(i); // 不反复重试失败的命名空间
        });
    }
    if (!stillPending && applied.size === pending.length) return;
    if (Date.now() < deadline) {
      timer = setTimeout(tick, APPLY_INTERVAL_MS);
      timer.unref?.();
    } else if (stillPending) {
      log.warn("provider settings not fully applied: namespace registration timed out", {
        pending: pending.filter((_, i) => !applied.has(i)).map((p) => p.ns),
      });
    }
  };
  tick();

  ctx.effect(
    () => () => {
      if (timer) clearTimeout(timer);
    },
    "aipanel: settings apply timer",
  );
}

export function apply(ctx: Context, config: AipanelPluginConfig = {}) {
  const cwd = config.cwd ?? process.cwd();
  // 诊断功能总开关：关闭时不注入 run_diagnostics 工具与自动诊断逻辑
  const enableDiagnostics = config.enableDiagnostics ?? false;
  // 与 opencode 对齐：默认关闭自动诊断，OPENCODE_ENABLE_LINT=1（或显式配置）开启
  const autoDiagnose = config.autoDiagnose ?? process.env.OPENCODE_ENABLE_LINT === "1";
  const vitePort = config.vitePort ?? 0;
  const contextApiPath = config.contextApiPath ?? CONTEXT_API_PATH;

  const tools: ToolRuntime = ctx.tools;

  // === 1) 审查工具：手动触发诊断（仅在 enableDiagnostics 开启时注册） ===
  if (enableDiagnostics) {
    // 手写 ToolDefinition（等价于 defineTool 产物），避免运行时依赖 @deepseek-ai/dsh-tools
    const diagnosticsTool: ToolDefinition = {
      name: "run_diagnostics",
      description:
        "运行 ESLint 和 vue-tsc 类型检查，返回诊断结果。\n\n" +
        "**何时使用此工具**：\n" +
        "- 刚完成代码修改，想验证是否有 ESLint 错误或类型错误\n" +
        "- 在提交代码前进行质量检查\n" +
        "- 排查编辑器未显示但实际存在的类型问题\n" +
        "- 不传参数可全量诊断整个项目\n\n" +
        "**诊断内容**：\n" +
        "- ESLint 规则检查（error 和 warning）\n" +
        "- vue-tsc 类型检查（TypeScript 类型错误和警告）",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          filePath: {
            type: "string",
            description: "要诊断的文件路径（绝对路径或相对路径），不传则全量诊断整个项目",
          },
        },
      },
      output: {
        // 结构化 canonical 输出：文本分区（模型可见）+ 诊断数组（持久化供 client 渲染）
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  text: { type: "string" },
                },
                required: ["title", "text"],
              },
            },
            diagnostics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  file: { type: "string" },
                  line: { type: "integer" },
                  column: { type: "integer" },
                  severity: { type: "string", enum: ["error", "warning"] },
                  message: { type: "string" },
                },
                required: ["file", "line", "column", "severity", "message"],
              },
            },
          },
          required: ["title", "sections", "diagnostics"],
        },
        // canonical → 模型可见文本（## ESLint / ## vue-tsc 分区，与 formatDiagnosticsSections 一致）
        render: (_args: unknown, value) => [
          { type: "text", text: renderDiagnosticsText(value as unknown as DiagnosticsCanonical) },
        ],
        // 结构化诊断投影进持久化 meta（tool/result.meta），client 侧 dsh-client 据此渲染诊断卡片
        presentationMeta: (_args: unknown, value) =>
          ({
            diagnostics: (value as unknown as DiagnosticsCanonical).diagnostics,
          }) as unknown as JsonValue,
      },
      async execute(args: unknown) {
        const filePath = (args as { filePath?: unknown } | undefined)?.filePath;
        if (typeof filePath === "string" && filePath) {
          // 单文件诊断（与 opencode 一致：先校验文件存在）
          const resolved = path.resolve(cwd, filePath);
          if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
          const { eslintOutput, tscOutput } = await runAllChecks(resolved, cwd);
          return buildDiagnosticsCanonical(
            `诊断结果: ${path.relative(cwd, resolved)}`,
            eslintOutput,
            tscOutput,
          );
        }
        // 全量诊断（与 opencode 一致：根 tsconfig 优先，否则逐子目录）
        const { eslintOutput, tscOutput } = await runProjectDiagnostics(cwd);
        return buildDiagnosticsCanonical("全量诊断结果", eslintOutput, tscOutput);
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
        // PTC 子调度（run_code 程序内调 edit/write）：程序拿到的是 canonical value，
        // 看不到 content 通道的追加文本，自动检查结果对程序与模型都不可见——
        // 不白跑检查，程序需要诊断时主动调用 run_diagnostics 获取结构化结果。
        if (exec.parent !== undefined) return decision;
        if (!MUTATING_TOOLS.has(exec.name)) return decision;
        if (result.isError) return decision;
        if (decision.kind !== "accept") return decision;

        // exec.arguments 是 unknown，写工具自行校验；这里只取用到的字段。
        // 注意：dsh 官方写工具的参数字段是 snake_case `file_path`（write/edit），
        // 兼容 camelCase `filePath`（自定义工具 / 未来变体）。
        const rawArgs = exec.arguments as { file_path?: unknown; filePath?: unknown } | undefined;
        const filePath =
          typeof rawArgs?.file_path === "string" ? rawArgs.file_path : rawArgs?.filePath;
        if (typeof filePath !== "string" || !filePath) return decision;
        if (!isJsFile(filePath)) return decision;

        const { eslintOutput, tscOutput } = await runAllChecks(
          path.resolve(cwd, filePath),
          cwd,
        ).catch((): { eslintOutput: EslintOutput; tscOutput: TscResult } => ({
          eslintOutput: {},
          tscOutput: { rawOutput: "", exitCode: 0 },
        }));

        // 与 opencode tool.execute.after 相同的诊断拼装；空结果不改动工具输出
        const parts: string[] = [];
        if (tscOutput.rawOutput.trim()) parts.push("## vue-tsc\n\n" + tscOutput.rawOutput.trim());
        if (eslintOutput.text) parts.push("## ESLint\n\n" + eslintOutput.text);
        const diagText = parts.join("\n\n");
        if (!diagText) return decision;

        // 诊断并入编辑工具的结果 content（对齐 opencode tool.execute.after 的
        // `output.output += diagText` 行为）：不新增 user 消息，UI 展示为工具结果卡片的一部分，
        // 模型在同一个 tool/result 里看到诊断，会话流不被额外消息污染。
        // 注意：post-execute 默认决策是 { kind: "accept" }（无 content），decision.content 可能为
        // undefined，必须基于工具原始结果 result.content 追加，否则会覆盖 write/edit 的渲染内容。
        const existing = (decision.kind === "accept" && decision.content) || result.content;
        return {
          kind: "accept" as const,
          content: [...existing, { type: "text", text: `\n\n${diagText}` }],
        };
      },
    );
  } // 诊断功能（run_diagnostics + 自动诊断）注册结束

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
        let elements: SelectedElement[] = [];
        try {
          const res = await fetch(contextBase, { signal });
          if (res.ok) {
            const pc = (await res.json()) as { selectedElements?: SelectedElement[] };
            elements = pc.selectedElements ?? [];
          }
        } catch {
          /* ignore */
        }
        const byId = new Map<string, SelectedElement>();
        for (const el of elements) {
          if (el.id) byId.set(el.id, el);
        }
        const injected = [...ids]
          .map((id) => byId.get(id))
          .filter((el): el is SelectedElement => el !== undefined);
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

  // === 4) 宿主 → core 事件中继（running / thinking 指示恢复；无令牌/无端口时为空操作） ===
  setupEventRelay(ctx, {
    vitePort,
    eventsPath: config.eventsPath,
    eventsToken: config.eventsToken,
  });

  // === 5) 启动期设置应用（agentPreset / permissionPreset / busyEnter；替代 provider 侧 RPC） ===
  applyProviderSettings(ctx, config);
}