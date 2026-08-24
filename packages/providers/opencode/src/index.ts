/**
 * OpenCode Web Provider
 * 实现 WebProvider 契约：进程管理、REST 会话 API、桥接脚本、CLI 环境检查。
 * 所有 OpenCode 专属类型与常量自包含于此包。
 */
import type { ProviderInitContext, WebProvider } from "@aipanel/core";
import { DefaultWebProvider } from "./provider";

/** 约定工厂：核心层动态加载本包后调用，初始化动作完全由 Provider 定义 */
export function createProvider(ctx: ProviderInitContext): WebProvider {
  return new DefaultWebProvider(
    { hostname: ctx.hostname, chromeDevtoolsPort: ctx.chromeDevtoolsPort },
    { getWebPort: ctx.getWebPort, getProxyPort: ctx.getProxyPort },
    ctx.options,
  );
}

export { OpenCodeAPI } from "./api";
export type { DefaultWebProviderConfig, DefaultWebProviderDeps } from "./provider";
export { prepareOpenCodeRuntime, startOpenCodeWeb } from "./opencode-web";
export { generateBridgeScript, type BridgeScriptOptions } from "./bridge-script";
export { checkOpenCodeInstalled, getOpenCodeVersion, killOrphanOpenCodeProcesses } from "./system";
export { DEFAULT_OPENCODE_PROVIDER_OPTIONS } from "./constants";
export type {
  OpenCodeProviderOptions,
  OpenCodeLanguage,
  OpenCodeSettings,
  SessionInfo,
  WebOptions,
} from "./types";
