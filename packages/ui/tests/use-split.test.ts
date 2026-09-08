/**
 * @aipanel/ui useSplitMode（AI-panel-widget 布局分栏逻辑）单元测试。
 *
 * 策略：用 helpers.mountComposable 挂载壳组件驱动 composable，
 * 让 onMounted/onUnmounted 获得真实组件实例（无生命周期警告），
 * afterEach 统一 unmountAll 卸载并移除 window resize 监听与 body class 残留。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { DisplayMode, SplitModeOptions } from "@aipanel/core";
import { useSplitMode } from "../src/AI-panel-widget/composables/use-split";
import { mountComposable, unmountAll, flushVue } from "./helpers";

afterEach(() => unmountAll());

function setup(overrides: Partial<Parameters<typeof useSplitMode>[0]> = {}) {
  const opts: Parameters<typeof useSplitMode>[0] = {
    displayMode: ref<DisplayMode>("auto"),
    splitMode: ref<SplitModeOptions | undefined>(undefined),
    open: ref(false),
    ...overrides,
  };
  return mountComposable(() => useSplitMode(opts)).ctx;
}

describe("useSplitMode", () => {
  it("splitConfig 默认值：width 500 / min 400 / max 800 / 可调 / 默认展开 / 位置 right", () => {
    const api = setup();
    expect(api.splitConfig.value).toMatchObject({
      width: 500,
      minWidth: 400,
      maxWidth: 800,
      resizable: true,
      shrinkPage: true,
      defaultOpen: true,
      position: "right",
    });
  });

  it("web 模式 auto 判定：窄屏（jsdom 1024）为 bubble，宽屏（>=1440）为 split", () => {
    expect(setup().effectiveMode.value).toBe("bubble");
    Object.defineProperty(window, "innerWidth", {
      value: 1600,
      configurable: true,
      writable: true,
    });
    expect(setup().effectiveMode.value).toBe("split");
  });

  it("extension / bubble / split 显示模式直接决定 effectiveMode", () => {
    const ext = setup({ displayMode: ref<DisplayMode>("extension") });
    expect(ext.effectiveMode.value).toBe("split");
    expect(ext.isExtensionMode.value).toBe(true);
    // extension 下不可 resize / 不收缩页面，但默认展开
    expect(ext.splitConfig.value).toMatchObject({
      resizable: false,
      shrinkPage: false,
      defaultOpen: true,
    });
    expect(setup({ displayMode: ref<DisplayMode>("bubble") }).effectiveMode.value).toBe("bubble");
    expect(setup({ displayMode: ref<DisplayMode>("split") }).effectiveMode.value).toBe("split");
  });

  it("splitMode 配置上限变化时 panelWidth 被钳制到新 maxWidth", async () => {
    const s = ref<SplitModeOptions | undefined>(undefined);
    const api = setup({ splitMode: s });
    expect(api.panelWidth.value).toBe(500);
    s.value = { maxWidth: 300 };
    await flushVue();
    expect(api.panelWidth.value).toBe(300);
  });

  it("handleResize 更新 panelWidth 并回调 onWidthChange", () => {
    const onWidthChange = vi.fn();
    const api = setup({ onWidthChange });
    api.handleResize(666);
    expect(api.panelWidth.value).toBe(666);
    expect(onWidthChange).toHaveBeenCalledWith(666);
  });

  it("handleToggle 回调反向 open；handleTogglePosition 翻转位置并回调", () => {
    const onOpenChange = vi.fn();
    const onPositionChange = vi.fn();
    const api = setup({ onOpenChange, onPositionChange });
    api.handleToggle();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(api.splitPosition.value).toBe("right");
    api.handleTogglePosition();
    expect(api.splitPosition.value).toBe("left");
    expect(onPositionChange).toHaveBeenCalledWith("left");
  });
});
