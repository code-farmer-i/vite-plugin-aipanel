/**
 * @aipanel/ui useWidget（AI-panel-widget 顶层状态/派生/交互）单元测试。
 *
 * 覆盖目标：
 *  - onMounted 读取系统主题并监听 matchMedia change，onUnmounted 移除监听；
 *  - resolvedTheme / containerClasses 随 theme 与系统主题变化（auto 跟随系统）；
 *  - buttonActive、iframeSource、sessionListTitle 等派生值；
 *  - handleToggle（选择模式下退出选择模式，否则切换 open）、handleClose、handleToggleSessionList、
 *    handleEmptyAction、handleToggleTheme（按 WIDGET_THEME_MODES 循环）。
 *
 * 策略：用 helpers.mountComposable 挂载壳组件驱动生命周期；matchMedia 用打桩受控实现，
 * 通过保存的回调手动派发 change 事件模拟系统主题切换。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { WIDGET_THEME_MODES } from "@aipanel/core";
import { useWidget, type UseWidgetOptions } from "../src/AI-panel-widget/composables/use-widget";
import { mountComposable, unmountAll, flushVue } from "./helpers";

interface MockMatchMedia {
  mql: MediaQueryList;
  listeners: Array<(e: MediaQueryListEvent) => void>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

/** 打桩 window.matchMedia，返回受控 matches 与可手动触发的 change 回调集合 */
function mockMatchMedia(matches: boolean): MockMatchMedia {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const removeEventListener = vi.fn();
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.push(cb);
    }),
    removeEventListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  } as unknown as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(mql);
  return { mql, listeners, removeEventListener };
}

function setup(overrides: Partial<UseWidgetOptions> = {}) {
  const theme = ref<string>("auto");
  const open = ref(false);
  const selectMode = ref(false);
  const iframeSrc = ref<string>("");
  const sessionListCollapsed = ref(true);
  const onToggle = vi.fn();
  const onToggleSelectMode = vi.fn();
  const onClose = vi.fn();
  const onToggleSessionList = vi.fn();
  const onEmptyAction = vi.fn();
  const onToggleTheme = vi.fn();

  const { ctx } = mountComposable(() =>
    useWidget({
      theme,
      open,
      selectMode,
      iframeSrc,
      sessionListCollapsed,
      onToggle,
      onToggleSelectMode,
      onClose,
      onToggleSessionList,
      onEmptyAction,
      onToggleTheme,
      ...overrides,
    }),
  );

  return {
    api: ctx,
    theme,
    open,
    selectMode,
    iframeSrc,
    sessionListCollapsed,
    onToggle,
    onToggleSelectMode,
    onClose,
    onToggleSessionList,
    onEmptyAction,
    onToggleTheme,
  };
}

afterEach(async () => {
  await unmountAll();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useWidget", () => {
  it("containerClasses 组合固定类与解析后主题（auto 跟随系统 light）", () => {
    mockMatchMedia(false);
    const s = setup();
    expect(s.api.containerClasses.value).toEqual(["aipanel-widget", "aipanel-theme-light"]);
    expect(s.api.resolvedTheme.value).toBe("light");
  });

  it("theme 为 dark/light 时直接生效，不依赖系统主题", () => {
    mockMatchMedia(false);
    const s = setup({ theme: ref<string>("dark") });
    expect(s.api.resolvedTheme.value).toBe("dark");
    expect(s.api.containerClasses.value).toContain("aipanel-theme-dark");
  });

  it("auto 跟随系统：系统为 dark 时解析为 dark，change 事件实时更新", async () => {
    const { listeners } = mockMatchMedia(true);
    const s = setup();
    expect(s.api.resolvedTheme.value).toBe("dark");

    listeners.forEach((cb) => cb({ matches: false } as MediaQueryListEvent));
    await flushVue();
    expect(s.api.resolvedTheme.value).toBe("light");
    expect(s.api.containerClasses.value).toContain("aipanel-theme-light");
  });

  it("buttonActive 在 open 或 selectMode 任一为真时为真", () => {
    mockMatchMedia(false);
    const s = setup();
    expect(s.api.buttonActive.value).toBe(false);
    s.open.value = true;
    expect(s.api.buttonActive.value).toBe(true);
    s.open.value = false;
    s.selectMode.value = true;
    expect(s.api.buttonActive.value).toBe(true);
  });

  it("iframeSource 缺省回退 about:blank，有值时透传", () => {
    mockMatchMedia(false);
    const s = setup();
    expect(s.api.iframeSource.value).toBe("about:blank");
    s.iframeSrc.value = "https://example.com/chat";
    expect(s.api.iframeSource.value).toBe("https://example.com/chat");
  });

  it("sessionListTitle 随折叠状态变化", () => {
    mockMatchMedia(false);
    const s = setup();
    expect(s.api.sessionListTitle.value).toBe("展开会话列表");
    s.sessionListCollapsed.value = false;
    expect(s.api.sessionListTitle.value).toBe("折叠会话列表");
  });

  it("handleToggle 未进入选择模式时取反 open 并回调 onToggle", () => {
    mockMatchMedia(false);
    const s = setup();
    s.api.handleToggle();
    expect(s.onToggle).toHaveBeenCalledWith(true);

    s.open.value = true;
    s.api.handleToggle();
    expect(s.onToggle).toHaveBeenLastCalledWith(false);
  });

  it("handleToggle 在选择模式下仅退出选择模式，不切换 open", () => {
    mockMatchMedia(false);
    const s = setup();
    s.selectMode.value = true;
    s.api.handleToggle();
    expect(s.onToggleSelectMode).toHaveBeenCalledWith(false);
    expect(s.onToggle).not.toHaveBeenCalled();
  });

  it("handleToggleSessionList 取反 collapsed 回调，handleClose / handleEmptyAction 直接透传", () => {
    mockMatchMedia(false);
    const s = setup();
    s.api.handleToggleSessionList();
    expect(s.onToggleSessionList).toHaveBeenCalledWith(false);

    s.sessionListCollapsed.value = false;
    s.api.handleToggleSessionList();
    expect(s.onToggleSessionList).toHaveBeenLastCalledWith(true);

    s.api.handleClose();
    expect(s.onClose).toHaveBeenCalledTimes(1);

    s.api.handleEmptyAction();
    expect(s.onEmptyAction).toHaveBeenCalledTimes(1);
  });

  it("handleToggleTheme 按 WIDGET_THEME_MODES 顺序循环", () => {
    mockMatchMedia(false);
    const s = setup();
    // auto -> light -> dark -> auto
    s.api.handleToggleTheme();
    expect(s.onToggleTheme).toHaveBeenLastCalledWith(WIDGET_THEME_MODES[1]);

    s.theme.value = WIDGET_THEME_MODES[1];
    s.api.handleToggleTheme();
    expect(s.onToggleTheme).toHaveBeenLastCalledWith(WIDGET_THEME_MODES[2]);

    s.theme.value = WIDGET_THEME_MODES[2];
    s.api.handleToggleTheme();
    expect(s.onToggleTheme).toHaveBeenLastCalledWith(WIDGET_THEME_MODES[0]);
  });

  it("onUnmounted 移除 matchMedia change 监听", async () => {
    const { mql, removeEventListener } = mockMatchMedia(false);
    setup();
    const handler = (mql.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];

    await unmountAll();
    expect(removeEventListener).toHaveBeenCalledWith("change", handler);
  });
});
