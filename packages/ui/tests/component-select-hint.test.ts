/**
 * 覆盖目标：SelectHint.vue（选择模式提示条）
 * - selectMode 驱动 .visible class（显示/隐藏）
 * - 渲染固定提示文案与来自 context 的 selectShortcutLabel 快捷键标签
 *
 * 策略：用 mountWithContext 走真实 provide/inject，测试侧 ref 驱动显示状态。
 */
import { afterEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import SelectHint from "../src/AI-panel-widget/src/components/SelectHint.vue";
import { createWidgetContext, mountWithContext } from "./component-widget-context";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("SelectHint", () => {
  it("selectMode 为假时不带 visible class", () => {
    const { wrapper: w } = mountWithContext(SelectHint, {
      context: createWidgetContext({ selectMode: ref(false) }),
    });
    wrapper = w;
    expect(w.find(".aipanel-select-mode-hint").classes()).not.toContain("visible");
  });

  it("selectMode 为真时带 visible class，并渲染快捷键标签", () => {
    const { wrapper: w } = mountWithContext(SelectHint, {
      context: createWidgetContext({
        selectMode: ref(true),
        selectShortcutLabel: ref("按 ESC 退出"),
      }),
    });
    wrapper = w;

    const hint = w.find(".aipanel-select-mode-hint");
    expect(hint.classes()).toContain("visible");
    expect(hint.find(".aipanel-hint-text").text()).toBe("选择模式已开启 · 点击元素进行选择");
    expect(hint.find(".aipanel-hint-shortcut").text()).toBe("按 ESC 退出");
  });
});
