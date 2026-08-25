/**
 * 通用类型（Provider 无关）
 * Provider 专属类型已下沉至 @aipanel/provider-opencode。
 */

/**
 * 展示模式类型
 */
export type DisplayMode = "bubble" | "split" | "auto" | "extension" | "extension-selector";

/**
 * 分屏模式配置
 */
export interface SplitModeOptions {
  /** 面板宽度，默认 500 */
  width?: number;
  /** 最小宽度，默认 400 */
  minWidth?: number;
  /** 最大宽度，默认 800 */
  maxWidth?: number;
  /** 是否可调整宽度，默认 true */
  resizable?: boolean;
  /** 是否收缩主页面，默认 true */
  shrinkPage?: boolean;
  /** 默认是否展开，默认 true */
  defaultOpen?: boolean;
  /** 面板位置，默认 'right' */
  position?: "left" | "right";
}

/**
 * 挂件注入配置选项
 */
export interface WidgetOptions {
  /** 主题模式 */
  theme: string;
  /** 是否自动打开 */
  open: boolean;
  /** 快捷键配置 */
  hotkey?: string;
  /** 代理服务端口 */
  proxyPort?: number;
  /** 代理服务主机名 */
  proxyHost?: string;
  /** 展示模式 */
  displayMode?: DisplayMode;
  /** 分屏模式配置 */
  splitMode?: SplitModeOptions;
  /** Vite 服务 Web 端口（扩展模式多实例场景用） */
  vitePort?: string;
  /** 服务实例唯一标识（扩展模式多实例隔离用） */
  serviceInstanceId?: string;
  /** 当前窗口 ID（扩展模式多窗口隔离用） */
  myWindowId?: number;
  /** Web 服务端口 */
  webPort?: number;
  /** 项目根目录 */
  projectRoot?: string;
  /** 是否开启 verbose 日志 */
  verbose?: boolean;
}

/**
 * 日志文件配置
 * 给 Agent 提供查看外部服务日志的能力（MCP 工具配置，Provider 无关）
 */
export interface LogFileConfig {
  /** 日志文件的唯一标识符，用于工具调用时指定 */
  name: string;
  /** 日志文件路径（绝对路径或相对于项目根目录的相对路径） */
  path: string;
  /** 工具描述，告诉 Agent 何时使用此工具查看日志 */
  description: string;
}

/**
 * 选中的元素信息
 */
export interface SelectedElement {
  /** 文件路径 */
  filePath: string | null;
  /** 行号 */
  line: number | null;
  /** 列号 */
  column: number | null;
  /** 元素内部文本 */
  innerText: string;
  /** 元素描述（标签名+选择器） */
  description?: string;
}

/**
 * 页面上下文数据
 */
export interface PageContext {
  /** 当前页面 URL */
  url: string;
  /** 当前页面标题 */
  title: string;
  /** 页面唯一标识（sessionStorage 持久化，同 Tab 刷新不变，新 Tab 重生成） */
  sessionId?: string;
  /** Chrome DevTools 中的 pageId，通过 MCP list_pages 解析得到 */
  pageId?: number;
  /** 当前活跃的浏览器 Tab ID（扩展模式），用于在多 Tab 场景下标识具体是哪个 Tab */
  tabId?: number;
  /** Tab 在标签栏的位置索引（从 0 开始），用于 MCP 匹配 Page ID */
  tabIndex?: number;
  /** 选中的元素列表 */
  selectedElements?: SelectedElement[];
}

/**
 * 服务启动任务状态
 */
export type ServiceStartupTask =
  | "checking_provider"
  | "allocating_port"
  | "preparing_runtime"
  | "starting_web"
  | "waiting_web_ready"
  | "starting_proxy"
  | "warming_up_chrome"
  | "creating_session"
  | "provider_not_installed"
  | "web_start_timeout"
  | "proxy_start_failed"
  | "session_creation_failed"
  | "chrome_mcp_failed"
  | "ready";

/**
 * 服务启动任务状态映射
 */
export const SERVICE_STARTUP_TASKS: Record<ServiceStartupTask, string> = {
  checking_provider: "检查 Provider 环境",
  allocating_port: "分配服务端口",
  preparing_runtime: "准备运行环境",
  starting_web: "启动 Web 服务",
  waiting_web_ready: "等待服务就绪",
  starting_proxy: "启动代理服务",
  warming_up_chrome: "预热 Chrome DevTools",
  creating_session: "创建会话",
  provider_not_installed: "Provider 未安装",
  web_start_timeout: "服务启动超时",
  proxy_start_failed: "代理服务启动失败",
  session_creation_failed: "会话创建失败",
  chrome_mcp_failed: "Chrome DevTools 连接失败",
  ready: "准备完成",
};

// ==================== Widget 组件类型 ====================

/**
 * 挂件主题选项
 */
export type AIPanelWidgetTheme = "light" | "dark" | "auto";

/**
 * 服务状态
 */
export type ServiceStatus = "idle" | "starting" | "ready" | "partial" | "failed";

/**
 * Session 状态类型
 */
export type AIPanelSessionStatusType = "idle" | "running" | "streaming" | "completed";

