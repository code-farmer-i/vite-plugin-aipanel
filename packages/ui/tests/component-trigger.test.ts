/**
 * 覆盖目标：Trigger.vue（悬浮触发气泡）
 * - 按钮类与交互态来自 context：active / thinking / aipanel-theme-dark、aria-expanded、title 含快捷键
 * - 默认插槽渲染 AIPanelLogo，自定义插槽可覆盖
 * - 点击回调 handleToggle（经 FloatingBubble 的 tap 点击）
 * - FloatingBubble 的 drag-start / drag-end 透传为 Trigger 同名事件
 * - offset-change 回调 handleBubbleOffsetChange；bubbleOffset 变化同步到暴露的 offset
 *
 * 策略：mountWithContext 真实 provide/inject；FloatingBubble 默认 teleport 到 body，
 * 使用 teleport stub 让内容内联以便查询；子组件事件用 $emit 驱动。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import Trigger from "../src/AI-panel-widget/src/components/Trigger.vue";
import { createWidgetContext, mountWithContext } from "./component-widget-context";

let wrapper: VueWrapper | null = null;

function mountTrigger(contextOverrides = {}, slots?: Record<string, unknown>) {
  wrapper?.unmount();
  const { wrapper: w, context } = mountWithContext(Trigger, {
    context: createWidgetContext(contextOverrides),
    slots,
    stubs: { teleport: true },
  });
  wrapper = w;
  return { w, context, trigger: w.findComponent(Trigger) };
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Trigger", () => {
  it("按钮类与交互态来自 context", () => {
    const { w } = mountTrigger({
      buttonActive: ref(true),
      thinking: ref(true),
      resolvedTheme: ref("dark"),
      open: ref(true),
    });

    const btn = w.find(".aipanel-button");
    expect(btn.classes()).toEqual(
      expect.arrayContaining(["active", "thinking", "aipanel-theme-dark"]),
    );
    expect(btn.attributes("aria-expanded")).toBe("true");
    expect(btn.attributes("aria-label")).toBe("打开 AI 助手");
  });

  it("title 拼接快捷键标签", () => {
    const { w } = mountTrigger({ hotkeyLabel: ref("Cmd+K") });
    expect(w.find(".aipanel-button").attributes("title")).toBe("AI 助手 (Cmd+K)");
  });

  it("默认插槽渲染 AIPanelLogo，自定义插槽可覆盖", () => {
    const def = mountTrigger();
    expect(def.w.find(".aipanel-button .aipanel-logo").exists()).toBe(true);
    expect(def.w.find(".aipanel-button svg").exists()).toBe(true);

    const custom = mountTrigger({}, { default: () => h("i", { class: "custom-icon" }, "ICON") });
    expect(custom.w.find(".custom-icon").text()).toBe("ICON");
    expect(custom.w.find(".aipanel-logo").exists()).toBe(false);
  });

  it("点击按钮回调 handleToggle", async () => {
    const handleToggle = vi.fn();
    const { w } = mountTrigger({ handleToggle });

    await w.find(".aipanel-button").trigger("click");
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it("FloatingBubble 的 drag-start / drag-end 透传为 Trigger 事件", () => {
    const { w, trigger } = mountTrigger();
    const bubble = w.findComponent({ name: "FloatingBubble" });

    bubble.vm.$emit("drag-start");
    bubble.vm.$emit("drag-end");
    expect(trigger.emitted("drag-start")).toHaveLength(1);
    expect(trigger.emitted("drag-end")).toHaveLength(1);
  });

  it("offset-change 回调 handleBubbleOffsetChange 并同步暴露的 offset", () => {
    const handleBubbleOffsetChange = vi.fn();
    const { w, trigger } = mountTrigger({ handleBubbleOffsetChange });
    const bubble = w.findComponent({ name: "FloatingBubble" });

    bubble.vm.$emit("offset-change", { x: 8, y: 9 });
    expect(handleBubbleOffsetChange).toHaveBeenCalledWith({ x: 8, y: 9 });
    expect(trigger.vm.offset).toEqual({ x: 8, y: 9 });
  });

  it("context.bubbleOffset 变化时同步到内部 offset", async () => {
    const bubbleOffset = ref<{ x: number; y: number } | undefined>(undefined);
    const { trigger } = mountTrigger({ bubbleOffset });

    bubbleOffset.value = { x: 30, y: 40 };
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Trigger 固定 magnetic="x"，纵向保留传入值，横向吸附到最近边
    expect(trigger.vm.offset).toEqual({ x: 24, y: 40 });
  });
});
