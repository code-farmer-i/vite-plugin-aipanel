/**
 * 组件测试共用夹具：构造 AIPanelWidgetContext（供消费 context 的子组件隔离测试），
 * 并提供 mountWithContext（用真实 provide/inject 链路挂载被测组件，而非 mock 模块）。
 *
 * 该文件不是 *.test.ts，不会被 vitest 采集；文件名以 component- 前缀避免与并行任务冲突。
 */
import { defineComponent, h, ref, type Component, type VNodeChild } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import {
  provideAIPanelWidgetContext,
  type AIPanelWidgetContext,
} from "../src/AI-panel-widget/src/context";
import type {
  AIPanelSelectedElementItem,
  AIPanelSessionThinkingState,
  AIPanelWidgetSessionItem,
  DisplayMode,
} from "../src/AI-panel-widget/src/types";
import type { FloatingBubbleOffset } from "../src/AI-panel-widget/src/components/FloatingBubble/types";

/** 创建一份字段齐全的 context（未覆盖的 action 均为空实现），overrides 覆盖任意字段 */
export function createWidgetContext(
  overrides: Partial<AIPanelWidgetContext> = {},
): AIPanelWidgetContext {
  const noop = () => undefined as unknown as void;
  const context: AIPanelWidgetContext = {
    theme: ref<string>("auto"),
    resolvedTheme: ref<"light" | "dark">("light"),
    title: ref<string>("AI 助手"),
    hotkeyLabel: ref<string>("Ctrl+K"),
    selectShortcutLabel: ref<string>("按 ESC 或 Ctrl+P 退出"),
    selectMode: ref<boolean>(false),
    selectEnabled: ref<boolean>(true),
    sessionListCollapsed: ref<boolean>(true),
    sessionKey: ref<string>("id"),
    frameLoading: ref<boolean>(false),
    loadingSessionList: ref<boolean | undefined>(false),
    showSessionListSkeleton: ref<boolean>(false),
    showEmptyState: ref<boolean>(false),
    showError: ref<boolean>(false),
    emptyStateText: ref<string>("当前项目暂无会话"),
    emptyStateActionText: ref<string>("立即创建"),
    showClearAll: ref<boolean>(true),
    open: ref<boolean>(false),
    thinking: ref<boolean>(false),
    minimized: ref<boolean>(false),
    promptDockVisible: ref<boolean>(true),
    reviewPanelVisible: ref<boolean>(false),
    reviewPanelEnabled: ref<boolean>(false),
    providerSidebar: ref<boolean>(false),
    sidebarCollapseControl: ref<"host" | "provider">("host"),
    bubbleOffset: ref<FloatingBubbleOffset | undefined>(undefined),
    mode: ref<"bubble" | "split">("bubble"),
    displayMode: ref<DisplayMode>("bubble"),
    splitPosition: ref<"left" | "right">("right"),
    sessionStates: ref<Record<string, AIPanelSessionThinkingState>>({}),
    iframeSource: ref<string>("about:blank"),
    buttonActive: ref<boolean>(false),
    sessionListTitle: ref<string>("展开会话列表"),
    bubbleVisible: ref<boolean>(false),
    hasSelectedElements: ref<boolean>(false),
    sessionItems: ref<AIPanelWidgetSessionItem[]>([]),
    selectedElementItems: ref<AIPanelSelectedElementItem[]>([]),
    handleToggle: noop,
    handleClose: noop,
    handleToggleMinimize: noop,
    handleTogglePromptDock: noop,
    handleToggleReviewPanel: noop,
    handleToggleSessionList: noop,
    handleToggleTheme: noop,
    handleToggleDisplayMode: noop,
    handleToggleSplitPosition: noop,
    handleEmptyAction: noop,
    handleCreateSession: noop,
    handleSelectSession: noop,
    handleDeleteSession: noop,
    handleToggleSelectMode: noop,
    handleClickSelectedNode: noop,
    handleRemoveSelectedNode: noop,
    handleClearSelectedNodes: noop,
    handleFrameLoaded: noop,
    handleBubbleOffsetChange: noop,
    handleRefresh: noop,
  };
  return { ...context, ...overrides };
}

export interface MountWithContextOptions {
  context?: AIPanelWidgetContext;
  props?: Record<string, unknown>;
  /** VTU 风格插槽：字符串按原样渲染，函数按插槽函数直接使用 */
  slots?: Record<string, unknown>;
  attachTo?: Element | string;
  stubs?: Record<string, unknown>;
}

/** 归一化 VTU 风格 slots 为 h() 可用的插槽函数 */
function normalizeSlots(
  slots?: Record<string, unknown>,
): Record<string, () => VNodeChild> | undefined {
  if (!slots) return undefined;
  const normalized: Record<string, () => VNodeChild> = {};
  for (const [name, value] of Object.entries(slots)) {
    normalized[name] =
      typeof value === "function" ? (value as () => VNodeChild) : () => value as VNodeChild;
  }
  return normalized;
}

/**
 * 以 provide/inject 真实链路挂载被测组件：Host 组件 provide context，
 * 渲染被测组件。返回 Host 的 wrapper（用 find/findComponent 定位子组件）。
 */
export function mountWithContext(
  component: Component,
  options: MountWithContextOptions = {},
): { wrapper: VueWrapper; context: AIPanelWidgetContext } {
  const context = options.context ?? createWidgetContext();
  const slotFns = normalizeSlots(options.slots);
  const Host = defineComponent({
    name: "AIPanelContextHost",
    setup() {
      provideAIPanelWidgetContext(context);
      return () => h(component, options.props ?? {}, slotFns);
    },
  });
  const wrapper = mount(Host, {
    attachTo: options.attachTo,
    global: { stubs: options.stubs as Record<string, boolean | Component> },
  });
  return { wrapper, context };
}
