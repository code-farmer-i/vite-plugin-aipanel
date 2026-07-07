import { ref, computed, onUnmounted, type Ref } from "vue";

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * SSE 连接状态
 */
export type SSEConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

/**
 * SSE 配置选项
 */
export interface SSEOptions {
  /** SSE 端点 URL */
  endpoint: string;
  /** 是否自动连接 */
  autoConnect?: boolean;
  /** 是否启用 (响应式) */
  enabled?: Ref<boolean>;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试延迟基数 (ms) */
  retryDelay?: number;
  /** 连接成功回调 */
  onConnected?: () => void;
  /** 连接断开回调 */
  onDisconnected?: () => void;
  /** 连接错误回调 */
  onError?: (error: Error) => void;
  /** 消息处理回调 */
  onMessage?: (data: unknown) => void;
}

/**
 * 通用 SSE 连接管理
 * 提供基础的连接、重连、状态管理功能
 */
export function useSSE(options: SSEOptions) {
  const {
    endpoint,
    autoConnect = true,
    enabled,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    onConnected,
    onDisconnected,
    onError,
    onMessage,
  } = options;

  const connection = ref<EventSource | null>(null);
  const status = ref<SSEConnectionStatus>("idle");
  const retryCount = ref(0);

  /**
   * 处理 SSE 消息
   */
  function handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      onMessage?.(data);
    } catch {
      // 非 JSON 数据，直接传递原始数据
      onMessage?.(event.data);
    }
  }

  /**
   * 建立 SSE 连接
   */
  function connect(): void {
    // 防止重复连接：如果已连接或正在连接中，直接返回
    if (connection.value || status.value === "connecting") {
      return;
    }

    if (enabled?.value === false) {
      status.value = "idle";
      return;
    }

    status.value = "connecting";
    retryCount.value = 0;

    try {
      connection.value = new EventSource(endpoint);

      connection.value.onopen = () => {
        status.value = "connected";
        retryCount.value = 0;
        onConnected?.();
      };

      connection.value.onmessage = handleMessage;

      connection.value.onerror = () => {
        const wasConnected = status.value === "connected";
        status.value = "error";
        connection.value?.close();
        connection.value = null;

        const error = new Error(`SSE connection error: ${endpoint}`);
        onError?.(error);

        // 自动重试逻辑
        if (retryCount.value < maxRetries) {
          retryCount.value++;
          const delay = retryDelay * retryCount.value;
          setTimeout(() => {
            // 只有在没有现有连接时才重试
            if (enabled?.value !== false && !connection.value) {
              connect();
            }
          }, delay);
        } else if (wasConnected) {
          onDisconnected?.();
        }
      };
    } catch (e) {
      status.value = "error";
      const error = e instanceof Error ? e : new Error(String(e));
      onError?.(error);

      // 自动重试
      if (retryCount.value < maxRetries) {
        retryCount.value++;
        const delay = retryDelay * retryCount.value;
        setTimeout(() => {
          // 只有在没有现有连接时才重试
          if (!connection.value) {
            connect();
          }
        }, delay);
      }
    }
  }

  /**
   * 断开 SSE 连接
   */
  function disconnect(): void {
    if (connection.value) {
      connection.value.close();
      connection.value = null;
      status.value = "disconnected";
      retryCount.value = 0;
      onDisconnected?.();
    }
  }

  /**
   * 重置连接 (先断开后连接)
   */
  function reconnect(): void {
    disconnect();
    connect();
  }

  /**
   * 清除重试计数
   */
  function resetRetryCount(): void {
    retryCount.value = 0;
  }

  // 自动连接
  if (autoConnect && enabled?.value !== false) {
    connect();
  }

  // 生命周期
  onUnmounted(() => {
    disconnect();
  });

  return {
    // 状态
    connection,
    status,
    retryCount,
    isConnected: computed(() => status.value === "connected"),
    isConnecting: computed(() => status.value === "connecting"),

    // 方法
    connect,
    disconnect,
    reconnect,
    resetRetryCount,
  };
}