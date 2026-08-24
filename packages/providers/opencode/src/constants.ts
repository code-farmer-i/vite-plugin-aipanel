/**
 * OpenCode Provider 专属常量与默认值
 * 与 OpenCode Web 绑定的常量自包含于此，核心层不感知。
 */
import type { OpenCodeProviderOptions } from "./types";

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
    editToolPartsExpanded: true,
    shellToolPartsExpanded: true,
  },
};

/** ==================== 运行环境 ==================== */

/** OpenCode 缓存目录（相对于项目根目录，存放 opencode.json 等运行状态） */
export const OPENCODE_CACHE_DIR = "node_modules/.cache/opencode";

/** ==================== Provider 专属配置默认值 ==================== */

/** OpenCode Provider 专属配置默认值（插件组装 config 时使用） */
export const DEFAULT_OPENCODE_PROVIDER_OPTIONS: OpenCodeProviderOptions = {
  enableLsp: true,
  enableBlockOnError: false,
  enablePrettier: true,
};
