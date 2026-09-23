/**
 * @fileoverview 通用常量定义（Provider 无关）
 * Provider 专属常量已下沉至 @aipanel/provider-opencode。
 */

/** ==================== 网络相关 ==================== */

/** 默认主机名 */
export const DEFAULT_HOSTNAME = "127.0.0.1";

/** 默认 Web 服务端口 */
export const DEFAULT_WEB_PORT = 5097;

/** 默认代理服务端口 */
export const DEFAULT_PROXY_PORT = 6097;

/** 服务器启动超时时间（毫秒） */
export const SERVER_START_TIMEOUT = 300000;

/** 服务器检查间隔（毫秒） */
export const SERVER_CHECK_INTERVAL = 100;

/** ==================== 重试相关 ==================== */

/** 默认重试次数 */
export const DEFAULT_RETRIES = 5;

/** 重试延迟（毫秒） */
export const RETRY_DELAY = 500;

/** ==================== 端口查找 ==================== */

/** 最大端口尝试次数 */
export const MAX_PORT_TRIES = 10;

/** ==================== 日志相关 ==================== */

/** 插件日志前缀 */
export const LOG_PREFIX = "[vite-plugin-aipanel]";

/** ==================== 挂件相关 ==================== */

/** 挂件脚本路径 */
export const WIDGET_SCRIPT_PATH = "/__aipanel_widget__.js";

/** 配置数据属性名 */
export const CONFIG_DATA_ATTR = "data-aipanel-config";

/** 上下文 API 路径 */
export const CONTEXT_API_PATH = "/__aipanel_context__";

/** 启动 API 路径 */
export const START_API_PATH = "/__aipanel_start__";

/** 会话列表 API 路径 */
export const SESSIONS_API_PATH = "/__aipanel_sessions__";

/** MCP 代理 API 路径 */
export const MCP_API_PATH = "/__aipanel_mcp__";

/** SSE 事件流路径（客户端订阅 SESSION_EVENT 等） */
export const SSE_EVENTS_PATH = "/__aipanel_events__";

/** 宿主侧事件推送 API 路径（dsh-plugin 等 Host 插件把归一化 ProviderEvent POST 到这里，core 再广播给 SSE 客户端） */
export const HOST_EVENTS_API_PATH = "/__aipanel_host_events__";

/** 上下文更新间隔（毫秒） */
export const CONTEXT_UPDATE_INTERVAL = 500;

/** 服务器同步间隔（毫秒） */
export const SERVER_SYNC_INTERVAL = 2000;

/** 框架 Inspector 检查间隔（毫秒） */
export const INSPECTOR_CHECK_INTERVAL = 500;

/** 自动打开延迟（毫秒） */
export const AUTO_OPEN_DELAY = 1000;

/** 通知显示时间（毫秒） */
export const NOTIFICATION_DURATION = 3000;

/** ==================== 存储相关 ==================== */

/** 初始化标记 */
export const INIT_MARKER = "__AIPANEL_INITIALIZED__";

/** 选中元素存储键 */
export const SELECTED_ELEMENTS_KEY = "__aipanel_selected_elements__";

/** 页面会话标识键（sessionStorage，跨导航标识同一 Tab 的页面上下文） */
export const SESSION_ID_KEY = "_aipanel_pk";

/** ==================== 缓存目录 ==================== */

/**
 * AIPanel 项目级资源/缓存目录（相对于项目根目录，各 Provider 统一使用）。
 * 存放 opencode.json、dsh overlay 等运行时状态，不污染项目根目录。
 */
export const AIPANEL_CACHE_DIR = "node_modules/.cache/aipanel";

/** ==================== Chrome DevTools ==================== */

/** Chrome DevTools Protocol 默认端口 */
export const CHROME_DEVTOOLS_PORT = 9222;

/** Chrome DevTools 检查超时时间（毫秒） */
export const CHROME_DEVTOOLS_CHECK_TIMEOUT = 2000;

/** ==================== 扩展消息类型 ==================== */

/** 需要后台转发的消息类型（多实例间通信） */
export const EXT_BROADCAST = {
  PAGE_CONTEXT: "PAGE_CONTEXT",
  THEME_CHANGE: "THEME_CHANGE",
  SERVICE_APPEARED: "SERVICE_APPEARED",
  SERVICE_GONE: "SERVICE_GONE",
} as const;

/** Chrome 扩展内部消息类型（chrome.runtime.sendMessage） */
export const EXT_MSG = {
  ...EXT_BROADCAST,
  GET_PORT_INFO: "GET_PORT_INFO",
  TAB_SWITCHED: "TAB_SWITCHED",
  REQUEST_PAGE_CONTEXT: "REQUEST_PAGE_CONTEXT",
  SELECTION_START: "SELECTION_START",
  SELECTION_STOP: "SELECTION_STOP",
  CS_QUERY_WINDOW: "__CS_QUERY_WINDOW__",
  /** Side Panel → Background：立即轮询一次并回传当前服务信息 */
  FORCE_POLL: "FORCE_POLL",
} as const;

