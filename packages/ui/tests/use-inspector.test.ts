/**
 * @aipanel/ui useInspector（AI-panel-widget 元素选择 / 高亮逻辑）单元测试。
 *
 * 覆盖目标：
 *  - selectMode 切换时在 document 上增删 mousemove/keydown 监听，并驱动 __VUE_INSPECTOR__ 的 enable/disable；
 *  - mousemove 依据目标元素矩形更新 highlightStyle / tooltip 可见性与内容（含 description、fileInfo）；
 *  - 命中忽略元素（.aipanel-widget / data-v-inspector-ignore）或非法 target 时隐藏高亮；
 *  - Escape 仅在 selectMode 下回调 onExitSelectMode；
 *  - onMounted 注入或轮询 hook __VUE_INSPECTOR__.handleClick，hook 后按 selectMode 采集/透传点击；
 *  - onUnmounted 清理轮询定时器与 document 监听。
 *
 * 策略：用 helpers.mountComposable 挂载壳组件驱动 onMounted/onUnmounted/watch；
 * selectMode 由测试侧 ref 驱动。矩形用 getBoundingClientRect 打桩（jsdom 恒为 0）；
 * 选择器由 css-selector-generator 生成，故只断言非空而不写死字符串。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { INSPECTOR_CHECK_INTERVAL, truncate } from "@aipanel/core";
import { useInspector } from "../src/AI-panel-widget/composables/use-inspector";
import { mountComposable, unmountAll, flushVue } from "./helpers";

type Inspector = NonNullable<typeof window.__VUE_INSPECTOR__>;

/** 构造 __VUE_INSPECTOR__ 假实现，并单独持有各方法的 mock 便于断言 */
function createInspector() {
  const getTargetNode = vi.fn(() => ({ targetNode: null, params: null }));
  const handleClick = vi.fn();
  const enable = vi.fn();
  const disable = vi.fn();
  const inspector: Inspector = { getTargetNode, handleClick, enable, disable };
  return { inspector, handleClick, enable, disable };
}

function setup(prepare?: () => void) {
  const selectMode = ref(false);
  const onAddSelectedNode = vi.fn();
  const onExitSelectMode = vi.fn();
  prepare?.();
  const { ctx } = mountComposable(() =>
    useInspector({ selectMode, onAddSelectedNode, onExitSelectMode }),
  );
  return { api: ctx, selectMode, onAddSelectedNode, onExitSelectMode };
}

function appendEl<T extends Element>(el: T): T {
  document.body.appendChild(el);
  return el;
}

