/**
 * DeepSeek Harness Provider 专属常量
 * 与 dsh web 绑定的常量自包含于此，核心层不感知。
 */
import type { DeepSeekProviderOptions } from "./types";

/** ==================== dsh API ==================== */

/** dsh 所有 RPC 路径前缀（POST /api/<method>、GET /api/events.mux） */
export const DSH_API_BASE = "/api";

/** mux 事件流端点（会话级聚合流，含 session/event 可推导 thinking/streaming） */
export const DSH_MUX_EVENTS_PATH = "/api/events.mux";

/** host 事件流端点（host 级，含 host/session-status.running 运行态开关） */
export const DSH_HOST_EVENTS_PATH = "/api/events.host";

/** dsh 唯一允许的绑定主机字面量（服务 schema 只接受 127.0.0.1 / 0.0.0.0） */
export const DSH_LOOPBACK_HOST = "127.0.0.1";

/** dsh web 默认端口（未显式指定时） */
export const DSH_DEFAULT_PORT = 3080;

/** ==================== dsh localStorage 键 ==================== */

export const DSH_STORAGE_KEYS = {
  /** 当前选中会话（SPA 启动时据此恢复选中，无 URL 深链） */
  CURRENT_SESSION: "dsh.sessions.current",
  /** 选中的页面元素（bridge 写入，dsh-client 的 @aipanel source 读取） */
  SELECTION: "dsh.bridge.selection",
} as const;

/** ==================== Provider 专属配置默认值 ==================== */

export const DEFAULT_DEEPSEEK_PROVIDER_OPTIONS: DeepSeekProviderOptions = {
  agentPreset: "code",
};