/** ==================== Widget PostMessage 类型 ==================== */

/** Widget PostMessage 消息类型 */
export const WIDGET_MSG = {
  READY: "AIPANEL_READY",
  KEYDOWN: "AIPANEL_KEYDOWN",
  SET_THEME: "AIPANEL_SET_THEME",
  INSERT_FILE_PART: "AIPANEL_INSERT_FILE_PART",
  SELECT_MODE_CHANGE: "AIPANEL_SELECT_MODE_CHANGE",
  ELEMENT_SELECTED: "AIPANEL_ELEMENT_SELECTED",
  SELECTION_CANCELLED: "AIPANEL_SELECTION_CANCELLED",
  SELECTOR_START: "AIPANEL_SELECTOR_START",
  SELECTOR_STOP: "AIPANEL_SELECTOR_STOP",
  SERVICE_INFO: "AIPANEL_SERVICE_INFO",
  MINIMIZE_STATE: "MINIMIZE_STATE_CHANGE",
  PROMPT_DOCK_VISIBILITY: "PROMPT_DOCK_VISIBILITY_CHANGE",
  REVIEW_PANEL_TOGGLE: "REVIEW_PANEL_TOGGLE",
  /** 宿主 → iframe：告知侧栏归属期望（mode: "host" | "provider"），Provider 据此决定是否展示自家侧栏 */
  SIDEBAR_MODE: "AIPANEL_SIDEBAR_MODE",
  /** 宿主 → iframe：host 折叠开关驱动 Provider 收起/展开自家侧栏（{ collapsed }） */
  SIDEBAR_COLLAPSE: "AIPANEL_SIDEBAR_COLLAPSE",
  /** iframe → 宿主（可选）：Provider 内部折叠变化回传（{ collapsed }），供宿主同步左上角开关状态 */
  SIDEBAR_STATE: "AIPANEL_SIDEBAR_STATE",
  /** 无 deepLink 能力的 Provider：通知 iframe 聚焦指定会话 */
  FOCUS_SESSION: "AIPANEL_FOCUS_SESSION",
  /** 无 deepLink 能力的 Provider：iframe 确认目标会话已激活且渲染稳定（携带 sessionId） */
  SESSION_READY: "AIPANEL_SESSION_READY",
} as const;

/** ==================== API 路径补充 ==================== */

/** Provider 预热 API 路径 */
export const WARMUP_API_PATH = "/__aipanel_warmup__";

/** Bridge 脚本路径 */
export const BRIDGE_SCRIPT_PATH = "/__aipanel_bridge__.js";

/** 进程日志 API 路径 */
export const LOGS_API_PATH = "/__aipanel_process_logs__";

/** Widget 样式路径 */
export const WIDGET_STYLE_PATH = "/__aipanel_widget__.css";

/** Vue DevTools API 路径 */
export const VUE_DEVTOOLS_API_PATH = "/__aipanel_vue_devtools__";

/** ==================== 文本处理 ==================== */

/** 元素文本最大显示长度 */
export const MAX_TEXT_LENGTH = 100;

/** 元素上下文标记 */
export const CONTEXT_MARKER = "[元素上下文]";

/** 页面上下文内部标记（用于插件） */
export const PAGE_CONTEXT_MARKER = "__AIPANEL_CONTEXT__";

/** 页面上下文文本最大长度 */
export const PAGE_CONTEXT_MAX_TEXT_LENGTH = 10000;

/** ==================== 诊断 Severity ==================== */

/**
 * 诊断 severity 常量，使用 LSP DiagnosticSeverity 规范值
 * Error=1, Warning=2, Information=3, Hint=4
 */
export const SEVERITY_ERROR = 1;
export const SEVERITY_WARN = 2;

/** ==================== Vue DevTools API ==================== */

/** Vue DevTools API action 名称 */
export const VUE_DEVTOOLS_ACTIONS = {
  GET_COMPONENT_TREE: "getComponentTree",
  GET_COMPONENT_STATE: "getComponentState",
  GET_COMPONENT_RENDER_CODE: "getComponentRenderCode",
  GET_APPS: "getApps",
  TOGGLE_APP: "toggleApp",
  GET_ROUTER_INFO: "getRouterInfo",
  GET_TIMELINE: "getTimeline",
  MARK_TIMELINE: "markTimeline",
  CLEAR_TIMELINE: "clearTimeline",
} as const;

export type VueDevtoolsAction = (typeof VUE_DEVTOOLS_ACTIONS)[keyof typeof VUE_DEVTOOLS_ACTIONS];