/** jsdom 的 getBoundingClientRect 恒返回全 0，这里注入受控矩形 */
function mockRect(el: Element, rect: { top: number; left: number; width: number; height: number }) {
  return vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(async () => {
  // 先还原真实定时器，避免 flushPromises（内部 setTimeout）在假定时器下挂起
  vi.useRealTimers();
  await unmountAll();
  delete window.__VUE_INSPECTOR__;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useInspector", () => {
  it("selectMode 打开时注册 document 监听并 enable，关闭时移除并 disable", async () => {
    const { inspector, enable, disable } = createInspector();
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const s = setup(() => {
      window.__VUE_INSPECTOR__ = inspector;
    });

    s.selectMode.value = true;
    await flushVue();
    expect(enable).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);

    s.selectMode.value = false;
    await flushVue();
    expect(disable).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);
  });

  it("mousemove 依据目标矩形更新 highlightStyle 与 tooltipContent（含 fileInfo）", async () => {
    const s = setup();
    s.selectMode.value = true;
    await flushVue();

    const el = appendEl(document.createElement("div"));
    el.setAttribute("data-v-inspector", "/proj/src/Foo.tsx:12:3");
    mockRect(el, { top: 10, left: 20, width: 30, height: 40 });

    el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(s.api.highlightVisible.value).toBe(true);
    expect(s.api.tooltipVisible.value).toBe(true);
    expect(s.api.highlightStyle.value).toMatchObject({
      top: "10px",
      left: "20px",
      width: "30px",
      height: "40px",
    });
    expect(s.api.highlightStyle.value.border).toContain("2px solid");
    // description 由 css-selector-generator 生成，不写死具体选择器
    expect(typeof s.api.tooltipContent.value.description).toBe("string");
    expect(s.api.tooltipContent.value.description.length).toBeGreaterThan(0);
    expect(s.api.tooltipContent.value.fileInfo).toBe("Foo.tsx:12:3");
  });

  it("命中忽略元素（data-v-inspector-ignore / .aipanel-widget 内）时隐藏高亮与 tooltip", async () => {
    const s = setup();
    s.selectMode.value = true;
    await flushVue();

    const normal = appendEl(document.createElement("div"));
    mockRect(normal, { top: 1, left: 1, width: 1, height: 1 });
    normal.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(s.api.highlightVisible.value).toBe(true);

    const widget = appendEl(document.createElement("div"));
    widget.className = "aipanel-widget";
    const child = document.createElement("span");
    widget.appendChild(child);
    child.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(s.api.highlightVisible.value).toBe(false);
    expect(s.api.tooltipVisible.value).toBe(false);

    normal.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(s.api.highlightVisible.value).toBe(true);

    const ignored = appendEl(document.createElement("div"));
    ignored.setAttribute("data-v-inspector-ignore", "");
    ignored.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(s.api.highlightVisible.value).toBe(false);
    expect(s.api.tooltipVisible.value).toBe(false);
  });

  it("非法 target（非 Element）不抛错并隐藏高亮", async () => {
    const s = setup();
    s.selectMode.value = true;
    await flushVue();

    const normal = appendEl(document.createElement("div"));
    mockRect(normal, { top: 1, left: 1, width: 1, height: 1 });
    normal.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(s.api.highlightVisible.value).toBe(true);

    expect(() => document.dispatchEvent(new MouseEvent("mousemove"))).not.toThrow();
    expect(s.api.highlightVisible.value).toBe(false);
  });

  it("selectMode 下 Escape 触发 onExitSelectMode，其它键不触发", async () => {
    const s = setup();
    s.selectMode.value = true;
    await flushVue();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(s.onExitSelectMode).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.onExitSelectMode).toHaveBeenCalledTimes(1);
  });

  it("非 selectMode 下 Escape 不触发 onExitSelectMode", () => {
    const s = setup();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.onExitSelectMode).not.toHaveBeenCalled();
  });

  it("onMounted 时 __VUE_INSPECTOR__ 已存在则立即 hook handleClick", () => {
    const { inspector } = createInspector();
    setup(() => {
      window.__VUE_INSPECTOR__ = inspector;
    });
    expect(inspector.__aipanel_hooked).toBe(true);
  });

  it("__VUE_INSPECTOR__ 缺失时按 INSPECTOR_CHECK_INTERVAL 轮询 hook 并清除定时器", () => {
    vi.useFakeTimers();
    setup();
    expect(vi.getTimerCount()).toBe(1);

    const { inspector } = createInspector();
    window.__VUE_INSPECTOR__ = inspector;
    vi.advanceTimersByTime(INSPECTOR_CHECK_INTERVAL);

    expect(inspector.__aipanel_hooked).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hook 后的 handleClick 在 selectMode 下阻止默认行为并采集节点（innerText 截断 200）", async () => {
    const { inspector, handleClick: original } = createInspector();
    const s = setup(() => {
      window.__VUE_INSPECTOR__ = inspector;
    });
    s.selectMode.value = true;
    await flushVue();

    const longText = "x".repeat(300);
    const el = appendEl(document.createElement("div"));
    el.textContent = longText;
    el.setAttribute("data-v-inspector", "/proj/src/Comp.tsx:42:7");

    const ev = {
      target: el,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    window.__VUE_INSPECTOR__!.handleClick(ev);

    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(original).not.toHaveBeenCalled();
    expect(s.onAddSelectedNode).toHaveBeenCalledTimes(1);
    const payload = s.onAddSelectedNode.mock.calls[0][0];
    expect(payload).toMatchObject({
      filePath: "/proj/src/Comp.tsx",
      line: 42,
      column: 7,
      innerText: truncate(longText, 200),
    });
    expect(payload.description.length).toBeGreaterThan(0);
  });

  it("hook 后的 handleClick 在 selectMode 下点击 .aipanel-widget 内元素时透传原始 handleClick", async () => {
    const { inspector, handleClick: original } = createInspector();
    const s = setup(() => {
      window.__VUE_INSPECTOR__ = inspector;
    });
    s.selectMode.value = true;
    await flushVue();

    const widget = appendEl(document.createElement("div"));
    widget.className = "aipanel-widget";
    const child = document.createElement("button");
    widget.appendChild(child);

    const ev = {
      target: child,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    window.__VUE_INSPECTOR__!.handleClick(ev);

    expect(original).toHaveBeenCalledWith(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(s.onAddSelectedNode).not.toHaveBeenCalled();
  });

  it("hook 后的 handleClick 在非 selectMode 下直接调用原始 handleClick", async () => {
    const { inspector, handleClick: original } = createInspector();
    setup(() => {
      window.__VUE_INSPECTOR__ = inspector;
    });

    const el = appendEl(document.createElement("div"));
    const ev = { target: el } as unknown as MouseEvent;
    window.__VUE_INSPECTOR__!.handleClick(ev);

    expect(original).toHaveBeenCalledWith(ev);
  });

  it("onUnmounted 清理 document 监听（Escape 不再触发）", async () => {
    const s = setup();
    s.selectMode.value = true;
    await flushVue();

    const removeSpy = vi.spyOn(document, "removeEventListener");
    await unmountAll();

    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.onExitSelectMode).not.toHaveBeenCalled();
  });

  it("onUnmounted 清理轮询定时器", async () => {
    const setSpy = vi.spyOn(window, "setInterval");
    const clearSpy = vi.spyOn(window, "clearInterval");
    setup(); // 无 __VUE_INSPECTOR__ → 启动轮询

    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), INSPECTOR_CHECK_INTERVAL);
    const timerId = setSpy.mock.results[0].value;

    await unmountAll();
    expect(clearSpy).toHaveBeenCalledWith(timerId);
  });
});
