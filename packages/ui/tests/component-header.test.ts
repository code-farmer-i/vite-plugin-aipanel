/**
 * 覆盖目标：Header.vue（面板头部工具栏）
 * - 标题渲染；各按钮按 context 条件的可见性（侧栏开关/选择/主题/展示模式/审查/刷新/新建/分栏位置/对话框/最小化/关闭）
 * - 交互态（active/aria-pressed/aria-expanded/disabled）与 title/aria-label 文案随状态变化
 * - 点击各按钮回调对应 context action
 * - providerSidebar + sidebarCollapseControl 组合下侧栏开关可见性
 * - 具名插槽覆盖默认图标
 *
 * 策略：mountWithContext 真实 provide/inject；不同场景用 overrides 构造 context。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import Header from "../src/AI-panel-widget/src/components/Header.vue";
import { createWidgetContext, mountWithContext } from "./component-widget-context";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mountHeader(contextOverrides = {}) {
  wrapper?.unmount();
  const { wrapper: w } = mountWithContext(Header, {
    context: createWidgetContext(contextOverrides),
  });
  wrapper = w;
  return w;
}

describe("Header", () => {
  it("渲染标题，并默认展示侧栏开关/选择/主题/展示模式/对话框/最小化/关闭", () => {
    const w = mountHeader();
    expect(w.find(".aipanel-chat-header-title").text()).toBe("AI 助手");
    expect(w.find(".session-toggle").exists()).toBe(true);
    expect(w.find(".select-btn").exists()).toBe(true);
    expect(w.find(".theme-btn").exists()).toBe(true);
    expect(w.find(".display-mode-btn").exists()).toBe(true);
    expect(w.find(".prompt-dock").exists()).toBe(true);
    expect(w.find(".minimize").exists()).toBe(true);
    expect(w.find(".close").exists()).toBe(true);
    // 默认不支持的按钮
    expect(w.find(".review-panel").exists()).toBe(false);
    expect(w.find(".refresh-btn").exists()).toBe(false);
    expect(w.find(".new-session-btn").exists()).toBe(false);
    expect(w.find(".split-position-btn").exists()).toBe(false);
  });

  it("侧栏开关：文案与交互态跟随折叠状态，点击回调 handleToggleSessionList", async () => {
    const handleToggleSessionList = vi.fn();
    const w = mountHeader({
      sessionListCollapsed: ref(false),
      sessionListTitle: ref("折叠会话列表"),
      handleToggleSessionList,
    });

    const toggle = w.find(".session-toggle");
    expect(toggle.classes()).toContain("active");
    expect(toggle.attributes("title")).toBe("折叠会话列表");
    expect(toggle.attributes("aria-expanded")).toBe("true");

    await toggle.trigger("click");
    expect(handleToggleSessionList).toHaveBeenCalledTimes(1);
  });

  it("选择按钮：selectEnabled 为假时 disabled", () => {
    const w = mountHeader({ selectEnabled: ref(false), selectMode: ref(false) });
    const btn = w.find(".select-btn");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.classes()).not.toContain("active");
  });

  it("选择按钮：selectMode 为真时 active，点击回调 handleToggleSelectMode", async () => {
    const handleToggleSelectMode = vi.fn();
    const w = mountHeader({
      selectEnabled: ref(true),
      selectMode: ref(true),
      handleToggleSelectMode,
    });

    const btn = w.find(".select-btn");
    expect(btn.attributes("disabled")).toBeUndefined();
    expect(btn.classes()).toContain("active");
    expect(btn.attributes("aria-pressed")).toBe("true");

    await btn.trigger("click");
    expect(handleToggleSelectMode).toHaveBeenCalledTimes(1);
  });

  it("主题按钮：title/aria-label 反映当前主题与解析主题，点击回调 handleToggleTheme", async () => {
    const handleToggleTheme = vi.fn();
    const w = mountHeader({
      theme: ref("auto"),
      resolvedTheme: ref("dark"),
      handleToggleTheme,
    });

    const btn = w.find(".theme-btn");
    expect(btn.attributes("title")).toBe("主题: 自动 (dark)");
    expect(btn.attributes("aria-label")).toBe("切换主题 - 当前: 自动跟随系统");

    await btn.trigger("click");
    expect(handleToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("展示模式按钮：extension 下隐藏，其余展示下一个模式提示", () => {
    const ext = mountHeader({ displayMode: ref("extension") });
    expect(ext.find(".display-mode-btn").exists()).toBe(false);

    const bubble = mountHeader({ displayMode: ref("bubble") });
    expect(bubble.find(".display-mode-btn").attributes("title")).toBe("展示模式: 气泡模式");
    expect(bubble.find(".display-mode-btn").attributes("aria-label")).toBe(
      "切换展示模式 - 下一个: 分屏模式",
    );
  });

  it("审查面板按钮：仅 enabled 时出现，active 反映 visible，点击回调", async () => {
    const handleToggleReviewPanel = vi.fn();
    const w = mountHeader({
      reviewPanelEnabled: ref(true),
      reviewPanelVisible: ref(true),
      handleToggleReviewPanel,
    });

    const btn = w.find(".review-panel");
    expect(btn.classes()).toContain("active");
    expect(btn.attributes("title")).toBe("收起审查面板");

    await btn.trigger("click");
    expect(handleToggleReviewPanel).toHaveBeenCalledTimes(1);
  });

  it("extension 模式：显示刷新与新建会话按钮，隐藏展示模式/分栏位置/对话框/最小化/关闭", async () => {
    const handleRefresh = vi.fn();
    const handleCreateSession = vi.fn();
    const w = mountHeader({
      mode: ref("split"),
      displayMode: ref("extension"),
      handleRefresh,
      handleCreateSession,
    });

    expect(w.find(".split-position-btn").exists()).toBe(false);
    expect(w.find(".prompt-dock").exists()).toBe(false);
    expect(w.find(".minimize").exists()).toBe(false);
    expect(w.find(".close").exists()).toBe(false);

    await w.find(".refresh-btn").trigger("click");
    expect(handleRefresh).toHaveBeenCalledTimes(1);

    await w.find(".new-session-btn").trigger("click");
    expect(handleCreateSession).toHaveBeenCalledTimes(1);
  });

  it("分屏模式：显示分栏位置按钮并可切换，隐藏对话框/最小化/关闭", async () => {
    const handleToggleSplitPosition = vi.fn();
    const w = mountHeader({
      mode: ref("split"),
      displayMode: ref("split"),
      splitPosition: ref("right"),
      handleToggleSplitPosition,
    });

    const btn = w.find(".split-position-btn");
    expect(btn.attributes("title")).toBe("分栏位置: 右侧");
    expect(btn.attributes("aria-label")).toBe("切换分栏位置 - 下一个: 左侧");
    expect(w.find(".prompt-dock").exists()).toBe(false);

    await btn.trigger("click");
    expect(handleToggleSplitPosition).toHaveBeenCalledTimes(1);
  });

  it("侧栏开关可见性：providerSidebar 且折叠开关归 Provider 时隐藏", () => {
    expect(
      mountHeader({ providerSidebar: ref(true), sidebarCollapseControl: ref("host") })
        .find(".session-toggle")
        .exists(),
    ).toBe(true);
    expect(
      mountHeader({ providerSidebar: ref(true), sidebarCollapseControl: ref("provider") })
        .find(".session-toggle")
        .exists(),
    ).toBe(false);
  });

  it("Provider 接管时新建会话按钮常驻", () => {
    const w = mountHeader({ providerSidebar: ref(true) });
    expect(w.find(".new-session-btn").exists()).toBe(true);
  });

  it("对话框/最小化/关闭点击回调，且最小化文案随状态变化", async () => {
    const handleTogglePromptDock = vi.fn();
    const handleToggleMinimize = vi.fn();
    const handleClose = vi.fn();
    const w = mountHeader({
      promptDockVisible: ref(false),
      minimized: ref(true),
      handleTogglePromptDock,
      handleToggleMinimize,
      handleClose,
    });

    expect(w.find(".prompt-dock").attributes("title")).toBe("显示对话框");
    expect(w.find(".minimize").attributes("title")).toBe("展开");
    expect(w.find(".minimize").attributes("aria-pressed")).toBe("true");

    await w.find(".prompt-dock").trigger("click");
    await w.find(".minimize").trigger("click");
    await w.find(".close").trigger("click");
    expect(handleTogglePromptDock).toHaveBeenCalledTimes(1);
    expect(handleToggleMinimize).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("具名插槽覆盖默认图标", () => {
    const w = mountHeader();
    // 关闭按钮默认含 svg
    expect(w.find(".close svg").exists()).toBe(true);

    const { wrapper: withSlot } = mountWithContext(Header, {
      context: createWidgetContext(),
      slots: { "close-icon": () => h("i", { class: "custom-close-icon" }, "X") },
    });
    wrapper = withSlot;
    expect(withSlot.find(".close .custom-close-icon").text()).toBe("X");
    expect(withSlot.find(".close svg").exists()).toBe(false);
  });
});
