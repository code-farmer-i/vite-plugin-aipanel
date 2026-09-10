/**
 * 覆盖目标：AI-panel-widget 主组件 index.vue（挂载 + 关键交互）
 * - 初始化渲染与主题 class（light/dark）、气泡模式默认挂载
 * - 气泡点击开关面板、关闭、最小化、主题切换、展示模式切换（气泡 <-> 分栏）
 * - 选择模式按钮与提示条、会话列表折叠开关
 * - 清空已选确认弹窗（确认/取消两条路径）
 * - 持久化恢复（localStorage → emits 与展示模式）
 * - hideBubble / providerSidebar+sidebarCollapseControl / extension 场景的可见性
 * - iframe load → frame-loaded；Provider 侧栏状态回传
 * - 暴露的 showNotification（自动消失）与 showConfirmDialog
 *
 * 策略：iframe 在 jsdom 不加载，用 teleport stub 让 Trigger 气泡内联；持久化用
 * usePersistState 自身写入以确定存储键（不硬编码）；afterEach 统一卸载并清理 localStorage/定时器。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { NOTIFICATION_DURATION, WIDGET_MSG, type AIPanelWidgetProps } from "@aipanel/core";
import AIPanelWidget from "../src/AI-panel-widget/src/index.vue";
import {
  usePersistState,
  type WidgetPersistState,
} from "../src/AI-panel-widget/composables/use-persist-state";
import { mountComposable, unmountAll, flushVue } from "./helpers";

/** index.vue 通过 defineExpose 暴露的命令式 API（组件实例类型上不可见，单独声明） */
interface WidgetExposed {
  showNotification(
    message: string,
    options?: { duration?: number; mode?: "widget" | "page" },
  ): void;
  showConfirmDialog(message: string): Promise<boolean>;
}

let widget: VueWrapper | null = null;

function mountWidget(props: Partial<AIPanelWidgetProps> = {}) {
  widget?.unmount();
  widget = mount(AIPanelWidget, {
    props,
    global: { stubs: { teleport: true } },
  });
  return widget;
}

/** 拿到暴露的命令式 API（强类型视图） */
function exposed(w: VueWrapper): WidgetExposed {
  return w.vm as unknown as WidgetExposed;
}

/** 用 usePersistState 自身写入状态以确定存储键，避免测试硬编码源码私有存储键 */
async function seedPersistedState(state: WidgetPersistState): Promise<void> {
  const seed = mountComposable(() =>
    usePersistState({
      open: ref(state.open),
      minimized: ref(state.minimized),
      promptDockVisible: ref(state.promptDockVisible),
      reviewPanelVisible: ref(state.reviewPanelVisible),
      bubbleOffset: ref(state.bubbleOffset),
      theme: ref(state.theme),
      sessionListCollapsed: ref(state.sessionListCollapsed),
      splitPanelWidth: ref(state.splitPanelWidth ?? 500),
      displayMode: ref(state.displayMode ?? "bubble"),
      splitPosition: ref(state.splitPosition ?? "right"),
    }),
  );
  seed.ctx.persistState();
  await unmountAll();
}

