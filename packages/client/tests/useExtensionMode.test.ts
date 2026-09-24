/**
 * useExtensionMode 单元测试
 * 覆盖：onMessage 注册/反注册、按 serviceInstanceId 过滤、ELEMENT_SELECTED 字段归一、
 * SELECTOR_START/STOP 与 SELECTION_CANCELLED 对 selectMode 的同步、THEME_CHANGE 回调、
 * onSelectModeChange（tabs.query + sendMessage）、broadcastTheme。chrome stub 手动触发监听。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { WIDGET_MSG, EXT_MSG } from "@aipanel/core";
import type { AIPanelSelectedElement } from "@aipanel/core";
import { useExtensionMode } from "../src/composables/useExtensionMode";
import { useExtensionSelectorMode } from "../src/composables/useExtensionSelectorMode";
import { mountComposable } from "./test-utils";

type AnyMsg = Record<string, unknown>;

let listeners: Array<(msg: AnyMsg) => void>;
let chromeStub: {
  runtime: {
    onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
    sendMessage: ReturnType<typeof vi.fn>;
  };
  tabs: { query: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  listeners = [];
  chromeStub = {
    runtime: {
      onMessage: {
        addListener: vi.fn((h: (msg: AnyMsg) => void) => listeners.push(h)),
        removeListener: vi.fn(),
      },
      sendMessage: vi.fn(async () => ({})),
    },
    tabs: {
      query: vi.fn(async () => [{ id: 5, index: 0 }]),
      sendMessage: vi.fn(async () => ({})),
    },
  };
  vi.stubGlobal("chrome", chromeStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useExtensionMode", () => {
  it("挂载注册监听，卸载移除同一监听", () => {
    const selectMode = ref(false);
    const { wrapper } = mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected: vi.fn(),
      }),
    );
    expect(chromeStub.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(1);
    wrapper.unmount();
    expect(chromeStub.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    expect(chromeStub.runtime.onMessage.removeListener.mock.calls[0][0]).toBe(listeners[0]);
  });

  it("ELEMENT_SELECTED 字段归一为 AIPanelSelectedElement 并携带 pageUrl", () => {
    const selectMode = ref(false);
    const onElementSelected = vi.fn();
    mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected,
      }),
    );
    const msg: AnyMsg = {
      type: WIDGET_MSG.ELEMENT_SELECTED,
      serviceInstanceId: "inst-1",
      filePath: "/src/main.ts",
      line: 42,
      column: 7,
      innerText: "const x = 1",
      description: "span",
      pageUrl: "http://page/url",
    };
    listeners[0](msg);
    expect(onElementSelected).toHaveBeenCalledTimes(1);
    expect(onElementSelected).toHaveBeenCalledWith(
      {
        filePath: "/src/main.ts",
        line: 42,
        column: 7,
        innerText: "const x = 1",
        description: "span",
      },
      "http://page/url",
    );
  });

  it("ELEMENT_SELECTED 缺省字段回退 null/空串", () => {
    const selectMode = ref(false);
    const onElementSelected = vi.fn();
    mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected,
      }),
    );
    listeners[0]({ type: WIDGET_MSG.ELEMENT_SELECTED, serviceInstanceId: "inst-1" });
    const received: AIPanelSelectedElement = onElementSelected.mock
      .calls[0][0] as AIPanelSelectedElement;
    expect(received).toEqual({
      filePath: null,
      line: null,
      column: null,
      innerText: "",
      description: undefined,
    });
  });

  it("serviceInstanceId 不匹配时忽略消息", () => {
    const selectMode = ref(false);
    const onElementSelected = vi.fn();
    mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected,
      }),
    );
    listeners[0]({
      type: WIDGET_MSG.ELEMENT_SELECTED,
      serviceInstanceId: "inst-2",
      filePath: "/x.ts",
    });
    expect(onElementSelected).not.toHaveBeenCalled();
  });

  it("页面回传的选择结果只被对应项目的实例处理（端到端隔离）", () => {
    // 项目 A 页面侧：经真实发送逻辑回传选择结果
    const postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const { api: pageA } = mountComposable(() =>
      useExtensionSelectorMode({ serviceInstanceId: "inst-A", onSelectModeChange: vi.fn() }),
    );
    // Side Panel 同时保活 A / B 两个项目实例
    const onSelectedA = vi.fn();
    const onSelectedB = vi.fn();
    mountComposable(() =>
      useExtensionMode({
        selectMode: ref(false),
        serviceInstanceId: "inst-A",
        onElementSelected: onSelectedA,
      }),
    );
    mountComposable(() =>
      useExtensionMode({
        selectMode: ref(false),
        serviceInstanceId: "inst-B",
        onElementSelected: onSelectedB,
      }),
    );

    pageA.notifySelectionResult({
      filePath: "/a.ts",
      line: 1,
      column: 1,
      innerText: "x",
      description: "div",
    });
    // Content Script 会原样转发页面 postMessage 的载荷，再投递给所有已注册监听器
    const calls = postSpy.mock.calls;
    const forwarded = calls[calls.length - 1][0] as AnyMsg;
    listeners.forEach((handle) => handle(forwarded));

    expect(onSelectedA).toHaveBeenCalledTimes(1);
    expect(onSelectedB).not.toHaveBeenCalled();
  });

  it("选择类消息缺少 serviceInstanceId 时忽略，避免其他项目实例串扰", () => {
    const selectMode = ref(false);
    const onElementSelected = vi.fn();
    mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected,
      }),
    );
    listeners[0]({ type: WIDGET_MSG.ELEMENT_SELECTED, filePath: "/x.ts" });
    expect(onElementSelected).not.toHaveBeenCalled();
    listeners[0]({ type: WIDGET_MSG.SELECTOR_START });
    expect(selectMode.value).toBe(false);
  });

  it("SELECTOR_START / STOP / SELECTION_CANCELLED 同步 selectMode", () => {
    const selectMode = ref(false);
    mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected: vi.fn(),
      }),
    );
    listeners[0]({ type: WIDGET_MSG.SELECTOR_START, serviceInstanceId: "inst-1" });
    expect(selectMode.value).toBe(true);
    listeners[0]({ type: WIDGET_MSG.SELECTOR_STOP, serviceInstanceId: "inst-1" });
    expect(selectMode.value).toBe(false);
    listeners[0]({ type: WIDGET_MSG.SELECTOR_START, serviceInstanceId: "inst-1" });
    expect(selectMode.value).toBe(true);
    listeners[0]({ type: WIDGET_MSG.SELECTION_CANCELLED, serviceInstanceId: "inst-1" });
    expect(selectMode.value).toBe(false);
  });

  it("THEME_CHANGE 触发 onThemeChange；无 theme 或实例不匹配时忽略", () => {
    const selectMode = ref(false);
    const onThemeChange = vi.fn();
    mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected: vi.fn(),
        onThemeChange,
      }),
    );
    listeners[0]({ type: EXT_MSG.THEME_CHANGE, serviceInstanceId: "inst-1", theme: "dark" });
    expect(onThemeChange).toHaveBeenCalledWith("dark");
    listeners[0]({ type: EXT_MSG.THEME_CHANGE, serviceInstanceId: "inst-1" });
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    listeners[0]({ type: EXT_MSG.THEME_CHANGE, serviceInstanceId: "inst-2", theme: "light" });
    expect(onThemeChange).toHaveBeenCalledTimes(1);
  });

  it("onSelectModeChange 向 active tab 发送选择指令", async () => {
    const selectMode = ref(false);
    const { wrapper, api } = mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected: vi.fn(),
      }),
    );
    api.onSelectModeChange(true);
    await flushPromises();
    expect(chromeStub.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(5, { type: EXT_MSG.SELECTION_START });
    api.onSelectModeChange(false);
    await flushPromises();
    expect(chromeStub.tabs.sendMessage).toHaveBeenLastCalledWith(5, {
      type: EXT_MSG.SELECTION_STOP,
    });
    wrapper.unmount();
  });

  it("locateNode 优先发给 URL 匹配的 Tab（用户可能已切走）", async () => {
    const element: AIPanelSelectedElement = {
      filePath: "/p/a.vue",
      line: 3,
      column: 1,
      innerText: "x",
      description: "div.a",
      previewPageUrl: "http://localhost:5173/#/index",
    };
    chromeStub.tabs.query.mockImplementation(async (query?: { active?: boolean }) =>
      query?.active
        ? [{ id: 5, index: 0, url: "http://localhost:3000/" }]
        : [
            { id: 7, index: 1, url: "http://localhost:5173/#/index" },
            { id: 5, index: 0, url: "http://localhost:3000/" },
          ],
    );
    const { wrapper, api } = mountComposable(() =>
      useExtensionMode({
        selectMode: ref(false),
        serviceInstanceId: "inst-1",
        onElementSelected: vi.fn(),
      }),
    );

    await api.locateNode(element);

    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: EXT_MSG.LOCATE_NODE,
      element,
    });
    wrapper.unmount();
  });

  it("locateNode 无匹配 Tab 时回退当前活跃 Tab", async () => {
    const element: AIPanelSelectedElement = {
      filePath: null,
      line: null,
      column: null,
      innerText: "x",
      description: "div.a",
      previewPageUrl: "http://localhost:9999/#/app",
    };
    const { wrapper, api } = mountComposable(() =>
      useExtensionMode({
        selectMode: ref(false),
        serviceInstanceId: "inst-1",
        onElementSelected: vi.fn(),
      }),
    );

    await api.locateNode(element);

    expect(chromeStub.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(5, {
      type: EXT_MSG.LOCATE_NODE,
      element,
    });
    wrapper.unmount();
  });

  it("broadcastTheme 通过 runtime.sendMessage 广播主题", async () => {
    const selectMode = ref(false);
    const { wrapper, api } = mountComposable(() =>
      useExtensionMode({
        selectMode,
        serviceInstanceId: "inst-1",
        onElementSelected: vi.fn(),
      }),
    );
    api.broadcastTheme("dark");
    await flushPromises();
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({
      type: EXT_MSG.THEME_CHANGE,
      theme: "dark",
    });
    wrapper.unmount();
  });
});
