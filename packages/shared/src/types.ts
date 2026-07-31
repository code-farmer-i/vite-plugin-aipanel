/**
 * OpenCode 界面语言选项
 */
export type OpenCodeLanguage =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "ja"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "pl"
  | "ru"
  | "bs"
  | "ar"
  | "no"
  | "br"
  | "th"
  | "tr";

/**
 * OpenCode 内部设置（与 localStorage settings.v3 对应）
 * 用于配置 OpenCode Web 内部行为
 */
export interface OpenCodeSettings {
  /** 通用设置 */
  general?: {
    /** 自动保存 */
    autoSave?: boolean;
    /** 显示更新说明 */
    releaseNotes?: boolean;
    /** 后续动作模式 */
    followup?: "steer" | "suggest" | "none";
    /** 显示推理摘要 */
    showReasoningSummaries?: boolean;
    /** 默认展开 shell 工具部分 */
    shellToolPartsExpanded?: boolean;
    /** 默认展开编辑工具部分 */
    editToolPartsExpanded?: boolean;
  };

  /** 外观设置 */
  appearance?: {
    /** 界面字体大小 */
    fontSize?: number;
    /** 代码字体 */
    mono?: string;
    /** 界面字体 */
    sans?: string;
  };

  /** 权限设置 */
  permissions?: {
    /** 自动批准权限请求 */
    autoApprove?: boolean;
  };

  /** 通知设置 */
  notifications?: {
    /** 智能体完成时通知 */
    agent?: boolean;
    /** 权限请求时通知 */
    permissions?: boolean;
    /** 错误时通知 */
    errors?: boolean;
  };

  /** 音效设置 */
  sounds?: {
    /** 启用智能体音效 */
    agentEnabled?: boolean;
    /** 智能体音效 */
    agent?: string;
    /** 启用权限音效 */
    permissionsEnabled?: boolean;
    /** 权限音效 */
    permissions?: string;
    /** 启用错误音效 */
    errorsEnabled?: boolean;
    /** 错误音效 */
    errors?: string;
  };
}

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
 * 日志文件配置
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
 * OpenCode Vite 插件配置选项
 */
export interface OpenCodeOptions {
  /** 是否启用插件，默认 true */
  enabled?: boolean;
  /** Web 服务端口，默认 4097 */
  webPort?: number;
  /** 代理服务端口，默认 4098 */
  proxyPort?: number;
  /** 服务主机名，默认 '127.0.0.1' */
  hostname?: string;
  /** 挂件位置，默认 'bottom-right' */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** 主题模式，默认 'auto' */
  theme?: "light" | "dark" | "auto";
  /** 是否自动打开面板，默认 false */
  open?: boolean;
  /** 是否输出详细日志，默认 false */
  verbose?: boolean;
  /** 快捷键配置，默认 'ctrl+k' */
  hotkey?: string;
  /** 服务启动后是否立即预热 Chrome MCP，默认 true */
  warmupChromeMcp?: boolean;
  /** Chrome DevTools Protocol 端口，默认 9222 */
  chromeDevtoolsPort?: number;
  /** 展示模式，默认 'bubble' */
  displayMode?: DisplayMode;
  /** 分屏模式配置 */
  splitMode?: SplitModeOptions;

  // === OpenCode 内部配置 ===
  /** OpenCode 界面语言，默认跟随浏览器语言 */
  language?: OpenCodeLanguage;
  /** OpenCode 内部设置，直接映射到 localStorage settings.v3 */
  settings?: OpenCodeSettings;

  // === 日志文件配置 ===
  /** 自定义日志文件配置，为 Agent 提供查看外部服务日志的能力 */
  logFiles?: LogFileConfig[];

  // === LSP 诊断配置 ===
  /** 启用 LSP 诊断（TypeScript + ESLint），agent 编辑文件后自动返回错误信息，默认 false */
  enableLsp?: boolean;
  /** 启用 LSP 错误硬阻止：编辑后有错误则回滚文件并拒绝修改，默认 false */
  enableBlockOnError?: boolean;
}

/**
 * OpenCode Web 服务启动选项
 */
export interface WebOptions {
  /** 服务端口 */
  port: number;
  /** 服务主机名 */
  hostname: string;
  /** 服务器 URL */
  serverUrl: string;
  /** 工作目录 */
  cwd: string;
  /** 配置目录路径 */
  configDir?: string;
  /** CORS 允许的源 */
  corsOrigins?: string[];
  /** 上下文 API URL */
  contextApiUrl?: string;
  /** 进程日志 API URL */
  logsApiUrl?: string;
  /** 日志文件配置（JSON 字符串） */
  logFilesJson?: string;
  /** 启用 LSP 错误硬阻止（环境变量透传给 OpenCode 插件） */
  enableBlockOnError?: boolean;
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
  /** OpenCode 代理服务端口 */
  proxyPort?: number;
  /** OpenCode 代理服务主机名 */
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
  /** OpenCode Web 服务端口 */
  webPort?: number;
  /** 项目根目录 */
  projectRoot?: string;
  /** 是否开启 verbose 日志 */
  verbose?: boolean;
}

/**
 * OpenCode 会话信息
 */
