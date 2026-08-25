/**
 * 插件通用配置（Provider 无关）
 * Provider 专属配置通过泛型 P 注入，核心层不感知具体 schema。
 */
import type { DisplayMode, LogFileConfig, SplitModeOptions } from "./types";
import { CHROME_DEVTOOLS_PORT, DEFAULT_HOSTNAME, DEFAULT_WEB_PORT } from "./constants";

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
  /** @deprecated 使用 providerOptions.enableLsp */
  enableLsp?: boolean;
  /** @deprecated 使用 providerOptions.enableBlockOnError */
  enableBlockOnError?: boolean;
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
