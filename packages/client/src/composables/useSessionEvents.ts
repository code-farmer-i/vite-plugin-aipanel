import { computed, getCurrentScope, ref, watch, type ComputedRef, type Ref } from "vue";
import type {
  AIPanelSessionStatusType,
  AIPanelSessionThinkingState,
  ProviderEvent,
} from "@aipanel/core";

/**
 * 会话更新数据（标题/时间变化）
 */
export interface SessionEventUpdate {
  id: string;
  title?: string;
  time?: {
    created?: number;
    updated?: number;
  };
}

/**
 * 消费 Provider 归一化事件（SESSION_EVENT）的会话状态
 * 事件由 useServerSSE 的 onSessionEvent 转发进来
 */
export interface UseSessionEventsOptions {
  /** 当前 session ID (响应式) */
  currentSessionId: Ref<string | null>;
  /** Session 更新回调（标题变化等） */
  onSessionUpdate?: (session: SessionEventUpdate) => void;
}

/**
 * 视为"正在处理"的会话状态（thinking 指示器应保持的集合）。
 * 终态/空闲（completed / idle）均复位 thinking=false，避免 UI 动画悬挂。
 * 集合语义对齐 core SessionStatus 联合（"idle" | "running" | "streaming" | "completed"）。
 */
const ACTIVE_SESSION_STATUSES: ReadonlySet<AIPanelSessionStatusType> = new Set([
  "running",
  "streaming",
]);

export function useSessionEvents(options: UseSessionEventsOptions) {
  const { currentSessionId, onSessionUpdate } = options;

  // 所有 session 的状态映射
  const sessionStates = ref<Record<string, AIPanelSessionThinkingState>>({});

  /** 每个会话上一次的 running 位（completed 边沿推导用；对齐官方 completedNotifications 语义） */
  const prevRunning = new Map<string, boolean>();

  /** 空态兜底：新会话的初始状态 */
  const emptyState = (): AIPanelSessionThinkingState => ({
    thinking: false,
    statusType: "idle",
    hasPending: false,
  });

  /** 取当前状态对象（无则空态） */
  const stateOf = (sessionId: string): AIPanelSessionThinkingState =>
    sessionStates.value[sessionId] || emptyState();

  /**
   * 更新单个会话状态：整体替换 ref 对象（而非改内部属性）。
   * 保证 App.vue → widget props → context 的传递链必然收到引用变化并触发渲染。
   */
  const setSessionState = (sessionId: string, next: AIPanelSessionThinkingState): void => {
    sessionStates.value = { ...sessionStates.value, [sessionId]: next };
  };

  /**
   * 会话进入"当前选中"：清除其 completed 提醒（对齐官方 open/select 后
   * completedNotifications.delete；用户看到即不再提示）。
   */
  function markSessionActive(sessionId: string): void {
    const state = sessionStates.value[sessionId];
    if (state?.completed === true) {
      const next = { ...state };
      delete next.completed;
      setSessionState(sessionId, next);
    }
  }

  /**
   * 处理归一化后的 Provider 事件
   */
  function handleEvent(event: ProviderEvent): void {
    switch (event.type) {
      case "session.updated": {
        const s = event.session;
        onSessionUpdate?.({
          id: s.id,
          title: s.title,
          time: { created: s.createdAt, updated: s.updatedAt },
        });
        break;
      }
      case "session.status": {
        const sessionId = event.sessionId;
        const statusType = event.status;
        const running = ACTIVE_SESSION_STATUSES.has(statusType);
        const wasRunning = prevRunning.get(sessionId) === true;
        prevRunning.set(sessionId, running);

        const current = stateOf(sessionId);
        const next: AIPanelSessionThinkingState = {
          ...current,
          thinking: running,
          statusType,
        };
        // completed 边沿推导（对齐官方）：running → 非 running（idle/completed）
        // 且该会话非当前选中时置提醒；否则清除（再次运行/当前会话跑完不提醒）。
        if (!running && wasRunning) {
          if (sessionId !== currentSessionId.value) next.completed = true;
        } else if (running) {
          delete next.completed;
        }
        setSessionState(sessionId, next);
        break;
      }
      case "session.subagents": {
        const sessionId = event.sessionId;
        const current = stateOf(sessionId);
        const next: AIPanelSessionThinkingState = { ...current, subagentsRunning: event.running };
        if (event.running <= 0) delete next.subagentsRunning;
        // 父会话自身 idle 但子代理在跑：thinking/statusType 不据此误置 running，
        // 由 UI 用 subagentsRunning 单独识别；completed 提醒在子代理期间不应出现。
        if (event.running > 0) delete next.completed;
        setSessionState(sessionId, next);
        break;
      }
      case "session.pending": {
        const sessionId = event.sessionId;
        const current = stateOf(sessionId);
        const next: AIPanelSessionThinkingState = {
          ...current,
          hasPending: event.pending,
        };
        if (event.pending) {
          next.pendingKind = event.kind ?? "question";
        } else {
          delete next.pendingKind;
        }
        setSessionState(sessionId, next);
        break;
      }
      case "thinking": {
        const current = stateOf(event.sessionId);
        setSessionState(event.sessionId, {
          ...current,
          thinking: event.thinking,
        });
        break;
      }
      case "connected":
        break;
    }
  }

  // 当前会话变化 → 清除该会话的 completed（用户已查看）。仅在组件作用域注册 watch，
  // 单元测试（无 effect scope）不注册，直接走 markSessionActive/事件推导。
  if (getCurrentScope()) {
    watch(
      currentSessionId,
      (id) => {
        if (id) markSessionActive(id);
      },
      { immediate: true },
    );
  }

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
  const currentSessionState: ComputedRef<AIPanelSessionThinkingState | null> = computed(() => {
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
   * 清除指定 session 状态（含边沿推导用的 running 位）
   */
  function clearSessionState(sessionID: string): void {
    if (sessionStates.value[sessionID] === undefined) return;
    const next = { ...sessionStates.value };
    delete next[sessionID];
    sessionStates.value = next;
    prevRunning.delete(sessionID);
  }

  /**
   * 清除所有 session 状态（含边沿推导用的 running 位）
   */
  function clearAllSessionStates(): void {
    sessionStates.value = {};
    prevRunning.clear();
  }

  return {
    sessionStates,
    currentThinking,
    currentSessionState,
    hasAnyThinking,
    thinkingSessionCount,
    handleEvent,
    clearSessionState,
    clearAllSessionStates,
    markSessionActive,
  };
}
