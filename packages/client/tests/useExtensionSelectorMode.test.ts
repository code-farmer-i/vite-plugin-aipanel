/**
 * useExtensionSelectorMode 单元测试
 * 覆盖：window message 监听 SELECTOR_START/STOP 回调、notifySelectionResult /
 * notifySelectModeChange 的 postMessage 载荷、unmount 移除监听。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WIDGET_MSG } from "@aipanel/core";
import type { AIPanelSelectedElement } from "@aipanel/core";
import { useExtensionSelectorMode } from "../src/composables/useExtensionSelectorMode";
import { mountComposable } from "./test-utils";

beforeEach(() => {
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function dispatchSelectorMessage(type: string): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type } }));
}

describe("useExtensionSelectorMode", () => {
  it("SELECTOR_START / SELECTOR_STOP 消息驱动 onSelectModeChange", () => {
    const onSelectModeChange = vi.fn();
    const { wrapper } = mountComposable(() => useExtensionSelectorMode({ onSelectModeChange }));
    dispatchSelectorMessage(WIDGET_MSG.SELECTOR_START);
    expect(onSelectModeChange).toHaveBeenLastCalledWith(true);
    dispatchSelectorMessage(WIDGET_MSG.SELECTOR_STOP);
    expect(onSelectModeChange).toHaveBeenLastCalledWith(false);
    dispatchSelectorMessage(WIDGET_MSG.SELECTOR_START);
    expect(onSelectModeChange).toHaveBeenLastCalledWith(true);
    expect(onSelectModeChange).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });

  it("无关消息类型不触发回调", () => {
    const onSelectModeChange = vi.fn();
    const { wrapper } = mountComposable(() => useExtensionSelectorMode({ onSelectModeChange }));
    dispatchSelectorMessage("SOME_OTHER_TYPE");
    expect(onSelectModeChange).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("unmount 后不再监听窗口消息", () => {
    const onSelectModeChange = vi.fn();
    const { wrapper } = mountComposable(() => useExtensionSelectorMode({ onSelectModeChange }));
    wrapper.unmount();
    dispatchSelectorMessage(WIDGET_MSG.SELECTOR_START);
    expect(onSelectModeChange).not.toHaveBeenCalled();
  });

  it("notifySelectionResult 回传 ELEMENT_SELECTED 载荷", () => {
    const { wrapper, api } = mountComposable(() =>
      useExtensionSelectorMode({ onSelectModeChange: vi.fn() }),
    );
    const element: AIPanelSelectedElement = {
      filePath: "/a.ts",
      line: 5,
      column: 3,
      innerText: "foo",
      description: "div",
    };
    api.notifySelectionResult(element);
    expect(window.postMessage).toHaveBeenCalledTimes(1);
    expect(window.postMessage).toHaveBeenCalledWith(
      {
        type: WIDGET_MSG.ELEMENT_SELECTED,
        filePath: "/a.ts",
        line: 5,
        column: 3,
        innerText: "foo",
        description: "div",
      },
      "*",
    );
    wrapper.unmount();
  });

  it("携带 serviceInstanceId 时随回传消息一起携带，供 Side Panel 多实例隔离", () => {
    const { wrapper, api } = mountComposable(() =>
      useExtensionSelectorMode({ serviceInstanceId: "inst-1", onSelectModeChange: vi.fn() }),
    );
    api.notifySelectionResult({
      filePath: "/a.ts",
      line: 1,
      column: 1,
      innerText: "x",
      description: "div",
    });
    expect(window.postMessage).toHaveBeenLastCalledWith(
      {
        type: WIDGET_MSG.ELEMENT_SELECTED,
        serviceInstanceId: "inst-1",
        filePath: "/a.ts",
        line: 1,
        column: 1,
        innerText: "x",
        description: "div",
      },
      "*",
    );
    api.notifySelectModeChange(true);
    expect(window.postMessage).toHaveBeenLastCalledWith(
      { type: WIDGET_MSG.SELECTOR_START, serviceInstanceId: "inst-1" },
      "*",
    );
    wrapper.unmount();
  });

  it("notifySelectModeChange 广播 SELECTOR_START/STOP", () => {
    const { wrapper, api } = mountComposable(() =>
      useExtensionSelectorMode({ onSelectModeChange: vi.fn() }),
    );
    api.notifySelectModeChange(true);
    expect(window.postMessage).toHaveBeenLastCalledWith({ type: WIDGET_MSG.SELECTOR_START }, "*");
    api.notifySelectModeChange(false);
    expect(window.postMessage).toHaveBeenLastCalledWith({ type: WIDGET_MSG.SELECTOR_STOP }, "*");
    wrapper.unmount();
  });
});