export interface SessionInfo {
  /** 会话 ID */
  id: string;
  /** 会话标识符 */
  slug: string;
  /** 项目 ID */
  projectID: string;
  /** 项目目录 */
  directory: string;
  /** 会话标题 */
  title: string;
  /** 版本号 */
  version: string;
  /** 会话 URL */
  url?: string;
  /** 父会话 ID（subagent 会话才有） */
  parentID?: string;
  /** 代码变更统计 */
  summary: {
    /** 新增行数 */
    additions: number;
    /** 删除行数 */
    deletions: number;
    /** 修改文件数 */
    files: number;
  };
  /** 时间信息 */
  time: {
    /** 创建时间戳 */
    created: number;
    /** 更新时间戳 */
    updated: number;
    /** 归档时间戳（已归档会话才有） */
    archived?: number;
  };
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
  | "checking_opencode"
  | "allocating_port"
  | "preparing_runtime"
  | "starting_web"
  | "waiting_web_ready"
  | "starting_proxy"
  | "warming_up_chrome"
  | "creating_session"
  | "opencode_not_installed"
  | "web_start_timeout"
  | "session_creation_failed"
  | "chrome_mcp_failed"
  | "ready";

/**
 * 服务启动任务状态映射
 */
export const SERVICE_STARTUP_TASKS: Record<ServiceStartupTask, string> = {
  checking_opencode: "检查 OpenCode 安装",
  allocating_port: "分配服务端口",
  preparing_runtime: "准备运行环境",
  starting_web: "启动 OpenCode Web",
  waiting_web_ready: "等待服务就绪",
  starting_proxy: "启动代理服务",
  warming_up_chrome: "预热 Chrome DevTools",
  creating_session: "创建会话",
  opencode_not_installed: "OpenCode 未安装",
  web_start_timeout: "服务启动超时",
  session_creation_failed: "会话创建失败",
  chrome_mcp_failed: "Chrome DevTools 连接失败",
  ready: "准备完成",
};

// ==================== Widget 组件类型 ====================

/**
 * 挂件主题选项
 */
export type OpenCodeWidgetTheme = "light" | "dark" | "auto";

/**
 * 服务状态
 */
export type ServiceStatus = "idle" | "starting" | "ready" | "partial" | "failed";

/**
 * Session 状态类型
 */
export type OpencodeSessionStatusType = "idle" | "running" | "streaming" | "completed";

/**
 * Session 思考状态
 */
export interface OpencodeSessionThinkingState {
  thinking: boolean;
  statusType: OpencodeSessionStatusType;
  hasPending: boolean;
}

/**
 * 挂件会话信息
 */
export interface OpenCodeWidgetSession {
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
export interface OpenCodeSelectedElement {
  filePath: string | null;
  line: number | null;
  column: number | null;
  innerText: string;
  description?: string;
}

/**
 * 删除选中节点的载荷
 */
export interface OpenCodeRemoveSelectedPayload {
  element: OpenCodeSelectedElement;
  index: number;
  source: "panel" | "bubble";
}

/**
 * 挂件会话列表项
 */
export interface OpenCodeWidgetSessionItem {
  key: string;
  id: string;
  title: string;
  meta: string;
  active: boolean;
  session: OpenCodeWidgetSession;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * 选中元素列表项
 */
export interface OpenCodeSelectedElementItem {
  key: string;
  description: string;
  bubbleFileText: string;
  panelFileText: string;
  element: OpenCodeSelectedElement;
}

/**
 * 挂件组件 Props
 */
export interface OpenCodeWidgetProps {
  open?: boolean;
  theme?: OpenCodeWidgetTheme;
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
  sessions?: OpenCodeWidgetSession[];
  currentSessionId?: string | null;
  selectedElements?: OpenCodeSelectedElement[];
  showClearAll?: boolean;
  selectEnabled?: boolean;
  thinking?: boolean;
  /** 所有 session 的状态映射 */
  sessionStates?: Record<string, OpencodeSessionThinkingState>;
  /** 展示模式 */
  displayMode?: DisplayMode;
  /** 分屏模式配置 */
  splitMode?: SplitModeOptions;
  /** 分屏面板宽度（运行时状态） */
  splitPanelWidth?: number;
  /** 隐藏悬浮气泡（浏览器扩展模式下使用） */
  hideBubble?: boolean;
}

/**
 * 挂件组件事件
 */
export type OpenCodeWidgetEmits = {
  (e: "update:open", value: boolean): void;
  (e: "update:selectMode", value: boolean): void;
  (e: "update:sessionListCollapsed", value: boolean): void;
  (e: "update:currentSessionId", value: string | null): void;
  (e: "update:selectedElements", value: OpenCodeSelectedElement[]): void;
  (e: "update:theme", value: OpenCodeWidgetTheme): void;
  (e: "update:thinking", value: boolean): void;
  (e: "update:splitPanelWidth", value: number): void;
  (e: "toggle", value: boolean): void;
  (e: "close"): void;
  (e: "toggle-session-list", value: boolean): void;
  (e: "toggle-select-mode", value: boolean): void;
  (e: "toggle-theme", value: OpenCodeWidgetTheme): void;
  (e: "create-session"): void;
  (e: "select-session", session: OpenCodeWidgetSession): void;
  (e: "delete-session", session: OpenCodeWidgetSession): void;
  (e: "click-selected-node", element: OpenCodeSelectedElement): void;
  (e: "remove-selected-node", payload: OpenCodeRemoveSelectedPayload): void;
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
