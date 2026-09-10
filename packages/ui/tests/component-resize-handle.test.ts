/**
 * 覆盖目标：ResizeHandle.vue
 * - mousedown 进入拖拽：emit resize-start，按下时带 resizing class
 * - mousemove 计算宽度：right 位置向左拖动变宽、left 位置向右拖动变宽，并钳制到 [minWidth, maxWidth]
 * - mouseup 结束拖拽：emit resize-end，移除 document 监听
 * - dblclick 复位宽度 500
 * - position="left" 渲染 handle-left class
 * - unmount 清理 document 上的 mousemove/mouseup 监听
 *
 * 拖拽依赖 document 级监听，故用例直接向 document 派发合成 MouseEvent。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import ResizeHandle from "../src/AI-panel-widget/src/components/ResizeHandle.vue";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountHandle(props: Record<string, unknown> = {}) {
  wrapper = mount(ResizeHandle, { props });
  return wrapper;
}

function move(clientX: number) {
  document.dispatchEvent(new MouseEvent("mousemove", { clientX }));
}

function up() {
  document.dispatchEvent(new MouseEvent("mouseup"));
}

/** 取最后一次 resize 事件参数（Array.prototype.at 需 ES2022，仓库 lib 为 ES2020） */
function lastResize(w: VueWrapper): unknown[] | undefined {
  const events = w.emitted("resize");
  return events?.[events.length - 1];
}

describe("ResizeHandle", () => {
  it("默认渲染 handle，position=left 时带 handle-left class", () => {
    const w = mountHandle();
    const el = w.find(".aipanel-resize-handle");
    expect(el.exists()).toBe(true);
    expect(el.classes()).not.toContain("handle-left");

    const leftWrapper = mount(ResizeHandle, { props: { position: "left" } });
    expect(leftWrapper.find(".aipanel-resize-handle").classes()).toContain("handle-left");
    leftWrapper.unmount();
  });

  it("mousedown emit resize-start 并进入 resizing 态", async () => {
    const w = mountHandle({ width: 500 });
    await w.find(".aipanel-resize-handle").trigger("mousedown", { clientX: 500 });
    expect(w.emitted("resize-start")).toHaveLength(1);
    expect(w.find(".aipanel-resize-handle").classes()).toContain("resizing");
    up();
  });

  it("right 位置：向左拖动变宽并按 maxWidth 钳制", async () => {
    const w = mountHandle({ width: 500, minWidth: 400, maxWidth: 800, position: "right" });
    await w.find(".aipanel-resize-handle").trigger("mousedown", { clientX: 500 });

    move(400); // deltaX = 500 - 400 = 100 → 600
    expect(lastResize(w)).toEqual([600]);

    move(0); // deltaX = 500 → 1000 → 钳制到 800
    expect(lastResize(w)).toEqual([800]);

    up();
    expect(w.emitted("resize-end")).toHaveLength(1);
  });

  it("right 位置：向右拖动变窄并按 minWidth 钳制", async () => {
    const w = mountHandle({ width: 500, minWidth: 400, maxWidth: 800, position: "right" });
    await w.find(".aipanel-resize-handle").trigger("mousedown", { clientX: 500 });

    move(900); // deltaX = 500 - 900 = -400 → 100 → 钳制到 400
    expect(lastResize(w)).toEqual([400]);
    up();
  });

  it("left 位置：向右拖动变宽", async () => {
    const w = mountHandle({ width: 500, minWidth: 400, maxWidth: 800, position: "left" });
    await w.find(".aipanel-resize-handle").trigger("mousedown", { clientX: 500 });

    move(600); // deltaX = 600 - 500 = 100 → 600
    expect(lastResize(w)).toEqual([600]);
    up();
  });

  it("mousemove 未按下时不产生 resize", async () => {
    const w = mountHandle({ width: 500 });
    move(400);
    expect(w.emitted("resize")).toBeUndefined();
  });

  it("dblclick 复位为 500", async () => {
    const w = mountHandle({ width: 700 });
    await w.find(".aipanel-resize-handle").trigger("dblclick");
    expect(lastResize(w)).toEqual([500]);
  });

  it("unmount 后移除 document 监听，不再响应 mousemove", async () => {
    const w = mountHandle({ width: 500 });
    await w.find(".aipanel-resize-handle").trigger("mousedown", { clientX: 500 });
    expect(w.emitted("resize-start")).toHaveLength(1);

    w.unmount();
    wrapper = null;
    move(400);
    expect(w.emitted("resize")).toBeUndefined();
  });
});
