/**
 * @vitest-environment jsdom
 *
 * @aipanel/core 元素选择器适配器层单元测试。
 *
 * 覆盖目标：
 *  - parseSourceLocation：解析 "文件:行:列" 标记，非法输入返回 null；
 *  - 注册表：listInspectorAdapters 暴露静态元数据（忽略标记），resolveInspectorAdapter 只在运行时注入后可用；
 *  - Vue 适配器：源码位置解析（标记属性 / 祖先 / Vue 实例 __file / 优先非 node_modules / 跳过自带覆盖层）、
 *    setEnabled 透传 enable/disable、onElementClick 只安装一次且按宿主返回值决定是否抑制默认行为。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { INSPECTOR_ADAPTER_IDS } from "../src/common/constants";
import {
  listInspectorAdapters,
  parseSourceLocation,
  resolveInspectorAdapter,
} from "../src/common/inspector";
import { vueInspectorAdapter } from "../src/common/inspector/vue";

type Runtime = NonNullable<typeof window.__VUE_INSPECTOR__>;

function createRuntime() {
  const handleClick = vi.fn();
  const enable = vi.fn();
  const disable = vi.fn();
  const runtime: Runtime = { handleClick, enable, disable };
  return { runtime, handleClick, enable, disable };
}

function appendElement(tag = "div"): HTMLElement {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  delete window.__VUE_INSPECTOR__;
  document.body.innerHTML = "";
});

describe("parseSourceLocation", () => {
  it("解析 文件:行:列", () => {
    expect(parseSourceLocation("/proj/src/App.vue:12:3")).toEqual({
      file: "/proj/src/App.vue",
      line: 12,
      column: 3,
    });
  });

  it("非法输入返回 null", () => {
    expect(parseSourceLocation("/proj/src/App.vue")).toBeNull();
    expect(parseSourceLocation("12:3")).toBeNull();
  });
});

describe("适配器注册表", () => {
  it("已登记 Vue 适配器，并暴露其忽略标记（宿主无需硬编码）", () => {
    const adapters = listInspectorAdapters();
    expect(adapters.map((adapter) => adapter.id)).toContain(INSPECTOR_ADAPTER_IDS.vue);
    expect(adapters[0].label).toBe("Vue Inspector");
    expect(adapters[0].ignoreSelectors).toContain("#vue-inspector-container");
    expect(adapters[0].ignoreAttributes).toContain("data-v-inspector-ignore");
  });

  it("运行时未注入时无可用适配器，注入后可解析到", () => {
    expect(resolveInspectorAdapter()).toBeNull();

    const { runtime } = createRuntime();
    window.__VUE_INSPECTOR__ = runtime;

    expect(resolveInspectorAdapter()).toBe(vueInspectorAdapter);
  });
});

describe("Vue 适配器", () => {
  it("setEnabled 透传 enable/disable，运行时缺失时不抛错", () => {
    const { runtime, enable, disable } = createRuntime();
    window.__VUE_INSPECTOR__ = runtime;

    vueInspectorAdapter.setEnabled(true);
    vueInspectorAdapter.setEnabled(false);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(disable).toHaveBeenCalledTimes(1);

    delete window.__VUE_INSPECTOR__;
    expect(() => vueInspectorAdapter.setEnabled(true)).not.toThrow();
  });

  it("从标记属性解析源码位置（自身未命中时向祖先查找）", () => {
    const parent = appendElement();
    parent.setAttribute("data-v-inspector", "/proj/src/Parent.vue:5:2");
    const child = document.createElement("span");
    parent.appendChild(child);

    expect(vueInspectorAdapter.resolveSourceLocation(child)).toEqual({
      file: "/proj/src/Parent.vue",
      line: 5,
      column: 2,
    });
  });

  it("跳过自带覆盖层与忽略标记节点，继续向父级解析", () => {
    const parent = appendElement();
    parent.setAttribute("data-v-inspector", "/proj/src/Parent.vue:7:1");
    const ignored = document.createElement("div");
    ignored.setAttribute("data-v-inspector-ignore", "");
    parent.appendChild(ignored);

    expect(vueInspectorAdapter.resolveSourceLocation(ignored)).toEqual({
      file: "/proj/src/Parent.vue",
      line: 7,
      column: 1,
    });
  });

  it("无标记时回退到 Vue 组件实例的 __file（仅文件），并优先非 node_modules", () => {
    const el = appendElement() as HTMLElement & {
      __vueParentComponent?: { type?: { __file?: string } };
    };
    el.__vueParentComponent = { type: { __file: "node_modules/dep/src/Comp.vue" } };
    expect(vueInspectorAdapter.resolveSourceLocation(el)).toEqual({
      file: "node_modules/dep/src/Comp.vue",
      line: null,
      column: null,
    });

    el.setAttribute("data-v-inspector", "/proj/src/Comp.vue:3:1");
    expect(vueInspectorAdapter.resolveSourceLocation(el)).toEqual({
      file: "/proj/src/Comp.vue",
      line: 3,
      column: 1,
    });
  });

  it("无任何标记与实例信息时返回 null", () => {
    expect(vueInspectorAdapter.resolveSourceLocation(appendElement())).toBeNull();
  });

  it("onElementClick 只安装一次，按宿主返回值决定是否抑制默认行为", () => {
    const { runtime, handleClick: original } = createRuntime();
    window.__VUE_INSPECTOR__ = runtime;

    const onTakeOver = vi.fn(() => true);
    vueInspectorAdapter.onElementClick(onTakeOver);
    expect(runtime.__aipanel_hooked).toBe(true);

    // 重复安装不叠加包装：后注册的处理器生效
    const onPassThrough = vi.fn(() => false);
    vueInspectorAdapter.onElementClick(onPassThrough);

    const el = appendElement();
    const takenOver = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(takenOver);
    runtime.handleClick(takenOver);

    expect(onPassThrough).toHaveBeenCalledWith(el, takenOver);
    expect(onTakeOver).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledWith(takenOver);

    onPassThrough.mockReturnValue(true);
    const consumed = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(consumed);
    const consumedStop = vi.spyOn(consumed, "stopPropagation");
    runtime.handleClick(consumed);

    expect(consumed.defaultPrevented).toBe(true);
    expect(consumedStop).toHaveBeenCalled();
    expect(original).toHaveBeenCalledTimes(1);
  });
});
