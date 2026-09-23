/**
 * 插件通用配置（Provider 无关）
 * Provider 专属配置通过泛型 P 注入，核心层不感知具体 schema。
 */
import type { DisplayMode, LogFileConfig, SplitModeOptions } from "./types";
import { CHROME_DEVTOOLS_PORT, DEFAULT_HOSTNAME, DEFAULT_WEB_PORT } from "./constants";

/**
 * chrome-devtools-mcp 进程的用户透传配置。
 * 只允许“追加”，不允许覆盖核心受保护参数（由 McpProxy 统一过滤）。
 */
export interface ChromeMcpOptions {
  /**
   * 追加的 CLI 参数（先于核心参数注入）。
   * 与核心受保护项（auto-connect / usage-statistics / performance-crux /
   * page-id-routing 及其反义）冲突的参数会被剔除并告警。
   */
  args?: string[];
  /** 透传给 chrome-devtools-mcp 进程的额外环境变量（合并到 process.env 之上） */
  env?: Record<string, string>;
  /** 项目边界策略（默认缺失 = 现状行为） */
  project?: ChromeProjectOptions;
}

/**
 * 项目边界策略（chrome-devtools-mcp 工具层的“本项目内操作”可配选项，默认均为现状）。
 * 所有项只会收窄/放宽我们的边界判定，不改变白名单的权威性。
 */
export interface ChromeProjectOptions {
  /**
   * 白名单条目：除自动项目页外，可开启/可见/可操作的额外页面。每条三种写法：
   * - 精确 origin："https://example.com"（前缀匹配该 origin 下任意路径）
   * - glob 通配符："https://*.example.com/**"（picomatch，* 不跨 /，放开路径需 /**）
   * - 正则字面量："/^https:\\/\\/app\\.example\\.com\\//"（以 / 起止、可带 flags，对完整 URL 匹配）
   */
  allowOrigins?: string[];
  /** 是否允许扩展页（chrome-extension://）纳入可操作页面；启用时自动注入 --experimental-include-all-pages */
  includeExtensionPages?: boolean;
  /** 工具面选择：在默认白名单上按名字调整 */
  tools?: {
    /** 从默认白名单隐藏（如 ["upload_file"]） */
    deny?: string[];
    /** 仅可开启官方二级目录中的工具（如 click_at）；非目录名将被忽略并告警 */
    extra?: string[];
  };
}

/**
 * 插件配置选项
 * @typeParam P - 当前 Provider 的专属配置段（schema 由具体 Provider 声明）
 */
export interface PluginOptions<P extends Record<string, unknown> = Record<string, unknown>> {
  /** 是否启用插件，默认 true */
  enabled?: boolean;
  /** 选择的 Web Provider 标识，默认 "default" */
  provider?: string;
  /** Web 服务端口，默认 5097 */
  webPort?: number;
  /** 代理服务端口，默认 6097 */
  proxyPort?: number;
  /** 服务主机名，默认 '127.0.0.1' */
  hostname?: string;
  /** 挂件位置，默认 'bottom-right' */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** 主题模式，默认 'dark' */
  theme?: "light" | "dark" | "auto";
  /** 是否自动打开面板，默认 false */
  open?: boolean;
  /** 是否输出详细日志，默认 false */
  verbose?: boolean;
  /** 纯净 MCP 模式：只暴露 MCP 工具服务，不注入挂件、不启动 provider Web 进程，默认为 false */
  mcpOnly?: boolean;
  /** 快捷键配置，默认 'ctrl+k' */
  hotkey?: string;
  /** 服务启动后是否立即预热 Chrome MCP，默认 true */
  warmupChromeMcp?: boolean;
  /** Chrome DevTools Protocol 端口，默认 9222 */
  chromeDevtoolsPort?: number;
  /** chrome-devtools-mcp 进程透传配置（只可追加，不可覆盖核心受保护参数） */
  chromeMcp?: ChromeMcpOptions;
  /** 展示模式，默认 'bubble' */
  displayMode?: DisplayMode;
  /** 分屏模式配置 */
  splitMode?: SplitModeOptions;
  /** 自定义日志文件配置，为 Agent 提供查看外部服务日志的能力 */
  logFiles?: LogFileConfig[];
  /** Provider 专属配置段（schema 由具体 Provider 声明，核心层不感知） */
  providerOptions?: P;

  // === 以下为兼容旧配置的宽松 deprecated 字段 ===
  /** @deprecated 使用 providerOptions.language */
  language?: string;
  /** @deprecated 使用 providerOptions.settings */
  settings?: unknown;
  /** @deprecated 使用 providerOptions.enablePrettier */
  enablePrettier?: boolean;
}

/** 插件通用配置默认值（Provider 无关部分） */
export const DEFAULT_PLUGIN_OPTIONS: Partial<PluginOptions> = {
  enabled: true,
  provider: "default",
  webPort: DEFAULT_WEB_PORT,
  hostname: DEFAULT_HOSTNAME,
  theme: "dark",
  open: false,
  verbose: false,
  mcpOnly: false,
  hotkey: "ctrl+k",
  warmupChromeMcp: true,
  chromeDevtoolsPort: CHROME_DEVTOOLS_PORT,
  displayMode: "extension",
  splitMode: undefined,
  providerOptions: undefined,
};

/**
 * 组装运行时配置（通用默认 + 用户配置）
 * Provider 专属段原样合并透传，schema 由 Provider 自行解析；
 * deprecated 顶层字段不在此迁移，保留在 config 顶层，由 Provider 读取兜底。
 */
export function resolvePluginConfig<P extends Record<string, unknown> = Record<string, unknown>>(
  options: PluginOptions<P> = {},
): Required<PluginOptions<P>> {
  return {
    ...DEFAULT_PLUGIN_OPTIONS,
    ...options,
    providerOptions: {
      ...(options.providerOptions ?? {}),
    } as P,
  } as Required<PluginOptions<P>>;
}
