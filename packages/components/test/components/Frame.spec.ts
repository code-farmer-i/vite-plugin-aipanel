import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import Frame from "../../src/open-code-widget/src/components/Frame.vue";
import * as contextModule from "../../src/open-code-widget/src/context";
import type { OpenCodeWidgetContext } from "../../src/open-code-widget/src/context";

vi.mock("../../src/open-code-widget/src/context", () => ({
  useOpenCodeWidgetContext: vi.fn(),
}));

describe("Frame.vue", () => {
  const defaultContext = {
    frameLoading: ref(false),
    showEmptyState: ref(false),
    showError: ref(false),
    iframeSource: ref("https://example.com"),
    emptyStateText: ref("No Data"),
    emptyStateActionText: ref("Retry"),
    handleEmptyAction: vi.fn(),
    handleFrameLoaded: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      defaultContext as unknown as OpenCodeWidgetContext,
    );
  });

  it("should render iframe with correct source", () => {
    const wrapper = mount(Frame);

    const iframe = wrapper.find(".opencode-iframe");
    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes("src")).toBe("https://example.com");
  });

  it("should show empty state when showEmptyState is true", () => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue({
      ...defaultContext,
      showEmptyState: ref(true),
    } as unknown as OpenCodeWidgetContext);

    const wrapper = mount(Frame);
    const emptyState = wrapper.find(".opencode-empty-state-overlay");

    expect(emptyState.classes()).toContain("visible");
    expect(emptyState.find(".opencode-empty-state-text").text()).toBe("No Data");
    expect(emptyState.find(".opencode-empty-state-btn").text()).toBe("Retry");
  });

  it("should call handleEmptyAction when retry button is clicked", async () => {
    const handleEmptyAction = vi.fn();
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue({
      ...defaultContext,
      showEmptyState: ref(true),
      handleEmptyAction,
    } as unknown as OpenCodeWidgetContext);

    const wrapper = mount(Frame);

    await wrapper.find(".opencode-empty-state-btn").trigger("click");
    expect(handleEmptyAction).toHaveBeenCalledTimes(1);
  });

  it("should show loading overlay when loading is true", () => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue({
      ...defaultContext,
      frameLoading: ref(true),
    } as unknown as OpenCodeWidgetContext);

    const wrapper = mount(Frame);
    const loadingOverlay = wrapper.find(".opencode-loading-overlay");

    expect(loadingOverlay.classes()).toContain("visible");
  });
});
