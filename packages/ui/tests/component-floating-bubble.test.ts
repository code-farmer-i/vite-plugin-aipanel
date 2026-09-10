/**
 * 覆盖目标：FloatingBubble.vue（可拖拽悬浮气泡）
 * - 初始定位：无 offset 时贴右下角；offset 传入后按 gap 钳制；gap 支持数字与 {x,y}
 * - 点击（tap）emit click；拖拽（超过阈值）emit drag-start / update:offset，松手 emit drag-end / offset-change
 * - axis：xy 双向、x 仅横向、lock 不改变位置；magnetic="x" 松手后吸附最近边
 * - offset prop 变化重新定位；unmount 清理 window 监听与 body 拖拽类
 *
 * 策略：Teleport 打桩使内容内联；mount 后 await flushVue 让 onMounted 的首次定位渲染到 DOM；
 * window 上派发合成鼠标事件模拟拖拽；松手后的吸边逻辑在 requestAnimationFrame 中执行，用 rAF 回调等待。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import FloatingBubble from "../src/AI-panel-widget/src/components/FloatingBubble/FloatingBubble.vue";
import { flushVue } from "./helpers";

let wrapper: VueWrapper | null = null;

async function mountBubble(props: Record<string, unknown> = {}) {
  wrapper?.unmount();
  wrapper = mount(FloatingBubble, {
    props,
    global: { stubs: { teleport: true } },
    slots: { default: () => h("span", { class: "bubble-content" }, "B") },
  });
  // 等待 onMounted 里的 updateState 触发的重渲染落地
  await flushVue();
  return wrapper;
}

function move(clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
}

function up() {
  window.dispatchEvent(new MouseEvent("mouseup"));
}

/** 等待 requestAnimationFrame 中的吸边/事件派发完成 */
async function flushRaf(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve(undefined));
  });
  await nextTick();
}

/** 取某事件的最后一次 emit 载荷（兼容 lib 目标不支持 Array.prototype.at） */
function lastEmitted(w: VueWrapper, name: string): unknown[] | undefined {
  const calls = w.emitted(name);
  return calls ? calls[calls.length - 1] : undefined;
}

function emittedCount(w: VueWrapper, name: string): number {
  return w.emitted(name)?.length ?? 0;
}

afterEach(() => {
  vi.useRealTimers();
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  document.body.classList.remove("floating-bubble-dragging");
  vi.restoreAllMocks();
});

describe("FloatingBubble", () => {
  it("无 offset 时贴右下角（窗口尺寸 - 尺寸 - gap）", async () => {
    const w = await mountBubble();
    const style = w.find(".floating-bubble").attributes("style") ?? "";
    // jsdom 默认 1024x768，元素矩形宽高为 0，gap 默认 24
    expect(style).toContain("translate3d(1000px, 744px, 0)");
    expect(w.find(".bubble-content").text()).toBe("B");
  });

  it("offset 传入时定位并按 gap 钳制到边界内", async () => {
    const inside = await mountBubble({ offset: { x: 100, y: 50 } });
    expect(inside.find(".floating-bubble").attributes("style")).toContain(
      "translate3d(100px, 50px, 0)",
    );

    const clamped = await mountBubble({ offset: { x: -50, y: 2000 } });
    expect(clamped.find(".floating-bubble").attributes("style")).toContain(
      "translate3d(24px, 744px, 0)",
    );
  });

  it("gap 支持 { x, y } 对象分别作用于横纵边界", async () => {
    const w = await mountBubble({ gap: { x: 100, y: 200 } });
    expect(w.find(".floating-bubble").attributes("style")).toContain(
      "translate3d(924px, 568px, 0)",
    );
  });

  it("点击（未拖拽）emit click", async () => {
    const w = await mountBubble();
    await w.find(".floating-bubble").trigger("click");
    expect(w.emitted("click")).toHaveLength(1);
  });

  it("拖拽超过阈值 emit drag-start 与 update:offset，松手 emit drag-end 与 offset-change", async () => {
    const w = await mountBubble({ offset: { x: 500, y: 500 } });
    await w.find(".floating-bubble").trigger("mousedown", { clientX: 500, clientY: 500 });

    move(400, 450);
    expect(w.emitted("drag-start")).toHaveLength(1);
    expect(lastEmitted(w, "update:offset")).toEqual([{ x: 400, y: 450 }]);

    up();
    await flushRaf();
    expect(w.emitted("drag-end")).toHaveLength(1);
    expect(lastEmitted(w, "offset-change")).toEqual([{ x: 400, y: 450 }]);
  });

  it("axis=x 仅改变横向位置", async () => {
    const w = await mountBubble({ offset: { x: 500, y: 500 }, axis: "x" });
    await w.find(".floating-bubble").trigger("mousedown", { clientX: 500, clientY: 500 });

    move(400, 300);
    expect(lastEmitted(w, "update:offset")).toEqual([{ x: 400, y: 500 }]);
    up();
    await flushRaf();
  });

  it("axis=lock 不改变位置但仍 emit drag-start", async () => {
    const w = await mountBubble({ offset: { x: 500, y: 500 }, axis: "lock" });
    const before = emittedCount(w, "update:offset");
    await w.find(".floating-bubble").trigger("mousedown", { clientX: 500, clientY: 500 });

    move(400, 300);
    expect(w.emitted("drag-start")).toHaveLength(1);
    // axe=lock 时不会产生新的位置更新
    expect(emittedCount(w, "update:offset")).toBe(before);
    up();
    await flushRaf();
  });

  it("magnetic=x 松手后吸附到最近边", async () => {
    const w = await mountBubble({ offset: { x: 400, y: 500 }, magnetic: "x" });
    await w.find(".floating-bubble").trigger("mousedown", { clientX: 400, clientY: 500 });

    move(380, 500);
    up();
    await flushRaf();
    // 中心 < 窗口中心 512 → 吸附左边 gap=24
    expect(lastEmitted(w, "update:offset")).toEqual([{ x: 24, y: 500 }]);
  });

  it("offset prop 变化时重新定位", async () => {
    const w = await mountBubble({ offset: { x: 100, y: 100 } });
    await w.setProps({ offset: { x: 200, y: 200 } });
    await flushVue();
    expect(lastEmitted(w, "update:offset")).toEqual([{ x: 200, y: 200 }]);
  });

  it("unmount 清理 window 监听与拖拽 body 类", async () => {
    const w = await mountBubble({ offset: { x: 500, y: 500 } });
    await w.find(".floating-bubble").trigger("mousedown", { clientX: 500, clientY: 500 });
    expect(document.body.classList.contains("floating-bubble-dragging")).toBe(true);

    const removeSpy = vi.spyOn(window, "removeEventListener");
    w.unmount();
    wrapper = null;

    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));
    expect(document.body.classList.contains("floating-bubble-dragging")).toBe(false);
  });
});
