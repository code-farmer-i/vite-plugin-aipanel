/**
 * DeepSeek Harness Provider 专属类型
 * 所有与 DeepSeek Harness (dsh) 绑定的类型自包含于此，核心层不感知。
 */

/** 权限预设（对应 dsh settings permission.defaultPreset） */
export type DeepSeekPermissionPreset = "read-only" | "workspace-write" | "danger-full-access";

/** 繁忙时 Enter 键行为（对应 dsh settings ui-conversation.busyEnter） */
export type DeepSeekBusyEnter = "queue" | "steer";

/**
 * DeepSeek Provider 专属配置（对应插件配置的 providerOptions 段）
 * 保留字符串索引签名，以赋给 PluginOptions 的 Record<string, unknown> 泛型约束。
 */
export type DeepSeekProviderOptions = {
  /** dsh 数据目录（$DSH_HOME），默认跟随系统（~/.dsh） */
  home?: string;
  /** 默认 Agent 预设（dsh settings agent-presets.default，如 code/standard；新建会话的默认模式） */
  agentPreset?: string;
  /** 默认权限预设（dsh settings permission.defaultPreset） */
  permissionPreset?: DeepSeekPermissionPreset;
  /** 繁忙时 Enter 键行为（dsh settings ui-conversation.busyEnter） */
  busyEnter?: DeepSeekBusyEnter;
  /**
   * 编辑后自动诊断（对应 opencode providerOptions.enableLsp 的质量门禁语义）：
   * write/edit/apply_patch 执行后自动补跑 ESLint + vue-tsc 并把结果并入工具输出。
   * 仅当 enableDiagnostics 开启时生效；默认关闭；未配置时回退到环境变量
   * OPENCODE_ENABLE_LINT=1（与 opencode 一致）。
   */
  autoDiagnose?: boolean;
  /**
   * 诊断功能总开关：关闭（默认）时不注入任何诊断相关插件逻辑——
   * run_diagnostics 审查工具、编辑后自动诊断、会话诊断卡片视图都不注册。
   * 开启后上述能力按各自配置生效。
   */
  enableDiagnostics?: boolean;
  /**
   * Provider 允许自定义扩展字段
   * [key: string]: unknown;
   */
  [key: string]: unknown;
};

/**
 * dsh API 四象限 RPC envelope（客户端请求 / 服务端响应）。
 * 字段为 type/rpcId/method/payload + result:{ok,value|error}，不是标准 JSON-RPC。
 */

/** 客户端 → 服务端 请求体（POST /api/<method>） */
export interface ClientRequest {
  type: "client-request";
  rpcId: string;
  method: string;
  payload: Record<string, unknown>;
}

/** 服务端 → 客户端 响应体 */
export interface ServerResponse {
  type: "server-response";
  rpcId: string;
  result: { ok: true; value: unknown } | { ok: false; error: { code?: string; message?: string } };
}

/** 服务端推送帧（SSE data 载荷） */
export interface ServerRequest {
  type: "server-request";
  rpcId: string;
  method: string;
  payload: Record<string, unknown>;
}

/** 会话摘要（POST /api/session.list 的 items 项） */
export interface SessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  origin?: "subagent";
  cwd?: string;
  agentPreset?: string;
  /** 会话投影（标题等派生值存在 projections.values.title） */
  projections?: {
    values?: {
      title?: string | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

/** session.list 的 value：容器对象（不是数组），会话在 items 下 */
export interface SessionListResult {
  items: SessionSummary[];
}

/** 工作区视图（POST /api/workspace.list 的 items 项，用于按目录匹配会话） */
export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** workspace.list 的 value：容器对象（不是数组），工作区在 items 下，archivedSessionIds 为已归档会话 */
export interface WorkspaceListResult {
  items: WorkspaceView[];
  archivedSessionIds: string[];
}

/** workspace.create 的 value（幂等：已存在则返回既有 workspace，created=false） */
export interface WorkspaceCreateResult {
  workspace: WorkspaceView;
  created: boolean;
}

/** 会话流式事件（session/event 的 event 字段） */
export interface SessionStreamEvent {
  type: string;
  seq: number;
  time?: number;
  data?: Record<string, unknown>;
}

/** dsh 会话日志事件类型（用于 thinking/status 推导的稳定子集） */
export const SESSION_EVENT_TYPES = {
  /** 回合开始 → 视为 streaming */
  TURN_START: "turn/start",
  /** 回合结束（稳定停等） */
  TURN_END: "turn/end",
  /** 步骤开始 */
  STEP_START: "step/start",
  /** 步骤结束 */
  STEP_END: "step/end",
  /** 助手输出完成 */
  ASSISTANT_MESSAGE: "assistant/message",
  /** 助手输出增量分片 */
  ASSISTANT_CHUNK: "assistant/chunk",
  /** 思考增量分片 */
  THINKING_DELTA: "thinking/delta",
} as const;

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[keyof typeof SESSION_EVENT_TYPES];
