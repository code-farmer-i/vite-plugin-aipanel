/**
 * AIPanel × DeepSeek Harness 插件
 *
 * 运行在 dsh 宿主进程（Cordis 插件），向 dsh agent 提供 AIPanel 能力：
 *  1. run_diagnostics 审查工具（对标 opencode 质量门禁，手动触发 ESLint + 类型检查）
 *  2. 编辑后自动诊断（不做回滚）：tools/post-execute 只按 agent 登记本步编辑过的源文件，
 *     不在这里检查、也不改工具结果；agent/pre-step 在本步送模型前统一诊断一次，插入一条
 *     本插件的上下文消息（kind: aipanel，form: notice）。不做"与上次相同就不发"的去重——那会让"仍未修复"
 *     与"已修好"同样表现为静默；改为每个 step 都投递有界摘要（每分区发现条数上限），
 *     完整结果仍由手动 run_diagnostics 给出。原生编辑与 PTC（run_code）子调度共用同一路径，
 *     无需按 rootCallId 分叉
 *
 * 诊断引擎（ESLint/类型检查/格式化/全量诊断）统一由 @aipanel/core/node 提供，
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
import type { ContextFormed, MessageId, MessageSourceMap, UserMessage } from "@deepseek-ai/dsh-llm";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";
import {
  DEFAULT_DIAGNOSTICS_POLICY,
  collectDiagnostics,
  SEVERITY_ERROR,
  CONTEXT_API_PATH,
  createLogger,
  DIAGNOSTICS_TOOL_DESCRIPTION,
  renderDiagnostics,
  resolveDiagnosticsPolicy,
  runDiagnostics,
  type DiagnosticItem,
  type DiagnosticsPolicy,
  type DiagnosticsResult,
  type DiagnosticsTarget,
} from "@aipanel/core/node";
import type { AIPanelDiagnosticEntry, SelectedElement } from "@aipanel/core";
import { MUTATING_TOOLS, parseNodeMentions } from "@aipanel/core";
import type { SettingsForms } from "@deepseek-ai/dsh-settings";
import { setupEventRelay } from "./events-relay";

/**
 * 本插件在 dsh 会话格式 v4 中的消息归属声明。
 *
 * v4 起废弃了共用的 `plugin` 包装：`MessageSource.kind` 必须由生产者自己声明
 * （见 dsh-llm `MessageSourceMap` 文档），落到日志里的 `kind: "plugin"` 会在
 * 写入/读取时被 v4 准入拒绝（format v4 message requires a producer-owned source kind）。
 */
declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    aipanel: { kind: "aipanel" } & ContextFormed;
  }
}

/** 生产者自有的消息来源 kind（与 cordis 插件名同源，二者共同标识本插件） */
const SOURCE_KIND = "aipanel";

export const name = SOURCE_KIND;
export const inject = ["tools"];

const log = createLogger("DshPlugin");

