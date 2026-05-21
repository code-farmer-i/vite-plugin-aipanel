import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import SessionList from "../../src/open-code-widget/src/components/SessionList.vue";
import * as contextModule from "../../src/open-code-widget/src/context";
import type { OpenCodeWidgetContext } from "../../src/open-code-widget/src/context";
import type { OpenCodeWidgetSessionItem } from "../../src/open-code-widget/src/types";

vi.mock("../../src/open-code-widget/src/context", () => ({
  useOpenCodeWidgetContext: vi.fn(),
}));

describe("SessionList.vue", () => {
  const mockSessions: OpenCodeWidgetSessionItem[] = [
    {
      id: "1",
      key: "1",
      title: "Session 1",
      meta: "2 mins ago",
      active: true,
      session: { id: "session-1", title: "Session 1" },
    },
    {
      id: "2",
      key: "2",
      title: "Session 2",
      meta: "1 hr ago",
      active: false,
      session: { id: "session-2", title: "Session 2" },
    },
  ];

  const defaultContext = {
    sessionListCollapsed: ref(false),
    sessionItems: ref(mockSessions),
    showSessionListSkeleton: ref(false),
    loadingSessionList: ref(false),
    handleCreateSession: vi.fn(),
    handleSelectSession: vi.fn(),
    handleDeleteSession: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue(
      defaultContext as unknown as OpenCodeWidgetContext,
    );
  });

  it("should render correctly with sessions", () => {
    const wrapper = mount(SessionList);

    expect(wrapper.classes()).not.toContain("collapsed");

    const items = wrapper.findAll(".opencode-session-item");
    expect(items).toHaveLength(2);

    expect(items[0].classes()).toContain("active");
    expect(items[0].find(".opencode-session-title").text()).toBe("Session 1");
    expect(items[0].find(".opencode-session-meta").text()).toBe("2 mins ago");

    expect(items[1].classes()).not.toContain("active");
    expect(items[1].find(".opencode-session-title").text()).toBe("Session 2");
  });

  it("should have collapsed class when sessionListCollapsed is true", () => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue({
      ...defaultContext,
      sessionListCollapsed: ref(true),
    } as unknown as OpenCodeWidgetContext);

    const wrapper = mount(SessionList);
    expect(wrapper.classes()).toContain("collapsed");
  });

  it("should not display session items when sessionItems is empty", () => {
    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue({
      ...defaultContext,
      sessionItems: ref([]),
    } as unknown as OpenCodeWidgetContext);

    const wrapper = mount(SessionList);
    expect(wrapper.findAll(".opencode-session-item")).toHaveLength(0);
  });

  it("should call handlers when buttons are clicked", async () => {
    const handleCreateSession = vi.fn();
    const handleSelectSession = vi.fn();
    const handleDeleteSession = vi.fn();

    vi.mocked(contextModule.useOpenCodeWidgetContext).mockReturnValue({
      ...defaultContext,
      handleCreateSession,
      handleSelectSession,
      handleDeleteSession,
    } as unknown as OpenCodeWidgetContext);

    const wrapper = mount(SessionList);

    // Create Session
    await wrapper.find(".opencode-new-session-btn").trigger("click");
    expect(handleCreateSession).toHaveBeenCalledTimes(1);

    // Select Session
    const items = wrapper.findAll(".opencode-session-item");
    await items[1].trigger("click");
    expect(handleSelectSession).toHaveBeenCalledWith(mockSessions[1]);

    // Delete Session
    const deleteBtn = items[1].find(".opencode-session-delete-btn");
    await deleteBtn.trigger("click");
    expect(handleDeleteSession).toHaveBeenCalledWith(mockSessions[1]);
  });
});
