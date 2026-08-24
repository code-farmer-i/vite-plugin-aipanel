/**
 * Web Provider 适配层契约
 *
 * 核心层只依赖本文件定义的通用协议；具体 Web UI（Provider）的实现细节
 * 全部封装在 WebProvider 实现内。新增 Provider 时只需实现本接口。
 */

/** 通用会话模型（Provider 私有会话 → 归一化） */
export interface ChatSession {
  /** 会话 ID */
  id: string;
  /** 会话标题 */
  title: string;
  /** 创建时间戳 */
  createdAt?: number;
  /** 更新时间戳 */
  updatedAt?: number;
  /** 是否已归档 */
  archived?: boolean;
  /** 父会话 ID（subagent 会话才有） */
  parentId?: string;
  /**
   * 会话打开 URL（由 buildSessionUrl 填充）。
   * 无 deepLink 能力时所有会话共用应用壳 URL（同一值），切换会话靠 FOCUS_SESSION 消息。
   */
  url?: string;
}

/** 会话运行状态 */
export type SessionStatus = "idle" | "running" | "streaming" | "completed";

/** Provider 事件（Provider 私有事件 → 归一化，客户端只消费这些事件） */
export type ProviderEvent =
  | { type: "connected" }
  /** 会话信息更新（标题/摘要等） */
  | { type: "session.updated"; session: ChatSession }
  /** 会话运行状态变化 */
  | { type: "session.status"; sessionId: string; status: SessionStatus }
  /** 会话思考状态（由 adapter 自行推导） */
  | { type: "thinking"; sessionId: string; thinking: boolean };

/** Provider 环境检查结果 */
export interface ProviderEnvironmentInfo {
  /** 环境是否就绪 */
  ok: boolean;
  /** Provider 版本号 */
  version?: string;
  /** 未就绪时的说明（如安装指引） */
  message?: string;
}

/** Provider 启动选项（核心编排层提供的通用运行参数） */
export interface ProviderStartOptions {
  /** 服务端口 */
  port: number;
  /** 服务主机名 */
  hostname: string;
  /** 工作目录 */
  cwd: string;
  /** CORS 允许的源 */
  corsOrigins: string[];
  /** 项目对应的 Vite 端口（用于回连 Vite 服务） */
  vitePort: number;
  /** 上下文 API URL（核心层提供的回连地址） */
  contextApiUrl?: string;
  /** 进程日志 API URL（核心层提供的回连地址） */
  logsApiUrl?: string;
  /** Vue DevTools API 地址（核心层提供的回连地址） */
  vueDevtoolsApiUrl?: string;
  /** 启用 verbose 模式 */
  verbose?: boolean;
}

/**
 * Provider 初始化上下文（核心层动态加载 Provider 时传入）
 * Provider 专属配置通过 options 原样传递，schema 由 Provider 自行解析。
 */
export interface ProviderInitContext {
  /** 服务主机名 */
  hostname: string;
  /** Chrome DevTools Protocol 端口 */
  chromeDevtoolsPort: number;
  /** 实际 Web 端口读取器 */
  getWebPort(): number;
  /** 实际代理端口读取器 */
  getProxyPort(): number;
  /** 用户完整插件配置（宽松对象，Provider 自解析所需字段） */
  options?: Record<string, unknown>;
}

/** Provider 启动结果 */
export interface ProviderStartResult {
  /** 就绪后的服务 URL */
  url: string;
  /** 进程句柄（供编排层做就绪等待与退出检测，不透明） */
  processHandle?: unknown;
}

/** Provider 初始化配置（主题/语言/设置等，schema 由 Provider 定义） */
export interface ProviderConfig {
  /** 主题模式 */
  theme?: "light" | "dark" | "auto";
  /** 界面语言 */
  language?: string;
  /** Provider 内部设置 */
  settings?: unknown;
  [key: string]: unknown;
}

/** Provider 能力描述（客户端据此自适应行为） */
export interface ProviderCapabilities {
  /**
   * 会话是否支持 URL 深链。
   * true（默认）：iframe 每次切换会话重载，src 直达该会话；
   * false（SPA 型无深链 Provider）：iframe 保持应用壳 URL 不重载，
   * 切换会话通过 FOCUS_SESSION 消息完成。
   */
  deepLink?: boolean;
}

/**
 * Web Provider 适配器接口
 */
export interface WebProvider {
  /** 唯一标识（对应插件配置的 provider 字段） */
  readonly id: string;
  /** 展示名称 */
  readonly displayName: string;

  /** 校验运行环境（CLI 是否安装、版本） */
  checkEnvironment(): Promise<ProviderEnvironmentInfo>;

  /** 启动 Web 服务（含运行环境准备），返回就绪 URL */
  start(options: ProviderStartOptions): Promise<ProviderStartResult>;

  /** 停止服务 */
  stop(): Promise<void>;

  /** 清理孤儿进程（上次退出残留的 provider 进程），返回清理数量（可选） */
  killOrphans?(): Promise<number>;

  /** 会话管理（归一化到 ChatSession，过滤逻辑在此内部完成） */
  listSessions(projectDir: string): Promise<ChatSession[]>;
  createSession(projectDir: string, title?: string): Promise<ChatSession>;
  /** 可选：部分 Provider 无删除语义；core 不支持时隐藏删除入口 */
  deleteSession?(sessionId: string): Promise<void>;

  /** 会话打开 URL（iframe src）；无 deepLink 能力时返回应用壳 URL（所有会话相同） */
  buildSessionUrl(projectDir: string, sessionId: string): string;

  /** Provider 能力描述（客户端自适应行为；缺省按 deepLink=true 处理） */
  readonly capabilities?: ProviderCapabilities;

  /** 事件订阅：把 Provider 私有事件归一化为 ProviderEvent；返回取消订阅函数 */
  subscribeEvents(handler: (e: ProviderEvent) => void): () => void;

  /** 代理注入到 HTML 的 Provider 侧桥接脚本（可选） */
  bridgeScript?: string;

  /** Provider 初始化配置（主题/语言/设置，schema 由 Provider 定义） */
  applyConfig?(config: ProviderConfig): void;
}
