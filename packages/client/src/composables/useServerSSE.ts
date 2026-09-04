import {
  ServiceStartupTask,
  SSE_EVENTS_PATH,
  type ProviderEvent,
} from "@aipanel/core";
import { createLogger } from "@aipanel/core/client";
import { useSSE } from "./useSSE";

const log = createLogger("ServerSSE");

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
 * Server SSE 会话事件数据（Provider 归一化事件）
 */
export interface ServerSSESessionEventData {
  type: "SESSION_EVENT";
  event: ProviderEvent;
}

/**
 * Server SSE 消息类型
 */
export type ServerSSEMessage =
  | { type: "CONNECTED" }
  | ServerSSEStatusSyncData
  | ServerSSETaskUpdateData
  | ServerSSESessionEventData
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
  /** 会话事件回调（Provider 归一化事件） */
  onSessionEvent?: (event: ProviderEvent) => void;
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
 * 端点: /__aipanel_events__
 */
export function useServerSSE(options: ServerSSEOptions = {}) {
  const {
    viteBaseUrl = "",
    onStatusSync,
    onTaskUpdate,
    onSessionEvent,
    onClearElements,
    onConnected,
    onDisconnected,
  } = options;

  const endpoint = viteBaseUrl ? `${viteBaseUrl}${SSE_EVENTS_PATH}` : SSE_EVENTS_PATH;

  const { status, isConnected, connect, disconnect } = useSSE({
    endpoint,
    autoConnect: false,
    onDisconnected: () => {
      log.debug(`disconnected (retries exhausted): ${endpoint}`);
      onDisconnected?.();
    },
    onMessage: (data) => {
      const message = data as ServerSSEMessage;

      switch (message.type) {
        case "CONNECTED":
          log.debug(`CONNECTED message received: ${endpoint}`);
          onConnected?.();
          break;
        case "STATUS_SYNC":
          onStatusSync?.(message);
          break;
        case "TASK_UPDATE":
          onTaskUpdate?.(message);
          break;
        case "SESSION_EVENT":
          onSessionEvent?.(message.event);
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
