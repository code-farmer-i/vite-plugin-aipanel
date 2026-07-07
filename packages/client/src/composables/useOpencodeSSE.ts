import { type Ref } from "vue";
import { useSSE } from "./useSSE";

/**
 * OpenCode SSE 事件 payload
 */
export interface OpencodeSSEPayload {
  type: string;
  properties: {
    sessionID?: string;
    status?: { type: string };
    info?: {
      sessionID?: string;
      role?: string;
      // time 字段在不同事件中有不同结构
      // message.updated: { completed?: number }
      // session.updated: { created?: number; updated?: number; archived?: number; compacting?: number }
      time?: {
        completed?: number;
        created?: number;
        updated?: number;
        archived?: number;
        compacting?: number;
      };
      // session.updated 事件中的 session 信息
      title?: string;
      id?: string;
      summary?: {
        additions?: number;
        deletions?: number;
        files?: number;
      };
    };
    [key: string]: unknown;
  };
}

/**
 * OpenCode SSE 消息结构
 */
export interface OpencodeSSEMessage {
  payload: OpencodeSSEPayload;
}

/**
 * OpenCode SSE 配置选项
 */
export interface OpencodeSSEOptions {
  /** OpenCode proxy 基础 URL (例如: http://localhost:4098/xxx) */
  proxyBaseUrl: string;
  /** 是否启用 */
  enabled?: Ref<boolean>;
  /** 事件处理器 */
  onEvent?: (payload: OpencodeSSEPayload) => void;
  /** 连接成功回调 */
  onConnected?: () => void;
  /** 连接错误回调 */
  onError?: (error: Error) => void;
}

/**
 * 监听 OpenCode SSE 事件
 * 端点: /global/event (通过 proxy server)
 * 只负责连接管理和消息分发，不包含业务逻辑
 */
export function useOpencodeSSE(options: OpencodeSSEOptions) {
  const { proxyBaseUrl, enabled, onEvent, onConnected, onError } = options;

  // SSE endpoint: /global/event
  const endpoint = `${proxyBaseUrl}/global/event`;

  const { status, isConnected, connect, disconnect } = useSSE({
    endpoint,
    autoConnect: false,
    enabled,
    onMessage: (data) => {
      const message = data as OpencodeSSEMessage;
      const payload = message.payload;

      if (!payload) return;

      // 分发事件给处理器
      onEvent?.(payload);
    },
    onConnected,
    onError,
  });

  return {
    // 状态
    status,
    isConnected,

    // 方法
    connect,
    disconnect,
  };
}