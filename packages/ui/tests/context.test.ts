/**
 * 覆盖目标：context.ts（AIPanelWidgetContext 的 provide/inject 契约）
 * - 契约完整性：context 的响应式字段均为 Ref、action 均为函数，字段集合与类型定义一致
 * - 默认行为：createWidgetContext 的默认 action 为空实现，调用不抛错
 * - provide/inject：同一实例可被子组件、孙组件注入（跨层级）
 *
 * 策略：以显式字段清单守护契约（防止字段被误删/改名），并用真实组件树验证注入链路。
 * 说明：无 provider 抛错、provide 后同引用已由 component-export-surface.test.ts 覆盖，此处不重复。
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, isRef } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import {
  provideAIPanelWidgetContext,
  useAIPanelWidgetContext,
  type AIPanelWidgetContext,
} from "../src/AI-panel-widget/src/context";
import { createWidgetContext } from "./component-widget-context";

/** context 中应为 Ref 的字段（对应 context.ts 的 AIPanelWidgetContext 契约） */
const REF_FIELDS = [
  "theme",
  "resolvedTheme",
  "title",
  "hotkeyLabel",
  "selectShortcutLabel",
  "selectMode",
  "selectEnabled",
  "sessionListCollapsed",
  "sessionKey",
  "frameLoading",
  "loadingSessionList",
  "showSessionListSkeleton",
  "showEmptyState",
  "showError",
  "emptyStateText",
  "emptyStateActionText",
  "showClearAll",
  "open",
  "thinking",
  "minimized",
  "promptDockVisible",
  "reviewPanelVisible",
  "reviewPanelEnabled",
  "providerSidebar",
  "sidebarCollapseControl",
  "bubbleOffset",
  "mode",
  "displayMode",
  "splitPosition",
  "sessionStates",
  "iframeSource",
  "buttonActive",
  "sessionListTitle",
  "bubbleVisible",
  "hasSelectedElements",
  "sessionItems",
  "selectedElementItems",
] as const satisfies readonly (keyof AIPanelWidgetContext)[];

/** context 中应为函数的 action 字段 */
const ACTION_FIELDS = [
  "handleToggle",
  "handleClose",
  "handleToggleMinimize",
  "handleTogglePromptDock",
  "handleToggleReviewPanel",
  "handleToggleSessionList",
  "handleToggleTheme",
  "handleToggleDisplayMode",
  "handleToggleSplitPosition",
  "handleEmptyAction",
  "handleCreateSession",
  "handleSelectSession",
  "handleDeleteSession",
  "handleToggleSelectMode",
  "handleClickSelectedNode",
  "handleRemoveSelectedNode",
  "handleClearSelectedNodes",
  "handleFrameLoaded",
  "handleBubbleOffsetChange",
  "handleRefresh",
] as const satisfies readonly (keyof AIPanelWidgetContext)[];

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("context 契约", () => {
  it("字段集合完整且类型正确（响应式字段为 Ref、action 为函数）", () => {
    const context = createWidgetContext();
    const expectedKeys = [...REF_FIELDS, ...ACTION_FIELDS].sort();
    expect(Object.keys(context).sort()).toEqual(expectedKeys);

    for (const key of REF_FIELDS) {
      expect(isRef(context[key]), `${key} 应为 Ref`).toBe(true);
    }
    for (const key of ACTION_FIELDS) {
      expect(typeof context[key], `${key} 应为函数`).toBe("function");
    }
  });

  it("默认 action 均为空实现，调用不抛错", () => {
    const context = createWidgetContext();
    for (const key of ACTION_FIELDS) {
      expect(() => (context[key] as (...args: unknown[]) => unknown)()).not.toThrow();
      expect((context[key] as (...args: unknown[]) => unknown)()).toBeUndefined();
    }
  });

  it("provide 的实例可跨层级（子/孙组件）注入且为同一对象", () => {
    const context = createWidgetContext();
    const injected: AIPanelWidgetContext[] = [];
    const GrandChild = defineComponent({
      setup() {
        injected.push(useAIPanelWidgetContext());
        return () => null;
      },
    });
    const Child = defineComponent({
      setup() {
        injected.push(useAIPanelWidgetContext());
        return () => h(GrandChild);
      },
    });
    const Host = defineComponent({
      setup() {
        provideAIPanelWidgetContext(context);
        return () => h(Child);
      },
    });

    wrapper = mount(Host);
    expect(injected).toHaveLength(2);
    expect(injected[0]).toBe(context);
    expect(injected[1]).toBe(context);
  });
});
