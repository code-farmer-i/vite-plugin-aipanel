import { ServiceStartupTask } from "@vite-plugin-opencode-assistant/shared";
import { SSE_EVENTS_PATH } from "@vite-plugin-opencode-assistant/shared";
import { useSSE } from "./useSSE";

/**
 * Server SSE 状态同步数据
 */
export interface ServerSSEStatusSyncData {
  type: "STATUS_SYNC";
  isStarted?: boolean;
  task: ServiceStartupTask;
  errorType?: string;
  errorMessage?: string;
}

/**
 * Server SSE 任务更新数据
 */
export interface ServerSSETaskUpdateData {
  type: "TASK_UPDATE";
  task: ServiceStartupTask;
  errorType?: string;
  errorMessage?: string;
}

/**
 * Server SSE 消息类型
 */
export type ServerSSEMessage =
  | { type: "CONNECTED" }
  | ServerSSEStatusSyncData
  | ServerSSETaskUpdateData
  | { type: "CLEAR_ELEMENTS" };

/**
 * Server SSE 配置选项
 */
export interface ServerSSEOptions {
  /** Vite 服务 base URL (如 http://127.0.0.1:5099) */
  viteBaseUrl?: string;
  /** 状态同步回调 */
  onStatusSync?: (data: ServerSSEStatusSyncData) => void;
  /** 任务更新回调 */
  onTaskUpdate?: (data: ServerSSETaskUpdateData) => void;
  /** 清除元素回调 */
  onClearElements?: () => void;
  /** 连接成功回调 */
  onConnected?: () => void;
  /** 连接断开回调（重试耗尽且曾连接成功） */
  onDisconnected?: () => void;
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 监听 Vite Server SSE 事件
 * 端点: /__opencode_events__
 */
export function useServerSSE(options: ServerSSEOptions = {}) {
  const {
    viteBaseUrl = "",
    onStatusSync,
    onTaskUpdate,
    onClearElements,
    onConnected,
    onDisconnected,
  } = options;

  const endpoint = viteBaseUrl ? `${viteBaseUrl}${SSE_EVENTS_PATH}` : SSE_EVENTS_PATH;

  const { status, isConnected, connect, disconnect } = useSSE({
    endpoint,
    autoConnect: false,
    onDisconnected: () => {
      console.debug("[ServerSSE] disconnected (retries exhausted):", endpoint);
      onDisconnected?.();
    },
    onMessage: (data) => {
      const message = data as ServerSSEMessage;

      switch (message.type) {
        case "CONNECTED":
          console.debug("[ServerSSE] CONNECTED message received:", endpoint);
          onConnected?.();
          break;
        case "STATUS_SYNC":
          onStatusSync?.(message);
          break;
        case "TASK_UPDATE":
          onTaskUpdate?.(message);
          break;
        case "CLEAR_ELEMENTS":
          onClearElements?.();
          break;
      }
    },
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
