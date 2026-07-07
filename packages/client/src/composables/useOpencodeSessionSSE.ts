import { ref, computed, type Ref, type ComputedRef } from "vue";
import {
  useOpencodeSSE,
  type OpencodeSSEPayload,
} from "./useOpencodeSSE";

/**
 * Session 状态类型
 */
export type OpencodeSessionStatusType = "idle" | "running" | "streaming" | "completed";

/**
 * Session 思考状态
 */
export interface OpencodeSessionThinkingState {
  thinking: boolean;
  statusType: OpencodeSessionStatusType;
  hasPending: boolean;
}

/**
 * Session 更新事件数据
 */
export interface OpencodeSessionUpdateData {
  id: string;
  title?: string;
  time?: {
    created?: number;
    updated?: number;
    archived?: number;
    compacting?: number;
  };
  summary?: {
    additions?: number;
    deletions?: number;
    files?: number;
  };
}

/**
 * OpenCode Session SSE 配置选项
 */
export interface OpencodeSessionSSEOptions {
  /** OpenCode proxy 基础 URL */
  proxyBaseUrl: string;
  /** 当前 session ID (响应式) */
  currentSessionId: Ref<string | null>;
  /** 是否启用 */
  enabled?: Ref<boolean>;
  /** 连接成功回调 */
  onConnected?: () => void;
  /** Session 更新回调 (包括标题变化) */
  onSessionUpdate?: (session: OpencodeSessionUpdateData) => void;
}

/**
 * 监听 OpenCode Session SSE 事件
 * 专注于 session thinking 状态管理和标题更新
 */
export function useOpencodeSessionSSE(options: OpencodeSessionSSEOptions) {
  const { proxyBaseUrl, currentSessionId, enabled, onConnected, onSessionUpdate } = options;

  // 所有 session 的状态映射
  const sessionStates = ref<Record<string, OpencodeSessionThinkingState>>({});

  /**
   * 判断消息是否为未完成的 assistant 消息
   */
  function isPendingMessage(
    info: OpencodeSSEPayload["properties"]["info"],
  ): boolean {
    return info?.role === "assistant" && typeof info?.time?.completed !== "number";
  }

  /**
   * 更新 session 思考状态
   */
  function updateThinkingState(sessionID: string): void {
    const state = sessionStates.value[sessionID];
    const isThinking = state?.hasPending || state?.statusType !== "idle";

    sessionStates.value[sessionID] = {
      thinking: isThinking,
      statusType: state?.statusType || "idle",
      hasPending: state?.hasPending || false,
    };
  }

  /**
   * 处理 OpenCode 原生事件，更新 sessionStates 和 session 信息
   */
  function handleEvent(payload: OpencodeSSEPayload): void {
    const type = payload.type;
    const props = payload.properties;

    switch (type) {
      case "session.updated": {
        const info = props.info;
        if (!info?.id) return;

        // 调用 session 更新回调，包括标题变化
        onSessionUpdate?.({
          id: info.id,
          title: info.title,
          time: info.time,
          summary: info.summary,
        });
        break;
      }

      case "session.status": {
        const sessionID = props.sessionID;
        if (!sessionID) return;

        const statusType = (props.status?.type || "idle") as OpencodeSessionStatusType;
        sessionStates.value[sessionID] = {
          thinking: statusType !== "idle",
          statusType,
          hasPending: false,
        };
        updateThinkingState(sessionID);
        break;
      }

      case "message.updated": {
        const info = props.info;
        if (!info?.sessionID) return;
        const sessionID = info.sessionID;

        if (info.role === "assistant") {
          const hasPending = isPendingMessage(info);
          const current = sessionStates.value[sessionID] || {
            thinking: false,
            statusType: "idle",
            hasPending: false,
          };

          sessionStates.value[sessionID] = {
            ...current,
            hasPending,
          };
          updateThinkingState(sessionID);
        }
        break;
      }

      case "message.part.delta": {
        const sessionID = props.sessionID;
        if (!sessionID) return;

        const current = sessionStates.value[sessionID];
        if (!current?.hasPending) {
          sessionStates.value[sessionID] = {
            thinking: true,
            statusType: current?.statusType || "idle",
            hasPending: true,
          };
        }
        break;
      }
    }
  }

  // 使用 useOpencodeSSE 建立连接
  const sse = useOpencodeSSE({
    proxyBaseUrl,
    enabled,
    onEvent: handleEvent,
    onConnected,
  });

  /**
   * 当前 session 的 thinking 状态
   */
  const currentThinking: ComputedRef<boolean> = computed(() => {
    const id = currentSessionId.value;
    if (!id) return false;
    return sessionStates.value[id]?.thinking ?? false;
  });

  /**
   * 当前 session 的完整状态
   */
  const currentSessionState: ComputedRef<OpencodeSessionThinkingState | null> =
    computed(() => {
      const id = currentSessionId.value;
      if (!id) return null;
      return sessionStates.value[id] || null;
    });

  /**
   * 判断任意 session 是否正在思考
   */
  const hasAnyThinking: ComputedRef<boolean> = computed(() => {
    return Object.values(sessionStates.value).some((state) => state.thinking);
  });

  /**
   * 获取正在思考的 session 数量
   */
  const thinkingSessionCount: ComputedRef<number> = computed(() => {
    return Object.values(sessionStates.value).filter((state) => state.thinking).length;
  });

  /**
   * 清除指定 session 状态
   */
  function clearSessionState(sessionID: string): void {
    delete sessionStates.value[sessionID];
  }

  /**
   * 清除所有 session 状态
   */
  function clearAllSessionStates(): void {
    sessionStates.value = {};
  }

  /**
   * 获取指定 session 的状态
   */
  function getSessionState(sessionID: string): OpencodeSessionThinkingState | undefined {
    return sessionStates.value[sessionID];
  }

  /**
   * 判断指定 session 是否正在思考
   */
  function isSessionThinking(sessionID: string): boolean {
    return sessionStates.value[sessionID]?.thinking ?? false;
  }

  /**
   * 批量判断 sessions 是否正在思考
   */
  function getSessionsThinking(sessionIds: string[]): Record<string, boolean> {
    return sessionIds.reduce(
      (acc, id) => {
        acc[id] = isSessionThinking(id);
        return acc;
      },
      {} as Record<string, boolean>,
    );
  }

  return {
    // SSE 基础状态
    status: sse.status,
    isConnected: sse.isConnected,

    // session 状态
    sessionStates,
    currentThinking,
    currentSessionState,
    hasAnyThinking,
    thinkingSessionCount,

    // 方法
    connect: sse.connect,
    disconnect: sse.disconnect,
    clearSessionState,
    clearAllSessionStates,
    getSessionState,
    isSessionThinking,
    getSessionsThinking,
  };
}