/** 来自 provider.start() 生成的 cordis overlay 注入的 config */
export interface AipanelPluginConfig {
  /** 宿主工作目录（用于诊断的默认 cwd） */
  cwd?: string;
  /** 核心层 Vite 端口：用于访问 context 端点反查选中元素（与 MCP 同一地址体系） */
  vitePort?: number;
  /** 核心层 Vite 绑定 host（单一来源，overlay 注入）：随 vitePort 一起用于回连 vite 端点 */
  viteHost?: string;
  /** 核心层 context 端点路径（由 overlay 从 @aipanel/core 的 CONTEXT_API_PATH 常量注入） */
  contextApiPath?: string;
  /** 宿主事件推送令牌（core 每轮启动随机）：与 eventsPath 配对启用 session/event 事件中继 */
  eventsToken?: string;
  /** 宿主事件推送路径（由 overlay 从 @aipanel/core 的 HOST_EVENTS_API_PATH 常量注入） */
  eventsPath?: string;
  /**
   * 诊断配置（检查来源 + 触发 + 投递；契约见 @aipanel/core 的 DiagnosticsPolicy）。
   * provider 侧已归一化成完整策略；这里再兜一层（直接加载插件、无 overlay 时也安全）。
   */
  diagnostics?: Partial<DiagnosticsPolicy>;
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

/** 把单个选中元素组织成注入给 agent 的上下文文本块；开头带节点 id 供 agent 与消息标记关联 */
function buildNodeContext(e: SelectedElement): string {
  const lines: string[] = [`节点 ID：${e.id ?? ""}`];
  // 行列直接跟在文件路径后（形如 index.vue:53:11），不单独成行
  const loc = e.line ? (e.column ? `:${e.line}:${e.column}` : `:${e.line}`) : "";
  if (e.filePath) lines.push(`源码文件路径：${e.filePath}${loc}`);
  if (e.description) lines.push(`DOM 元素选择器：${e.description}`);
  if (e.innerText) {
    // 先截断再转义换行：真实 \n 转义成字面量 "\\n"，让模型把它当作单个逻辑文本值，
    // 与上下文里用于分行的结构换行区分开；顺序不可反，避免截断残缺的转义序列。
    const text = e.innerText.slice(0, 20).replace(/\r?\n/g, "\\n");
    lines.push(`DOM 元素内部文本：${text}`);
  }
  if (e.previewPageUrl) lines.push(`用户选中节点时的页面 URL：${e.previewPageUrl}`);
  return lines.join("\n");
}

/** 本插件可用的官方 `notice` 上下文形式：要求携带一行 summary */
type NoticeContext = Extract<ContextFormed, { form: "notice" }>;

/** 构造归属本插件的用户上下文消息（节点上下文与编辑后诊断共用；notice 元数据可选） */
function buildPluginMessage(text: string, notice?: NoticeContext): UserMessage {
  // kind 取自上面声明的 MessageSourceMap，形状随官方 ContextFormed 变化；
  // MessageId 是编译期品牌，本插件零运行时 @deepseek-ai 依赖，故按同形断言而非调官方构造函数。
  const source: MessageSourceMap[typeof SOURCE_KIND] = notice
    ? { kind: SOURCE_KIND, form: "notice", summary: notice.summary }
    : { kind: SOURCE_KIND };
  return {
    role: "user",
    id: randomUUID() as MessageId,
    content: [{ type: "text", text }],
    source,
  };
}

/** 每个 agent 本步编辑过的源文件：post-execute 登记，pre-step 收尾诊断后清空 */
type PendingEdits = WeakMap<Agent, Set<string>>;

/** 取写类工具的目标文件（dsh 官方写工具是 snake_case `file_path`，兼容 camelCase） */
function editTarget(exec: ToolExecution): string | undefined {
  const rawArgs = exec.arguments as { file_path?: unknown; filePath?: unknown } | undefined;
  const filePath = typeof rawArgs?.file_path === "string" ? rawArgs.file_path : rawArgs?.filePath;
  return typeof filePath === "string" && filePath ? filePath : undefined;
}

/**
 * 登记一次成功的写类编辑（原生调用与 PTC 子调度共用）：
 * 只记录 agent 本步编辑过的文件——**不在这里按扩展名过滤**，跑哪些检查由各 check 的
 * extensions 决定（这样 .css → stylelint、.ts → ESLint 之类可以按文件类型分流）。
 * 失败结果与非 accept 决策跳过。
 */
function registerPendingEdit(
  pending: PendingEdits,
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  decision: PostToolDecision,
  cwd: string,
): void {
  if (!MUTATING_TOOLS.has(exec.name)) return;
  if (result.isError) return;
  if (decision.kind !== "accept") return;
  const filePath = editTarget(exec);
  if (!filePath) return;
  const { agent } = exec;
  if (!agent) return;
  let files = pending.get(agent);
  if (!files) {
    files = new Set();
    pending.set(agent, files);
  }
  files.add(path.resolve(cwd, filePath));
}

/** 超出上限即截断并说明（完整结果仍可用 run_diagnostics 获取） */
function truncateDiagnostics(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n…（诊断输出过长，已截断；可调用 run_diagnostics 查看完整结果）`;
}

/**
 * 收尾诊断：对本步登记的文件跑一次配置的检查，渲染成一条有界摘要文本
 * （分区与 `### 文件` 结构由 renderDiagnostics 统一给出）。
 * 不做内容去重：只要文件仍有发现就每个 step 都投递，避免"仍未修复"与"已修好"都表现为静默；
 * 重复成本由 maxFindingsPerSection 折叠成有界摘要，完整结果交给手动 run_diagnostics。
 * 返回空串表示本步没有需要投递的发现。
 */
async function collectPendingDiagnostics(
  pending: Set<string>,
  cwd: string,
  policy: DiagnosticsPolicy,
): Promise<string> {
  const files = [...pending];
  // 一次批量检查：类型检查按 tsconfig 项目合并为一次 --build，避免 N 个文件各跑一遍项目构建
  const result = await runDiagnostics({ kind: "edited", files, cwd }, policy, "edit").catch(
    (): DiagnosticsResult => ({ sections: [] }),
  );
  const text = renderDiagnostics(result, {
    onlyFindings: true,
    maxFindingsPerSection: policy.maxFindingsPerSection,
  });
  return text
    ? truncateDiagnostics(`自动诊断（编辑后）：\n\n${text}`, policy.maxMessageChars)
    : "";
}

/** 单条诊断分区（ESLint / 类型检查） */
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

/** 由诊断结果组装 run_diagnostics 的 canonical 值（文本分区 + 结构化诊断） */
function buildDiagnosticsCanonical(title: string, result: DiagnosticsResult): DiagnosticsCanonical {
  return {
    title,
    sections: result.sections.map((section) => ({
      title: section.target ? `${section.target} · ${section.name}` : section.name,
      text: section.text ?? "没有发现问题",
    })),
    diagnostics: toDiagnosticEntries(collectDiagnostics(result)),
  };
}

/** 从 canonical 值重组模型可见文本（分区格式与 renderDiagnostics 一致） */
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
export function applyProviderSettings(ctx: Context, config: AipanelPluginConfig): void {
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

  // 官方 dsh settings 服务（@deepseek-ai/dsh-settings）：service 类型经官方 Context 增强注入，
  // describe() 判定命名空间是否已注册，update() 按命名空间写用户设置；命名空间注册顺序可能晚于
  // 本插件 apply，见下方轮询。
  const settings: SettingsForms | undefined = ctx.get("settings");
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
  // 诊断策略：provider 已归一化，这里再兜一层（直接加载插件、无 overlay 时也安全）
  const policy = resolveDiagnosticsPolicy([DEFAULT_DIAGNOSTICS_POLICY, config.diagnostics], (message) =>
    log.warn(message),
  );
  const vitePort = config.vitePort ?? 0;
  // viteHost 单一来源（overlay 注入的 config.viteHost），不做 127.0.0.1 向下兼容；
  // 缺失时由事件中继明确报错停用，避免静默把事件推到错误地址。
  const viteHost = config.viteHost;
  const contextApiPath = config.contextApiPath ?? CONTEXT_API_PATH;

  const tools: ToolRuntime = ctx.tools;

  // === 1) 审查工具：手动触发诊断（仅在策略开启工具时注册） ===
  if (policy.exposeTool) {
    // 手写 ToolDefinition（等价于 defineTool 产物），避免运行时依赖 @deepseek-ai/dsh-tools
    const diagnosticsTool: ToolDefinition = {
      name: "run_diagnostics",
      description: DIAGNOSTICS_TOOL_DESCRIPTION,
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
        // canonical → 模型可见文本（分区标题由配置的检查给出，与 renderDiagnostics 一致）
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
        let target: DiagnosticsTarget;
        let title: string;
        if (typeof filePath === "string" && filePath) {
          // 单文件诊断（与 opencode 一致：先校验文件存在）
          const resolved = path.resolve(cwd, filePath);
          if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
          target = { kind: "file", file: resolved, cwd };
          title = `诊断结果: ${path.relative(cwd, resolved)}`;
        } else {
          // 全量诊断（与 opencode 一致：根 tsconfig 优先，否则逐子目录）
          target = { kind: "project", cwd };
          title = "全量诊断结果";
        }
        return buildDiagnosticsCanonical(title, await runDiagnostics(target, policy, "manual"));
      },
    };
    tools.register(diagnosticsTool);
  } // 审查工具注册结束

  // === 2) 编辑后自动诊断（只登记，不改工具结果；step 边界统一收尾） ===
  // 与工具暴露与否相互独立：只装自动诊断、不给模型工具，或反之，都由策略决定。
  if (policy.auto) {
    // 每个 agent 本步编辑过的源文件：post-execute 登记，pre-step 送模型前诊断后清空
    const pendingEdits: PendingEdits = new WeakMap();

    ctx.on(
      "tools/post-execute",
      async (
        exec: ToolExecution,
        result: Readonly<ToolExecutionResult>,
        next: () => Promise<PostToolDecision>,
      ) => {
        const decision = await next();
        // 原生调用与 PTC 子调度同一条路径：只登记目标文件，检查推迟到 step 边界。
        // 一次程序/一步里的多次编辑因此不再各自触发昂贵的 tsc --build，也不再各发一条消息。
        registerPendingEdit(pendingEdits, exec, result, decision, cwd);
        return decision;
      },
    );

    // step 边界收尾：对本步编辑过的文件统一诊断一次，插入一条本插件上下文消息（kind: aipanel，form: notice）。
    // 发现未变也照样投递（摘要形态），因此"有通知 = 仍有问题、无通知 = 已干净"；消息随本 step
    // 的决策持久化给模型，原生编辑与 PTC 子调度走同一路径，不再需要按 rootCallId 分叉的聚合逻辑。
    ctx.on(
      "agent/pre-step",
      async ({ agent }, next) => {
        const decision = await next();
        const files = pendingEdits.get(agent);
        if (!files || files.size === 0) return decision;
        pendingEdits.delete(agent);
        // step 被否决：本次登记随 turn 终止丢弃，避免遗留到下一个 turn
        if (decision.kind === "reject") return decision;
        const text = await collectPendingDiagnostics(files, cwd, policy);
        if (!text) return decision;
        return {
          ...decision,
          messages: [
            ...decision.messages,
            buildPluginMessage(text, {
              form: "notice",
              summary: `编辑后自动诊断：${files.size} 个文件`,
            }),
          ],
        };
      },
      { prepend: true },
    );
  } // 编辑后自动诊断注册结束

  // === 3) 选中元素上下文注入（按用户消息中的 @节点[id] 标记精确反查） ===
  // 用户在 AIPanel 页面选中元素后，client 侧把元素（带节点 id）写入核心层 context 端点，
  // dsh-client 把引用序列化为 `@节点[n<id>]` 标记铺进会话文本。这里在 agent/pre-step
  // 解析本次 step 用户消息中的标记，从核心层 context 端点按 id 反查对应元素，
  // 只注入用户实际引用的节点上下文（kind: aipanel），并移除已注入 id 防止后续 step 重复。
  // 注入姿势与官方 session-reference 一致：改写 decision.messages，在引用后追加上下文消息。
  if (vitePort > 0) {
    const contextBase = `http://${viteHost}:${vitePort}${contextApiPath}`;

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
            for (const id of parseNodeMentions(block.text)) ids.add(id);
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
        const contextMessage = buildPluginMessage(
          `以下是用户引用节点的完整上下文（节点 ID 与消息中的 @节点[id] 标记对应）：\n\n${contextText}`,
        );

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
    viteHost,
    eventsPath: config.eventsPath,
    eventsToken: config.eventsToken,
  });

  // === 5) 启动期设置应用（agentPreset / permissionPreset / busyEnter；替代 provider 侧 RPC） ===
  applyProviderSettings(ctx, config);
}
