/**
 * DeepSeek Harness Web Provider
 * 实现 WebProvider 契约：进程管理、RPC 会话 API、dsh 侧插件编排、CLI 环境检查。
 * dsh 专属常量自持，类型一律引用官方声明。
 */
import type { ProviderInitContext, WebProvider } from "@aipanel/core";
import { DeepSeekWebProvider } from "./provider";
import { DSH_LOOPBACK_HOST } from "./constants";

/** 约定工厂：核心层动态加载本包后调用，初始化动作完全由 Provider 定义 */
export function createProvider(ctx: ProviderInitContext): WebProvider {
  return new DeepSeekWebProvider(
    { hostname: DSH_LOOPBACK_HOST },
    { getWebPort: ctx.getWebPort, getProxyPort: ctx.getProxyPort },
    ctx.options,
  );
}

export { DeepSeekAPI } from "./api";
export type { DeepSeekWebProviderConfig, DeepSeekWebProviderDeps } from "./provider";
export { startDeepSeekWeb, type DeepSeekWebOptions } from "./deepseek-web";
export { buildDshOverlay, writeDshOverlay } from "./profile";
export { checkDeepSeekInstalled, getDeepSeekVersion, killOrphanDeepSeekProcesses } from "./system";
export {
  DEFAULT_DEEPSEEK_PROVIDER_OPTIONS,
  DSH_LOOPBACK_HOST,
  DSH_DEFAULT_PORT,
} from "./constants";
export type { DeepSeekProviderOptions, DeepSeekPermissionPreset, DeepSeekBusyEnter } from "./types";
export type { ClientRequest, RpcMessage, ServerResponse } from "@deepseek-ai/dsh-client-connection";
export type {
  SessionCreateValue,
  SessionListValue,
  SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/types";
export type {
  WorkspaceBaseline,
  WorkspaceCreateValue,
  WorkspaceView,
} from "@deepseek-ai/dsh-api-workspace-controller/types";