/**
 * Session 思考状态
 */
export interface AIPanelSessionThinkingState {
  thinking: boolean;
  statusType: AIPanelSessionStatusType;
  hasPending: boolean;
}

/**
 * 挂件会话信息
 */
export interface AIPanelWidgetSession {
  id: string;
  title?: string;
  updatedAt?: string | number | Date;
  meta?: string;
  directory?: string;
  url?: string;
}

/**
 * 挂件选中的元素
 */
export interface AIPanelSelectedElement {
  filePath: string | null;
  line: number | null;
  column: number | null;
  innerText: string;
  description?: string;
}

/**
 * 删除选中节点的载荷
 */
export interface AIPanelRemoveSelectedPayload {
  element: AIPanelSelectedElement;
  index: number;
  source: "panel" | "bubble";
}

/**
 * 挂件会话列表项
 */
export interface AIPanelWidgetSessionItem {
  key: string;
  id: string;
  title: string;
  meta: string;
  active: boolean;
  session: AIPanelWidgetSession;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * 选中元素列表项
 */
export interface AIPanelSelectedElementItem {
  key: string;
  description: string;
  bubbleFileText: string;
  panelFileText: string;
  element: AIPanelSelectedElement;
}

/**
 * 挂件组件 Props
 */
export interface AIPanelWidgetProps {
  open?: boolean;
  theme?: AIPanelWidgetTheme;
  title?: string;
  hotkeyLabel?: string;
  selectShortcutLabel?: string;
  selectMode?: boolean;
  sessionListCollapsed?: boolean;
  sessionKey?: string;
  frameLoading?: boolean;
  loadingSessionList?: boolean;
  showSessionListSkeleton?: boolean;
  showEmptyState?: boolean;
  showError?: boolean;
  emptyStateText?: string;
  emptyStateActionText?: string;
  iframeSrc?: string;
  sessions?: AIPanelWidgetSession[];
  currentSessionId?: string | null;
  selectedElements?: AIPanelSelectedElement[];
  showClearAll?: boolean;
  selectEnabled?: boolean;
  thinking?: boolean;
  /** 所有 session 的状态映射 */
  sessionStates?: Record<string, AIPanelSessionThinkingState>;
  /** 展示模式 */
  displayMode?: DisplayMode;
  /** 分屏模式配置 */
  splitMode?: SplitModeOptions;
  /** 分屏面板宽度（运行时状态） */
  splitPanelWidth?: number;
  /** 隐藏悬浮气泡（浏览器扩展模式下使用） */
  hideBubble?: boolean;
  /** 是否支持代码审查面板（右上角 </> 按钮）；由 Provider capabilities.reviewPanel 决定 */
  reviewPanelEnabled?: boolean;
}

/**
 * 挂件组件事件
 */
export type AIPanelWidgetEmits = {
  (e: "update:open", value: boolean): void;
  (e: "update:selectMode", value: boolean): void;
  (e: "update:sessionListCollapsed", value: boolean): void;
  (e: "update:currentSessionId", value: string | null): void;
  (e: "update:selectedElements", value: AIPanelSelectedElement[]): void;
  (e: "update:theme", value: AIPanelWidgetTheme): void;
  (e: "update:thinking", value: boolean): void;
  (e: "update:splitPanelWidth", value: number): void;
  (e: "toggle", value: boolean): void;
  (e: "close"): void;
  (e: "toggle-session-list", value: boolean): void;
  (e: "toggle-select-mode", value: boolean): void;
  (e: "toggle-theme", value: AIPanelWidgetTheme): void;
  (e: "create-session"): void;
  (e: "select-session", session: AIPanelWidgetSession): void;
  (e: "delete-session", session: AIPanelWidgetSession): void;
  (e: "click-selected-node", element: AIPanelSelectedElement): void;
  (e: "remove-selected-node", payload: AIPanelRemoveSelectedPayload): void;
  (e: "clear-selected-nodes"): void;
  (e: "empty-action"): void;
  (e: "frame-loaded"): void;
  (e: "thinking-change", value: boolean): void;
  (e: "split-panel-width-change", value: number): void;
};

// ==================== 模型信息类型 ====================

export interface ModelInfo {
  providerID: string;
  modelID: string;
  name?: string;
  inputCost: number;
  releaseDate: string;
}

// ==================== Chrome MCP 错误类型 ====================

/**
 * Chrome MCP 预热错误类型
 */
export enum ChromeMcpWarmupErrorType {
  CHROME_NOT_CONNECTED = "CHROME_NOT_CONNECTED",
  AI_TIMEOUT = "AI_TIMEOUT",
  AI_RESPONSE_ERROR = "AI_RESPONSE_ERROR",
  SESSION_ERROR = "SESSION_ERROR",
  UNKNOWN = "UNKNOWN",
}

/**
 * Chrome MCP 预热错误
 */
export class ChromeMcpWarmupError extends Error {
  constructor(
    public type: ChromeMcpWarmupErrorType,
    message: string,
    public details?: string,
  ) {
    super(message);
    this.name = "ChromeMcpWarmupError";
  }
}
