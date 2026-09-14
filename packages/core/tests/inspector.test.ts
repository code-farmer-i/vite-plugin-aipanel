/**
 * @vitest-environment jsdom
 *
 * @aipanel/core 元素选择器适配器层单元测试。
 *
 * 覆盖目标：
 *  - parseSourceLocation：解析 "文件:行:列" 标记，非法输入返回 null；
 *  - 注册表：listInspectorAdapters 暴露静态元数据（忽略标记），resolveInspectorAdapter 只在运行时注入后可用；
 *  - Vue 适配器：源码位置解析（标记属性 / 祖先 / Vue 实例 __file / 优先非 node_modules / 跳过自带覆盖层）、
 *    setEnabled 透传 enable/disable、onElementClick 只安装一次且按宿主返回值决定是否抑制默认行为；
 *  - React 适配器：data-insp-path 标记（含节点名后缀）与祖先解析、react-dev-inspector 兼容属性、
 *    fiber._debugSource 兜底、运行时探测（fiber 键）、自装点击监听的启用与接管。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { INSPECTOR_ADAPTER_IDS } from "../src/common/constants";
import {
  listInspectorAdapters,
  parseSourceLocation,
  resolveInspectorAdapter,
} from "../src/common/inspector";
import { reactInspectorAdapter } from "../src/common/inspector/react";
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

/** 在元素上模拟 React 注入的 fiber 内部键（可枚举，与真实 React 行为一致） */
function attachFiberKey(element: HTMLElement, fiber: unknown, key = "__reactFiber$test"): void {
  Object.defineProperty(element, key, { value: fiber, configurable: true, enumerable: true });
}

afterEach(() => {
  delete window.__VUE_INSPECTOR__;
  reactInspectorAdapter.setEnabled(false);
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

describe("React 适配器", () => {
  it("注册表已登记 React 适配器", () => {
    const adapters = listInspectorAdapters();
    expect(adapters.map((adapter) => adapter.id)).toContain(INSPECTOR_ADAPTER_IDS.react);
    const react = adapters.find((adapter) => adapter.id === INSPECTOR_ADAPTER_IDS.react);
    expect(react?.label).toBe("React Inspector");
  });

  it("isAvailable 检测元素上的 React fiber 内部键", () => {
    expect(reactInspectorAdapter.isAvailable()).toBe(false);

    const el = appendElement();
    attachFiberKey(el, {});
    expect(reactInspectorAdapter.isAvailable()).toBe(true);
  });

  it("从 data-insp-path 解析源码位置（值含节点名后缀，自动剥离）", () => {
    const el = appendElement();
    el.setAttribute("data-insp-path", "/proj/src/App.tsx:9:5:div");

    expect(reactInspectorAdapter.resolveSourceLocation(el)).toEqual({
      file: "/proj/src/App.tsx",
      line: 9,
      column: 5,
    });
  });

  it("自身未命中标记时向祖先查找", () => {
    const parent = appendElement();
    parent.setAttribute("data-insp-path", "/proj/src/Parent.tsx:3:1:section");
    const child = document.createElement("span");
    parent.appendChild(child);

    expect(reactInspectorAdapter.resolveSourceLocation(child)).toEqual({
      file: "/proj/src/Parent.tsx",
      line: 3,
      column: 1,
    });
  });

  it("兼容读取 react-dev-inspector 注入的分散属性", () => {
    const el = appendElement();
    el.setAttribute("data-inspector-relative-path", "/proj/src/App.tsx");
    el.setAttribute("data-inspector-line", "12");
    el.setAttribute("data-inspector-column", "7");

    expect(reactInspectorAdapter.resolveSourceLocation(el)).toEqual({
      file: "/proj/src/App.tsx",
      line: 12,
      column: 7,
    });
  });

  it("无标记时回退 fiber._debugSource（columnNumber 转 1 基），并沿 fiber.return 上溯", () => {
    const el = appendElement();
    attachFiberKey(el, {
      return: {
        _debugSource: { fileName: "/proj/src/App.tsx", lineNumber: 4, columnNumber: 2 },
        return: null,
      },
    });

    expect(reactInspectorAdapter.resolveSourceLocation(el)).toEqual({
      file: "/proj/src/App.tsx",
      line: 4,
      column: 3,
    });
  });

  it("注入标记优先于 fiber 兜底", () => {
    const el = appendElement();
    el.setAttribute("data-insp-path", "/proj/src/App.tsx:9:5:div");
    attachFiberKey(el, {
      _debugSource: { fileName: "/proj/src/FromFiber.tsx", lineNumber: 1, columnNumber: 0 },
      return: null,
    });

    expect(reactInspectorAdapter.resolveSourceLocation(el)?.file).toBe("/proj/src/App.tsx");
  });

  it("无任何标记与 fiber 信息时返回 null", () => {
    expect(reactInspectorAdapter.resolveSourceLocation(appendElement())).toBeNull();
  });

  it("onElementClick 自装捕获监听，仅启用时接管并抑制默认行为", () => {
    const onTakeOver = vi.fn(() => true);
    reactInspectorAdapter.onElementClick(onTakeOver);

    const el = appendElement();
    const disabled = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(disabled);
    expect(onTakeOver).not.toHaveBeenCalled();
    expect(disabled.defaultPrevented).toBe(false);

    reactInspectorAdapter.setEnabled(true);
    const enabled = new MouseEvent("click", { bubbles: true, cancelable: true });
    const enabledStop = vi.spyOn(enabled, "stopPropagation");
    el.dispatchEvent(enabled);

    expect(onTakeOver).toHaveBeenCalledWith(el, enabled);
    expect(enabled.defaultPrevented).toBe(true);
    expect(enabledStop).toHaveBeenCalled();
  });

  it("宿主处理器返回 false 时放行默认行为", () => {
    const onPassThrough = vi.fn(() => false);
    reactInspectorAdapter.onElementClick(onPassThrough);
    reactInspectorAdapter.setEnabled(true);

    const el = appendElement();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(event);

    expect(onPassThrough).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
