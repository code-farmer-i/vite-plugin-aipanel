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

/** SSE 事件流路径 */
export const SSE_EVENTS_PATH = "/__aipanel_events__";

/** 上下文更新间隔（毫秒） */
export const CONTEXT_UPDATE_INTERVAL = 500;

/** 服务器同步间隔（毫秒） */
export const SERVER_SYNC_INTERVAL = 2000;

/** Vue Inspector 检查间隔（毫秒） */
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

/** ==================== VS Code 扩展桥接 ==================== */

/** VS Code 扩展 HTTP 服务端口（vscode-extension ↔ provider 通信协议） */
export const VSCODE_EXTENSION_PORT = 51939;

/** VS Code 扩展相关环境变量名 */
export const ENV_VSCODE_MODE = "AIPANEL_VSCODE_MODE";
export const ENV_VSCODE_PORT = "AIPANEL_VSCODE_PORT";

/** ==================== Vue DevTools API ==================== */

/** Vue DevTools API action 名称 */
export const VUE_DEVTOOLS_ACTIONS = {
  GET_COMPONENT_TREE: "getComponentTree",
  GET_COMPONENT_STATE: "getComponentState",
  GET_COMPONENT_RENDER_CODE: "getComponentRenderCode",
  GET_APPS: "getApps",
  TOGGLE_APP: "toggleApp",
  GET_ROUTER_INFO: "getRouterInfo",
} as const;

export type VueDevtoolsAction = (typeof VUE_DEVTOOLS_ACTIONS)[keyof typeof VUE_DEVTOOLS_ACTIONS];
