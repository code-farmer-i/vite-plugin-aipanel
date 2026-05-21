import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import Header from "../../src/open-code-widget/src/components/Header.vue";
import * as contextModule from "../../src/open-code-widget/src/context";
import type { OpenCodeWidgetContext } from "../../src/open-code-widget/src/context";

vi.mock("../../src/open-code-widget/src/context", () => ({
  useOpenCodeWidgetContext: vi.fn(),
}));

describe("Header.vue", () => {
  const createContext = (overrides: Partial<OpenCodeWidgetContext> = {}) => ({
    title: ref("Trae AI 助手"),
    sessionListTitle: ref("展开会话列表"),
    sessionListCollapsed: ref(true),
    selectMode: ref(false),
    selectEnabled: ref(true),
    theme: ref("auto" as const),
    resolvedTheme: ref("light" as const),
    minimized: ref(false),
    promptDockVisible: ref(false),
    mode: ref("bubble" as const),
    displayMode: ref("bubble" as const),
    splitPosition: ref("right" as const),
    handleToggleSessionList: vi.fn(),
    handleToggleSelectMode: vi.fn(),
    handleToggleTheme: vi.fn(),
    handleToggleDisplayMode: vi.fn(),
    handleToggleSplitPosition: vi.fn(),
    handleClose: vi.fn(),
    handleToggleMinimize: vi.fn(),
    handleTogglePromptDock: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      createContext() as unknown as OpenCodeWidgetContext,
    );
  });

  it("should render correctly", () => {
    const wrapper = mount(Header);

    expect(wrapper.find(".opencode-chat-header-title").text()).toBe("Trae AI 助手");

    const sessionToggle = wrapper.find(".session-toggle");
    expect(sessionToggle.attributes("title")).toBe("展开会话列表");
    expect(sessionToggle.attributes("aria-expanded")).toBe("false");

    const selectBtn = wrapper.find(".select-btn");
    expect(selectBtn.classes()).not.toContain("active");
    expect(selectBtn.attributes("aria-pressed")).toBe("false");
    // :disabled binding translates to HTML disabled attribute. If true it's disabled, if false it's undefined.
    expect(selectBtn.attributes("disabled")).toBeUndefined();
  });

  it("should reflect sessionListCollapsed state", () => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      createContext({
        sessionListCollapsed: ref(false),
        sessionListTitle: ref("收起会话列表"),
      }) as unknown as OpenCodeWidgetContext,
    );

    const wrapper = mount(Header);
    const sessionToggle = wrapper.find(".session-toggle");
    expect(sessionToggle.attributes("aria-expanded")).toBe("true");
    expect(sessionToggle.attributes("title")).toBe("收起会话列表");
  });

  it("should reflect selectMode and selectEnabled states", () => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      createContext({
        selectMode: ref(true),
        selectEnabled: ref(false),
      }) as unknown as OpenCodeWidgetContext,
    );

    const wrapper = mount(Header);
    const selectBtn = wrapper.find(".select-btn");

    expect(selectBtn.classes()).toContain("active");
    expect(selectBtn.attributes("aria-pressed")).toBe("true");
    expect(selectBtn.attributes("disabled")).toBeDefined();
  });

  it("should call handlers when buttons are clicked", async () => {
    const handleToggleSessionList = vi.fn();
    const handleToggleSelectMode = vi.fn();
    const handleClose = vi.fn();

    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      createContext({
        handleToggleSessionList,
        handleToggleSelectMode,
        handleClose,
      }) as unknown as OpenCodeWidgetContext,
    );

    const wrapper = mount(Header);

    await wrapper.find(".session-toggle").trigger("click");
    expect(handleToggleSessionList).toHaveBeenCalledTimes(1);

    await wrapper.find(".select-btn").trigger("click");
    expect(handleToggleSelectMode).toHaveBeenCalledTimes(1);

    await wrapper.find(".close").trigger("click");
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
