/**
 * 覆盖目标：ChatPanel.vue（会话面板容器）
 * - 根节点 class 与样式：bubble/split/extension 模式、minimized/dragging/no-transition、split-left/right
 * - split 模式下 ResizeHandle 与分栏切换按钮的渲染条件、宽度样式、open/thinking/主题 class
 * - 分栏切换按钮点击 emit toggle；ResizeHandle 的 resize/resize-start/resize-end 事件转发
 * - providerSidebar 时隐藏原生 SessionList
 * - 子组件插槽转发（Header 图标、Frame 各覆盖层、sessions-empty）与暴露的 sendMessageToIframe 委托
 *
 * 策略：mountWithContext 真实 provide/inject；子组件事件用 $emit 驱动父级监听，断言 ChatPanel 的 emits 载荷。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import ChatPanel from "../src/AI-panel-widget/src/components/ChatPanel.vue";
import ResizeHandle from "../src/AI-panel-widget/src/components/ResizeHandle.vue";
import SessionList from "../src/AI-panel-widget/src/components/SessionList.vue";
import { createWidgetContext, mountWithContext } from "./component-widget-context";

let wrapper: VueWrapper | null = null;

function mountPanel(props: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  wrapper?.unmount();
  const { wrapper: w, context } = mountWithContext(ChatPanel, {
    props,
    ...options,
  });
  wrapper = w;
  return { w, context, panel: w.findComponent(ChatPanel) };
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ChatPanel", () => {
  it("默认 bubble 模式：无 split 类与拖拽手柄，样式取 positionStyle", () => {
    const { w, panel } = mountPanel({ positionStyle: { right: "20px", bottom: "30px" } });

    const root = w.find(".aipanel-chat");
    expect(root.classes()).not.toContain("split-mode");
    expect(root.attributes("style")).toContain("right: 20px");
    expect(root.attributes("style")).toContain("bottom: 30px");
    expect(w.findComponent(ResizeHandle).exists()).toBe(false);
    expect(w.find(".aipanel-split-toggle-btn").exists()).toBe(false);
    expect(w.findComponent(SessionList).exists()).toBe(true);
    expect(panel.emitted("toggle")).toBeUndefined();
  });

  it("split + open + 可调：渲染手柄与切换按钮，宽度取 panelWidth", async () => {
    const { w, panel } = mountPanel({
      mode: "split",
      open: true,
      panelWidth: 640,
      splitPosition: "right",
    });

    const root = w.find(".aipanel-chat");
    expect(root.classes()).toEqual(expect.arrayContaining(["split-mode", "split-right", "open"]));
    expect(root.attributes("style")).toContain("width: 640px");
    expect(w.findComponent(ResizeHandle).exists()).toBe(true);

    const btn = w.find(".aipanel-split-toggle-btn");
    expect(btn.attributes("aria-expanded")).toBe("true");
    await btn.trigger("click");
    expect(panel.emitted("toggle")).toHaveLength(1);
  });

  it("split 且未 open 时不渲染 ResizeHandle", () => {
    const { w } = mountPanel({ mode: "split", open: false });
    expect(w.findComponent(ResizeHandle).exists()).toBe(false);
    expect(w.find(".aipanel-split-toggle-btn").attributes("aria-expanded")).toBe("false");
  });

  it("splitPosition=left 加 split-left 类；extension 模式抑制左右类并置空样式", () => {
    const left = mountPanel({ mode: "split", open: true, splitPosition: "left" }).w;
    expect(left.find(".aipanel-chat").classes()).toContain("split-left");

    const ext = mountPanel({
      mode: "split",
      open: true,
      extension: true,
      positionStyle: { right: "20px" },
    }).w;
    const root = ext.find(".aipanel-chat");
    expect(root.classes()).toContain("extension-mode");
    expect(root.classes()).not.toContain("split-left");
    expect(root.classes()).not.toContain("split-right");
    expect(root.attributes("style")).toBeUndefined();
  });

  it("minimized / dragging / no-transition 状态映射为类", () => {
    const { w } = mountPanel({ minimized: true, dragging: true, noTransition: true });
    expect(w.find(".aipanel-chat").classes()).toEqual(
      expect.arrayContaining(["minimized", "dragging", "no-transition"]),
    );
  });

  it("分栏切换按钮：thinking 与深色主题附加类", () => {
    const { w } = mountPanel({
      mode: "split",
      open: true,
      thinking: true,
      resolvedTheme: "dark",
    });
    const btn = w.find(".aipanel-split-toggle-btn");
    expect(btn.classes()).toEqual(expect.arrayContaining(["thinking", "aipanel-theme-dark"]));
  });

  it("ResizeHandle 的 resize / resize-start / resize-end 被转发", () => {
    const { w, panel } = mountPanel({ mode: "split", open: true });
    const handle = w.findComponent(ResizeHandle).vm;

    handle.$emit("resize", 720);
    handle.$emit("resize-start");
    handle.$emit("resize-end");

    expect(panel.emitted("resize")).toEqual([[720]]);
    expect(panel.emitted("resize-start")).toHaveLength(1);
    expect(panel.emitted("resize-end")).toHaveLength(1);
  });

  it("providerSidebar 为真时隐藏原生 SessionList", () => {
    const { w } = mountPanel({ providerSidebar: true });
    expect(w.findComponent(SessionList).exists()).toBe(false);
  });

  it("转发 Header 图标插槽与 Frame 覆盖层 / sessions-empty 插槽", () => {
    const { w } = mountPanel(
      {},
      {
        slots: {
          "session-toggle-icon": () => h("i", { class: "slot-session-toggle" }),
          "select-icon": () => h("i", { class: "slot-select" }),
          "close-icon": () => h("i", { class: "slot-close" }),
          "sessions-empty": () => h("div", { class: "slot-sessions-empty" }, "空"),
          "empty-state": () => h("div", { class: "slot-empty-state" }, "空态"),
          loading: () => h("div", { class: "slot-loading" }, "加载"),
          error: () => h("div", { class: "slot-error" }, "错误"),
          content: () => h("div", { class: "slot-content" }, "内容"),
        },
      },
    );

    expect(w.find(".slot-session-toggle").exists()).toBe(true);
    expect(w.find(".slot-select").exists()).toBe(true);
    expect(w.find(".slot-close").exists()).toBe(true);
    expect(w.find(".slot-sessions-empty").text()).toBe("空");
    expect(w.find(".slot-empty-state").text()).toBe("空态");
    expect(w.find(".slot-loading").text()).toBe("加载");
    expect(w.find(".slot-error").text()).toBe("错误");
    expect(w.find(".slot-content").text()).toBe("内容");
    // content 插槽替换默认 iframe
    expect(w.find("iframe").exists()).toBe(false);
  });

  it("暴露的 sendMessageToIframe 委托给内部 Frame", () => {
    const { panel } = mountPanel();
    const frameRef = panel.vm.frameRef;
    if (!frameRef) throw new Error("ChatPanel 未暴露 frameRef");
    const spy = vi.spyOn(frameRef, "sendMessageToIframe");

    panel.vm.sendMessageToIframe("AIPANEL_READY", { a: 1 });
    expect(spy).toHaveBeenCalledWith("AIPANEL_READY", { a: 1 });
  });

  it("context 标题透传给 Header", () => {
    const { w } = mountPanel({}, { context: createWidgetContext({ title: ref("自定义标题") }) });
    expect(w.find(".aipanel-chat-header-title").text()).toBe("自定义标题");
  });
});
