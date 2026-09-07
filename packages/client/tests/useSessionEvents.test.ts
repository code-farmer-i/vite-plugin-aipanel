/**
 * useSessionEvents 单元测试
 * 覆盖：session.status / thinking / session.updated / connected 事件处理、
 * currentThinking / currentSessionState / hasAnyThinking / thinkingSessionCount 计算、
 * clearSessionState / clearAllSessionStates。无生命周期钩子，直接调用。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ref } from "vue";
import { useSessionEvents } from "../src/composables/useSessionEvents";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSessionEvents", () => {
  it("初始：无当前会话时为 false / null / 0", () => {
    const currentSessionId = ref<string | null>(null);
    const api = useSessionEvents({ currentSessionId });
    expect(api.currentThinking.value).toBe(false);
    expect(api.currentSessionState.value).toBeNull();
    expect(api.hasAnyThinking.value).toBe(false);
    expect(api.thinkingSessionCount.value).toBe(0);
  });

  it("session.status：仅进行中（running/streaming）置 thinking；completed/idle 复位", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "running" });
    expect(api.sessionStates.value.s1).toEqual({
      thinking: true,
      statusType: "running",
      hasPending: false,
    });
    expect(api.currentThinking.value).toBe(true);
    expect(api.hasAnyThinking.value).toBe(true);
    expect(api.thinkingSessionCount.value).toBe(1);
    expect(api.currentSessionState.value?.statusType).toBe("running");

    // 终态 completed：状态类型切换为 completed，同时复位 thinking（结束即不再"思考中"）
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "completed" });
    expect(api.sessionStates.value.s1.statusType).toBe("completed");
    expect(api.sessionStates.value.s1.thinking).toBe(false);
    expect(api.currentThinking.value).toBe(false);
    expect(api.hasAnyThinking.value).toBe(false);

    // streaming 仍属进行中
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "streaming" });
    expect(api.sessionStates.value.s1.thinking).toBe(true);

    // idle 复位
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "idle" });
    expect(api.sessionStates.value.s1.thinking).toBe(false);
    expect(api.currentThinking.value).toBe(false);
  });

  it("thinking 事件只更新 thinking 字段，保留既有状态", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "streaming" });
    api.handleEvent({ type: "thinking", sessionId: "s1", thinking: false });
    expect(api.sessionStates.value.s1).toEqual({
      thinking: false,
      statusType: "streaming",
      hasPending: false,
    });
    // 未知会话的 thinking 事件也安全创建
    api.handleEvent({ type: "thinking", sessionId: "s9", thinking: true });
    expect(api.sessionStates.value.s9.thinking).toBe(true);
    expect(api.thinkingSessionCount.value).toBe(1);
  });

  it("session.updated 通过 onSessionUpdate 回调透出会话元数据", () => {
    const currentSessionId = ref<string | null>(null);
    const onSessionUpdate = vi.fn();
    const api = useSessionEvents({ currentSessionId, onSessionUpdate });
    api.handleEvent({
      type: "session.updated",
      session: { id: "s1", title: "新标题", createdAt: 1, updatedAt: 2 },
    });
    expect(onSessionUpdate).toHaveBeenCalledTimes(1);
    expect(onSessionUpdate).toHaveBeenCalledWith({
      id: "s1",
      title: "新标题",
      time: { created: 1, updated: 2 },
    });
  });

  it("connected 事件不产生副作用", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "connected" });
    expect(api.sessionStates.value).toEqual({});
    expect(api.hasAnyThinking.value).toBe(false);
  });

  it("clearSessionState 与 clearAllSessionStates 清理状态", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "running" });
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "streaming" });
    expect(api.thinkingSessionCount.value).toBe(2);

    api.clearSessionState("s1");
    expect(api.sessionStates.value.s1).toBeUndefined();
    expect(api.currentThinking.value).toBe(false);
    expect(api.thinkingSessionCount.value).toBe(1);

    api.clearAllSessionStates();
    expect(api.sessionStates.value).toEqual({});
    expect(api.thinkingSessionCount.value).toBe(0);
  });

  it("currentSessionState 对未知当前会话返回 null", () => {
    const currentSessionId = ref<string | null>("missing");
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "running" });
    expect(api.currentSessionState.value).toBeNull();
  });

  it("completed：非当前会话 running→idle 边沿置位；当前会话自身/再次运行不置位", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });

    // 非当前会话 s2 从 running → idle：置 completed 提醒
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "running" });
    expect(api.sessionStates.value.s2.completed).toBeUndefined();
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "idle" });
    expect(api.sessionStates.value.s2.completed).toBe(true);

    // 当前会话 s1 自身 idle：不置 completed（对齐官方：selected 会话不提醒）
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "running" });
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "idle" });
    expect(api.sessionStates.value.s1.completed).toBeUndefined();

    // 再次 running 清除 completed
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "running" });
    expect(api.sessionStates.value.s2.completed).toBeUndefined();
  });

  it("completed：非当前会话由 completed 状态（非 idle）到达也走边沿", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "running" });
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "completed" });
    expect(api.sessionStates.value.s2.completed).toBe(true);
    expect(api.sessionStates.value.s2.thinking).toBe(false);
  });

  it("markSessionActive 清除 completed（对齐官方 select 后完成提醒消失）", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "running" });
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "idle" });
    expect(api.sessionStates.value.s2.completed).toBe(true);

    api.markSessionActive("s2");
    expect(api.sessionStates.value.s2.completed).toBeUndefined();
    // 其它字段保留
    expect(api.sessionStates.value.s2.statusType).toBe("idle");
  });

  it("session.pending：置位/清除 pending 与 kind，且不破坏 thinking 字段", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "session.status", sessionId: "s1", status: "running" });

    api.handleEvent({ type: "session.pending", sessionId: "s1", pending: true, kind: "approval" });
    expect(api.sessionStates.value.s1.hasPending).toBe(true);
    expect(api.sessionStates.value.s1.pendingKind).toBe("approval");
    expect(api.sessionStates.value.s1.thinking).toBe(true); // 不被 pending 覆盖

    api.handleEvent({ type: "session.pending", sessionId: "s1", pending: false });
    expect(api.sessionStates.value.s1.hasPending).toBe(false);
    expect(api.sessionStates.value.s1.pendingKind).toBeUndefined();
    expect(api.sessionStates.value.s1.thinking).toBe(true);
  });

  it("session.pending：无 kind 时兜底为 question；未知会话安全创建", () => {
    const currentSessionId = ref<string | null>(null);
    const api = useSessionEvents({ currentSessionId });
    api.handleEvent({ type: "session.pending", sessionId: "s9", pending: true });
    expect(api.sessionStates.value.s9.hasPending).toBe(true);
    expect(api.sessionStates.value.s9.pendingKind).toBe("question");
  });

  it("session.subagents：>0 记录子代理数并清除 completed；0 移除标记", () => {
    const currentSessionId = ref<string | null>("s1");
    const api = useSessionEvents({ currentSessionId });

    // 先制造非当前会话 s2 的 completed 提醒
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "running" });
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "idle" });
    expect(api.sessionStates.value.s2.completed).toBe(true);

    // 父会话 s1 有 1 个子代理在跑：记录计数并清除 completed（子代理期间不提示"已完成"）
    api.handleEvent({ type: "session.subagents", sessionId: "s2", running: 1 });
    expect(api.sessionStates.value.s2.subagentsRunning).toBe(1);
    expect(api.sessionStates.value.s2.completed).toBeUndefined();

    // 子代理结束 → 计数清除
    api.handleEvent({ type: "session.subagents", sessionId: "s2", running: 0 });
    expect(api.sessionStates.value.s2.subagentsRunning).toBeUndefined();

    // 不影响其它字段
    api.handleEvent({ type: "session.status", sessionId: "s2", status: "running" });
    expect(api.sessionStates.value.s2.thinking).toBe(true);
    expect(api.sessionStates.value.s2.subagentsRunning).toBeUndefined();
  });
});