/**
 * 时间线层名（工具 schema 的 layer 枚举与页面侧采集器共用）。
 * lifecycle 只累计计数、不产生明细记录；其余层都是明细记录。
 */
export const VUE_DEVTOOLS_TIMELINE_LAYERS = [
  "perf",
  "lifecycle",
  "emit",
  "navigate",
  "agent",
] as const;

export type VueDevtoolsTimelineLayer = (typeof VUE_DEVTOOLS_TIMELINE_LAYERS)[number];

/** 时间线明细档位（唯一来源）：数组、类型与页面侧的分支比较都引用这里，避免散落字面量 */
export const VUE_DEVTOOLS_TIMELINE_INCLUDE = {
  SUMMARY: "summary",
  SLOW: "slow",
  ALL: "all",
} as const;

export const VUE_DEVTOOLS_TIMELINE_INCLUDES = [
  VUE_DEVTOOLS_TIMELINE_INCLUDE.SUMMARY,
  VUE_DEVTOOLS_TIMELINE_INCLUDE.SLOW,
  VUE_DEVTOOLS_TIMELINE_INCLUDE.ALL,
] as const;

export type VueDevtoolsTimelineInclude = (typeof VUE_DEVTOOLS_TIMELINE_INCLUDES)[number];

/** 默认明细档位 */
const DEFAULT_TIMELINE_INCLUDE: VueDevtoolsTimelineInclude = VUE_DEVTOOLS_TIMELINE_INCLUDE.SLOW;

/** 时间线查询默认值（MCP 工具 schema 与页面侧采集器共用，避免两处漂移） */
export const VUE_DEVTOOLS_TIMELINE_DEFAULTS = {
  /** 默认回溯窗口（毫秒） */
  windowMs: 5000,
  /** 默认只返回耗时 ≥ 该值的组件渲染记录（毫秒） */
  minDurationMs: 4,
  /** 默认明细档位 */
  include: DEFAULT_TIMELINE_INCLUDE,
  /** 默认明细条数上限 */
  limit: 30,
  /** 明细条数上限的硬上限 */
  maxLimit: 200,
  /** 页面侧环形缓冲容量（条） */
  capacity: 1000,
} as const;

/** ==================== 写类工具名单 ==================== */

/** 会修改文件的工具名（host 插件与编辑后自动诊断共用的单一来源） */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "apply_patch"]);

/** ==================== 挂件主题 ==================== */

/** 挂件主题可选值（对应 AIPanelWidgetTheme） */
export const WIDGET_THEME_MODES = ["auto", "light", "dark"] as const;

/** ==================== OpenCode 环境变量名 ==================== */

/** OpenCode 相关环境变量名（opencode provider 写、es/plugins 读，统一引用防止字面量漂移） */
export const OPENCODE_ENV = {
  CONFIG_DIR: "OPENCODE_CONFIG_DIR",
  CONTEXT_API_URL: "OPENCODE_CONTEXT_API_URL",
  VITE_LOGS_API_URL: "OPENCODE_VITE_LOGS_API_URL",
  LOG_FILES_JSON: "OPENCODE_LOG_FILES_JSON",
  VERBOSE: "OPENCODE_VERBOSE",
  /** 诊断策略 JSON（DiagnosticsPolicy）：provider 写，opencode 插件读 */
  DIAGNOSTICS: "OPENCODE_DIAGNOSTICS",
  VUE_DEVTOOLS_API_URL: "OPENCODE_VUE_DEVTOOLS_API_URL",
  WORKSPACE: "OPENCODE_WORKSPACE",
} as const;

/** ==================== SSE 事件流消息类型 ==================== */

/** 服务端 → 客户端 SSE 信封 type 字段（vite endpoints 写、client useServerSSE 读） */
export const SSE_EVENT_TYPES = {
  CONNECTED: "CONNECTED",
  STATUS_SYNC: "STATUS_SYNC",
  TASK_UPDATE: "TASK_UPDATE",
  SESSION_EVENT: "SESSION_EVENT",
  CLEAR_ELEMENTS: "CLEAR_ELEMENTS",
} as const;
export type SSEEventType = (typeof SSE_EVENT_TYPES)[keyof typeof SSE_EVENT_TYPES];

/** ==================== 元素选择器（click-to-source） ==================== */

/**
 * 元素选择器适配器标识：服务端注入的构建期插件与客户端运行时适配器共用同一标识，
 * 已登记 Vue / React；新增框架在此登记，两侧按同一 id 对齐。
 */
export const INSPECTOR_ADAPTER_IDS = {
  vue: "vue",
  react: "react",
} as const;

/** 元素选择器适配器标识类型 */
export type InspectorAdapterId = (typeof INSPECTOR_ADAPTER_IDS)[keyof typeof INSPECTOR_ADAPTER_IDS];
