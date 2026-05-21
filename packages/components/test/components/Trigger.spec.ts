import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import Trigger from "../../src/open-code-widget/src/components/Trigger.vue";
import * as contextModule from "../../src/open-code-widget/src/context";
import type { OpenCodeWidgetContext } from "../../src/open-code-widget/src/context";

vi.mock("../../src/open-code-widget/src/context", () => ({
  useOpenCodeWidgetContext: vi.fn(),
}));

describe("Trigger.vue", () => {
  let wrapper: ReturnType<typeof mount>;

  const createContext = (overrides: Partial<OpenCodeWidgetContext> = {}) => ({
    buttonActive: ref(false),
    open: ref(false),
    hotkeyLabel: ref("Ctrl+K"),
    thinking: ref(false),
    resolvedTheme: ref("light" as const),
    bubbleOffset: ref(undefined),
    handleToggle: vi.fn(),
    handleBubbleOffsetChange: vi.fn(),
    ...overrides,
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should render correctly with default context", () => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      createContext() as unknown as OpenCodeWidgetContext,
    );

    wrapper = mount(Trigger);

    const button = document.querySelector(".opencode-button");
    expect(button).toBeTruthy();
    expect(button!.classList.contains("active")).toBe(false);
  });

  it("should have active class when buttonActive is true", () => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      createContext({ buttonActive: ref(true) }) as unknown as OpenCodeWidgetContext,
    );

    wrapper = mount(Trigger);
    const button = document.querySelector(".opencode-button");
    expect(button).toBeTruthy();
    expect(button!.classList.contains("active")).toBe(true);
  });

  it("should call handleToggle when clicked", () => {
    const handleToggle = vi.fn();
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      createContext({ handleToggle }) as unknown as OpenCodeWidgetContext,
    );

    wrapper = mount(Trigger);
    const button = document.querySelector(".opencode-button") as HTMLElement;
    expect(button).toBeTruthy();

    button.click();
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });
});
