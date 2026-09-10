/**
 * 覆盖目标：SessionList.vue（会话列表）
 * - 折叠态 class 与折叠动画期间的骨架屏（watch collapsed → 200ms 后复原）
 * - 头部新建会话按钮点击回调；sessions 为空时渲染 empty 插槽
 * - 会话行渲染 title/meta、active class 与 aria-selected，点击回调 handleSelectSession(item)
 * - 行删除按钮（阻止冒泡）回调 handleDeleteSession(item)
 * - showSessionListSkeleton / loadingSessionList 驱动骨架屏
 * - 行状态指示优先级：pending > 活跃(thinking/running/子代理) > completed > idle，及各自 title 文案
 *
 * 策略：mountWithContext 真实 provide/inject；动画用假定时器 + nextTick 推进（避免 fake timers 下 flushPromises 挂起）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick, ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import type { AIPanelSessionThinkingState, AIPanelWidgetSessionItem } from "@aipanel/core";
import SessionList from "../src/AI-panel-widget/src/components/SessionList.vue";
import { createWidgetContext, mountWithContext } from "./component-widget-context";

function makeSessionItem(
  overrides: Partial<AIPanelWidgetSessionItem> = {},
): AIPanelWidgetSessionItem {
  return {
    key: "s1",
    id: "s1",
    title: "会话一",
    meta: "",
    active: false,
    session: { id: "s1" },
    ...overrides,
  };
}

function makeState(
  overrides: Partial<AIPanelSessionThinkingState> = {},
): AIPanelSessionThinkingState {
  return { thinking: false, statusType: "idle", hasPending: false, ...overrides };
}

let wrapper: VueWrapper | null = null;

function mountList(contextOverrides = {}) {
  wrapper?.unmount();
  const { wrapper: w } = mountWithContext(SessionList, {
    context: createWidgetContext(contextOverrides),
  });
  wrapper = w;
  return w;
}

afterEach(async () => {
  vi.useRealTimers();
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SessionList", () => {
  it("折叠态 class 跟随 sessionListCollapsed", () => {
    expect(
      mountList({ sessionListCollapsed: ref(true) })
        .find(".aipanel-session-list")
        .classes(),
    ).toContain("collapsed");
    expect(
      mountList({ sessionListCollapsed: ref(false) })
        .find(".aipanel-session-list")
        .classes(),
    ).not.toContain("collapsed");
  });

  it("头部渲染标题，新建会话按钮点击回调 handleCreateSession", async () => {
    const handleCreateSession = vi.fn();
    const w = mountList({ handleCreateSession });

    expect(w.find(".aipanel-session-list-title").text()).toBe("会话列表");
    await w.find(".aipanel-new-session-btn").trigger("click");
    expect(handleCreateSession).toHaveBeenCalledTimes(1);
  });

  it("会话行渲染 title/meta、active 态，点击回调 handleSelectSession(item)", async () => {
    const handleSelectSession = vi.fn();
    const item = makeSessionItem({
      key: "a",
      id: "a",
      title: "标题 A",
      meta: "2 分钟前",
      active: true,
    });
    const w = mountList({ sessionItems: ref([item]), handleSelectSession });

    const row = w.find(".aipanel-session-item");
    expect(row.find(".aipanel-session-title-text").text()).toBe("标题 A");
    expect(row.find(".aipanel-session-meta").text()).toBe("2 分钟前");
    expect(row.classes()).toContain("active");
    expect(row.attributes("aria-selected")).toBe("true");

    await row.trigger("click");
    expect(handleSelectSession).toHaveBeenCalledTimes(1);
    expect(handleSelectSession.mock.calls[0][0]).toMatchObject({ id: "a" });
  });

  it("meta 为空时不渲染时间行", () => {
    const w = mountList({ sessionItems: ref([makeSessionItem({ meta: "" })]) });
    expect(w.find(".aipanel-session-meta").exists()).toBe(false);
  });

  it("行删除按钮阻止冒泡并回调 handleDeleteSession(item)", async () => {
    const handleSelectSession = vi.fn();
    const handleDeleteSession = vi.fn();
    const item = makeSessionItem({ key: "a", id: "a" });
    const w = mountList({
      sessionItems: ref([item]),
      handleSelectSession,
      handleDeleteSession,
    });

    await w.find(".aipanel-session-delete-btn").trigger("click");
    expect(handleDeleteSession).toHaveBeenCalledTimes(1);
    expect(handleDeleteSession.mock.calls[0][0]).toMatchObject({ id: "a" });
    expect(handleSelectSession).not.toHaveBeenCalled();
  });

  it("sessions 为空时渲染 empty 插槽", () => {
    wrapper?.unmount();
    const { wrapper: w } = mountWithContext(SessionList, {
      context: createWidgetContext({ sessionItems: ref([]) }),
      slots: { empty: () => h("div", { class: "custom-empty" }, "没有会话") },
    });
    wrapper = w;
    expect(w.find(".aipanel-session-item").exists()).toBe(false);
    expect(w.find(".aipanel-session-list-content").exists()).toBe(true);
    expect(w.find(".custom-empty").text()).toBe("没有会话");
  });

  it("showSessionListSkeleton / loadingSessionList 为真时显示骨架屏", () => {
    const skeleton = mountList({ showSessionListSkeleton: ref(true) });
    expect(skeleton.find(".aipanel-session-skeleton").classes()).toContain("visible");
    expect(skeleton.findAll(".aipanel-skeleton-item")).toHaveLength(5);
    expect(skeleton.find(".aipanel-session-list-header").exists()).toBe(false);

    const loading = mountList({ loadingSessionList: ref(true) });
    expect(loading.find(".aipanel-session-skeleton").classes()).toContain("visible");
  });

  it("折叠状态变化触发 200ms 骨架动画后复原", async () => {
    vi.useFakeTimers();
    const collapsed = ref(false);
    const w = mountList({ sessionListCollapsed: collapsed });
    expect(w.find(".aipanel-session-skeleton").exists()).toBe(false);

    collapsed.value = true;
    await nextTick();
    const skeleton = w.find(".aipanel-session-skeleton");
    expect(skeleton.exists()).toBe(true);
    expect(skeleton.classes()).toContain("visible");

    vi.advanceTimersByTime(200);
    await nextTick();
    expect(w.find(".aipanel-session-skeleton").exists()).toBe(false);
    vi.useRealTimers();
  });

  it("行状态指示：pending 优先并显示审批文案", () => {
    const w = mountList({
      sessionItems: ref([makeSessionItem({ id: "p" })]),
      sessionStates: ref({
        p: makeState({ hasPending: true, pendingKind: "approval", thinking: true }),
      }),
    });
    const dot = w.find(".aipanel-session-state-pending");
    expect(dot.exists()).toBe(true);
    expect(dot.attributes("title")).toBe("等待审批");
    // pending 时不显示运行中矩阵
    expect(w.find(".aipanel-session-state-ongoing").exists()).toBe(false);
  });

  it("行状态指示：活跃（thinking/running/子代理）显示转圈矩阵，子代理带数量", () => {
    const w = mountList({
      sessionItems: ref([makeSessionItem({ id: "t" }), makeSessionItem({ key: "r", id: "r" })]),
      sessionStates: ref({
        t: makeState({ thinking: true }),
        r: makeState({ statusType: "running", subagentsRunning: 2 }),
      }),
    });
    expect(w.findAll(".aipanel-session-state-ongoing")).toHaveLength(2);
    expect(w.findAll(".aipanel-session-item")[0].classes()).toContain("thinking");
    expect(w.findAll(".aipanel-session-state-ongoing")[0].attributes("title")).toBe("运行中");
    expect(w.findAll(".aipanel-session-state-ongoing")[1].attributes("title")).toBe(
      "子代理运行中 (2)",
    );
  });

  it("行状态指示：completed 显示完成点，无状态不渲染指示", () => {
    const w = mountList({
      sessionItems: ref([makeSessionItem({ id: "c" }), makeSessionItem({ key: "i", id: "i" })]),
      sessionStates: ref({ c: makeState({ completed: true }) }),
    });
    const dots = w.findAll(".aipanel-session-state");
    expect(dots).toHaveLength(1);
    expect(dots[0].classes()).toContain("aipanel-session-state-completed");
  });
});
