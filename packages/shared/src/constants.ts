/**
 * @fileoverview OpenCode 插件常量定义
 */

import type { OpenCodeLanguage, OpenCodeSettings } from "./types";

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
export const LOG_PREFIX = "[vite-plugin-opencode]";

/** OpenCode Web 日志前缀 */
export const WEB_LOG_PREFIX = "[OpenCode Web]";

/** OpenCode Web 错误日志前缀 */
export const WEB_ERROR_PREFIX = "[OpenCode Web Error]";

/** ==================== 挂件相关 ==================== */

/** 挂件脚本路径 */
export const WIDGET_SCRIPT_PATH = "/__opencode_widget__.js";

/** 配置数据属性名 */
export const CONFIG_DATA_ATTR = "data-opencode-config";

/** 上下文 API 路径 */
export const CONTEXT_API_PATH = "/__opencode_context__";

/** 启动 API 路径 */
export const START_API_PATH = "/__opencode_start__";

/** 会话列表 API 路径 */
export const SESSIONS_API_PATH = "/__opencode_sessions__";

/** SSE 事件流路径 */
export const SSE_EVENTS_PATH = "/__opencode_events__";

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
export const INIT_MARKER = "__OPENCODE_INITIALIZED__";

/** 选中元素存储键 */
export const SELECTED_ELEMENTS_KEY = "__opencode_selected_elements__";

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
} as const;

/** ==================== Widget PostMessage 类型 ==================== */

/** Widget iframe postMessage 消息类型 */
export const WIDGET_MSG = {
  READY: "OPENCODE_READY",
  KEYDOWN: "OPENCODE_KEYDOWN",
  SET_THEME: "OPENCODE_SET_THEME",
  INSERT_FILE_PART: "OPENCODE_INSERT_FILE_PART",
  SELECT_MODE_CHANGE: "OPENCODE_SELECT_MODE_CHANGE",
  ELEMENT_SELECTED: "OPENCODE_ELEMENT_SELECTED",
  SELECTION_CANCELLED: "OPENCODE_SELECTION_CANCELLED",
  SELECTOR_START: "OPENCODE_SELECTOR_START",
  SELECTOR_STOP: "OPENCODE_SELECTOR_STOP",
  SERVICE_INFO: "OPENCODE_SERVICE_INFO",
  MINIMIZE_STATE: "MINIMIZE_STATE_CHANGE",
  PROMPT_DOCK_VISIBILITY: "PROMPT_DOCK_VISIBILITY_CHANGE",
  REVIEW_PANEL_TOGGLE: "REVIEW_PANEL_TOGGLE",
} as const;

/** ==================== API 路径补充 ==================== */

/** OpenCode 预热 API 路径 */
export const WARMUP_API_PATH = "/__opencode_warmup__";

/** Bridge 脚本路径 */
export const BRIDGE_SCRIPT_PATH = "/__opencode_bridge__.js";

/** 进程日志 API 路径 */
export const LOGS_API_PATH = "/__opencode_process_logs__";

/** Widget 样式路径 */
export const WIDGET_STYLE_PATH = "/__opencode_widget__.css";

/** ==================== OpenCode localStorage 键 ==================== */

/** OpenCode localStorage 配置键 */
export const OPENCODE_STORAGE_KEYS = {
  /** 设置键 (settings.v3) */
  SETTINGS: "settings.v3",
  /** 配色方案键 */
  COLOR_SCHEME: "opencode-color-scheme",
  /** 主题 ID 键 */
  THEME_ID: "opencode-theme-id",
} as const;

/** ==================== OpenCode 默认设置 ==================== */

/** OpenCode 默认设置（与 OpenCode Web localStorage settings.v3 对应） */
export const DEFAULT_OPENCODE_SETTINGS = {
  general: {
    showReasoningSummaries: true,
    newLayoutDesigns: true,
    showFileTree: false,
  },
};

/** ==================== 文本处理 ==================== */

/** 元素文本最大显示长度 */
export const MAX_TEXT_LENGTH = 100;

/** 元素上下文标记 */
export const CONTEXT_MARKER = "[元素上下文]";

/** 页面上下文内部标记（用于插件） */
export const PAGE_CONTEXT_MARKER = "__OPENCODE_CONTEXT__";

/** 页面上下文文本最大长度 */
export const PAGE_CONTEXT_MAX_TEXT_LENGTH = 10000;

/** ==================== 默认配置 ==================== */

/** 默认插件配置 */
export const DEFAULT_CONFIG = {
  enabled: true,
  webPort: DEFAULT_WEB_PORT,
  hostname: DEFAULT_HOSTNAME,
  theme: "auto" as const,
  open: false,
  verbose: false,
  hotkey: "ctrl+k",
  warmupChromeMcp: true,
  chromeDevtoolsPort: CHROME_DEVTOOLS_PORT,
  displayMode: "bubble" as const,
  splitMode: undefined as
    | {
        width?: number;
        minWidth?: number;
        maxWidth?: number;
        resizable?: boolean;
        shrinkPage?: boolean;
        defaultOpen?: boolean;
      }
    | undefined,
  // OpenCode 内部配置默认值
  language: undefined as OpenCodeLanguage | undefined,
  settings: undefined as OpenCodeSettings | undefined,
  // 日志文件配置
  logFiles: undefined as
    | Array<{
        name: string;
        path: string;
        description: string;
      }>
    | undefined,
};
