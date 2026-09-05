/**
 * DeepSeek Harness Provider 专属常量
 * 与 dsh web 绑定的常量自包含于此，核心层不感知。
 */
import type { DeepSeekProviderOptions } from "./types";

/** ==================== dsh API ==================== */

/** dsh 所有 RPC 路径前缀（POST /api/<endpoint>） */
export const DSH_API_BASE = "/api";

/**
 * Remote mux WebSocket 端点（dsh 0.1.2+）。
 * 旧版 /api/events.mux、/api/events.host 与 workspace.list RPC 已移除：
 * 会话/工作区能力改经此 mux 以流方式订阅（workspace/follow baseline、session/follow、
 * 转发事件 $events 等），unary RPC 则保持 POST /api/<endpoint>。
 */
export const DSH_REMOTE_MUX_PATH = "/api/remote.mux";

/** dsh 唯一允许的绑定主机字面量（服务 schema 只接受 127.0.0.1 / 0.0.0.0） */
export const DSH_LOOPBACK_HOST = "127.0.0.1";

/** dsh web 默认端口（未显式指定时） */
export const DSH_DEFAULT_PORT = 3080;

/** ==================== Provider 专属配置默认值 ==================== */

export const DEFAULT_DEEPSEEK_PROVIDER_OPTIONS: DeepSeekProviderOptions = {
  // 对齐 opencode 的 enableLsp（默认 true）：诊断功能默认开启
  enableDiagnostics: true,
  // 对齐 opencode：自动诊断默认开启
  autoDiagnose: true,
};