afterEach(async () => {
  vi.useRealTimers();
  widget?.unmount();
  widget = null;
  await unmountAll();
  localStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("AIPanelWidget 主组件", () => {
  it("初始化渲染：根容器主题类、气泡、面板与标题", () => {
    const w = mountWidget();
    const root = w.find(".aipanel-widget");
    expect(root.exists()).toBe(true);
    expect(root.classes()).toContain("aipanel-theme-light");
    expect(w.find(".aipanel-button").exists()).toBe(true);
    expect(w.find(".aipanel-chat").exists()).toBe(true);
    expect(w.find(".aipanel-chat-header-title").text()).toBe("AI 助手");
    // 默认未打开
    expect(w.find(".aipanel-notification").exists()).toBe(false);
  });

  it("theme=dark 时根容器与气泡按钮切换为深色主题类", () => {
    const w = mountWidget({ theme: "dark" });
    expect(w.find(".aipanel-widget").classes()).toContain("aipanel-theme-dark");
    expect(w.find(".aipanel-button").classes()).toContain("aipanel-theme-dark");
  });

  it("点击气泡切换面板 open 并 emit toggle / update:open", async () => {
    const w = mountWidget();
    await w.find(".aipanel-button").trigger("click");
    expect(w.emitted("update:open")).toEqual([[true]]);
    expect(w.emitted("toggle")).toEqual([[true]]);
  });

  it("关闭按钮 emit close 与 update:open(false)", async () => {
    const w = mountWidget({ open: true });
    await w.find(".close").trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
    expect(w.emitted("update:open")).toEqual([[false]]);
  });

  it("header 主题按钮按 WIDGET_THEME_MODES 循环 emit", async () => {
    const w = mountWidget({ theme: "auto" });
    await w.find(".theme-btn").trigger("click");
    expect(w.emitted("update:theme")).toEqual([["light"]]);
    expect(w.emitted("toggle-theme")).toEqual([["light"]]);
  });

  it("最小化：按钮态切换并联动对话框可见性", async () => {
    const w = mountWidget({ open: true });
    const before = w.find(".minimize");
    expect(before.attributes("title")).toBe("最小化");

    await before.trigger("click");
    expect(w.find(".minimize").attributes("title")).toBe("展开");
    expect(w.find(".minimize").attributes("aria-pressed")).toBe("true");
    expect(w.find(".prompt-dock").attributes("title")).toBe("显示对话框");
  });

  it("选择模式：按钮切换 emit，selectMode 为真时显示提示条", async () => {
    const off = mountWidget();
    await off.find(".select-btn").trigger("click");
    expect(off.emitted("update:selectMode")).toEqual([[true]]);
    expect(off.emitted("toggle-select-mode")).toEqual([[true]]);

    const on = mountWidget({ selectMode: true });
    expect(on.find(".aipanel-select-mode-hint").classes()).toContain("visible");
    expect(on.find(".select-btn").classes()).toContain("active");
  });

  it("会话列表折叠开关：默认折叠，点击展开并 emit", async () => {
    const w = mountWidget();
    expect(w.find(".aipanel-session-list").classes()).toContain("collapsed");

    await w.find(".session-toggle").trigger("click");
    expect(w.emitted("update:sessionListCollapsed")).toEqual([[false]]);
    expect(w.emitted("toggle-session-list")).toEqual([[false]]);
    expect(w.find(".aipanel-session-list").classes()).not.toContain("collapsed");
  });

  it("分栏模式：隐藏气泡、显示分栏切换按钮，点击 emit toggle", async () => {
    const w = mountWidget({ displayMode: "split" });
    expect(w.find(".aipanel-button").exists()).toBe(false);
    expect(w.find(".aipanel-chat").classes()).toContain("split-mode");

    // split 模式默认展开：挂载时已 emit 一次 update:open
    const beforeOpen = w.emitted("update:open")?.length ?? 0;
    const beforeToggle = w.emitted("toggle")?.length ?? 0;

    await w.find(".aipanel-split-toggle-btn").trigger("click");
    expect(w.emitted("update:open")?.length).toBe(beforeOpen + 1);
    expect(w.emitted("update:open")?.[beforeOpen]).toEqual([true]);
    expect(w.emitted("toggle")?.length).toBe(beforeToggle + 1);
  });

  it("展示模式按钮在气泡与分栏间切换", async () => {
    const w = mountWidget({ displayMode: "bubble" });
    expect(w.find(".aipanel-button").exists()).toBe(true);

    await w.find(".display-mode-btn").trigger("click");
    expect(w.find(".aipanel-button").exists()).toBe(false);
    expect(w.find(".aipanel-chat").classes()).toContain("split-mode");
  });

  it("清空已选节点：弹确认框，确认后 emit；取消不 emit", async () => {
    const element = {
      filePath: "/a/Foo.tsx",
      line: 3,
      column: 1,
      innerText: "hello",
      description: "button.foo",
    };
    const w = mountWidget({ selectedElements: [element] });

    await w.find(".aipanel-clear-all-btn").trigger("click");
    expect(w.find(".aipanel-dialog-message").text()).toBe("确定要清空所有 1 个已选节点吗？");

    // 先取消：不应产生清除事件
    await w.find(".aipanel-dialog-btn.cancel").trigger("click");
    expect(w.find(".aipanel-dialog-overlay").exists()).toBe(false);
    expect(w.emitted("clear-selected-nodes")).toBeUndefined();

    await w.find(".aipanel-clear-all-btn").trigger("click");
    await w.find(".aipanel-dialog-btn.confirm").trigger("click");
    expect(w.emitted("clear-selected-nodes")).toHaveLength(1);
    // emit("update:selectedElements", []) => 调用参数为 [ [] ]
    expect(w.emitted("update:selectedElements")).toStrictEqual([[[]]]);
  });

  it("持久化恢复：localStorage 中的 open/theme/sessionListCollapsed/displayMode 生效", async () => {
    await seedPersistedState({
      open: true,
      minimized: false,
      promptDockVisible: true,
      reviewPanelVisible: false,
      theme: "dark",
      sessionListCollapsed: false,
      displayMode: "split",
      splitPosition: "right",
      splitPanelWidth: 500,
    });

    const w = mountWidget();
    expect(w.emitted("update:open")).toEqual([[true]]);
    expect(w.emitted("toggle")).toEqual([[true]]);
    expect(w.emitted("update:theme")).toEqual([["dark"]]);
    expect(w.emitted("toggle-theme")).toEqual([["dark"]]);
    expect(w.emitted("update:sessionListCollapsed")).toEqual([[false]]);
    // displayMode 恢复为 split：分栏模式下不再渲染气泡按钮
    await flushVue();
    expect(w.find(".aipanel-button").exists()).toBe(false);
  });

  it("hideBubble 时不渲染悬浮气泡", () => {
    const w = mountWidget({ hideBubble: true });
    expect(w.find(".aipanel-button").exists()).toBe(false);
  });

  it("providerSidebar 且折叠开关归 Provider 时隐藏宿主侧栏开关", () => {
    const hostControl = mountWidget({ providerSidebar: true, sidebarCollapseControl: "host" });
    expect(hostControl.find(".session-toggle").exists()).toBe(true);

    const providerControl = mountWidget({
      providerSidebar: true,
      sidebarCollapseControl: "provider",
    });
    expect(providerControl.find(".session-toggle").exists()).toBe(false);
    // Provider 接管时新建会话按钮常驻
    expect(providerControl.find(".new-session-btn").exists()).toBe(true);
  });

  it("extension 模式：根容器扩展类、隐藏气泡、显示刷新按钮", () => {
    const w = mountWidget({ displayMode: "extension" });
    expect(w.find(".aipanel-widget").classes()).toContain("extension-mode");
    expect(w.find(".aipanel-button").exists()).toBe(false);
    expect(w.find(".refresh-btn").exists()).toBe(true);
  });

  it("iframe load 触发 frame-loaded 事件", async () => {
    const w = mountWidget();
    await w.find("iframe.aipanel-iframe").trigger("load");
    expect(w.emitted("frame-loaded")).toHaveLength(1);
  });

  it("Provider 侧栏状态回传同步折叠状态并 emit", async () => {
    const w = mountWidget({ providerSidebar: true, sidebarCollapseControl: "host" });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: WIDGET_MSG.SIDEBAR_STATE, collapsed: false },
      }),
    );
    await nextTick();

    expect(w.emitted("update:sessionListCollapsed")).toEqual([[false]]);
    expect(w.emitted("toggle-session-list")).toEqual([[false]]);
  });

  it("暴露的 showNotification 显示提示并在超时后自动消失", async () => {
    const w = mountWidget();
    vi.useFakeTimers();
    exposed(w).showNotification("操作成功");

    await nextTick();
    const notice = w.find(".aipanel-notification");
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toBe("操作成功");

    vi.advanceTimersByTime(NOTIFICATION_DURATION);
    await nextTick();
    expect(w.find(".aipanel-notification").exists()).toBe(false);
    vi.useRealTimers();
  });

  it("暴露的 showConfirmDialog 在点击确认后 resolve(true)", async () => {
    const w = mountWidget();
    const pending = exposed(w).showConfirmDialog("确定继续吗？");
    await nextTick();
    expect(w.find(".aipanel-dialog-message").text()).toBe("确定继续吗？");

    await w.find(".aipanel-dialog-btn.confirm").trigger("click");
    await expect(pending).resolves.toBe(true);
    await flushVue();
    expect(w.find(".aipanel-dialog-overlay").exists()).toBe(false);
  });
});
