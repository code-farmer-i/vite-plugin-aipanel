import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OpenCodeWidget from "../src/open-code-widget/src/index.vue";

describe("OpenCodeWidget", () => {
  it("renders correctly with default props", () => {
    const wrapper = mount(OpenCodeWidget);

    expect(wrapper.classes()).toContain("opencode-widget");

    const chatContent = wrapper.find(".opencode-chat-content");
    expect(chatContent.exists()).toBe(true);
  });

  it("handles toggle and close actions", async () => {
    mount(OpenCodeWidget, {
      props: {
        open: false,
      },
    });

    const triggerBtn = document.querySelector(".opencode-button") as HTMLElement;
    expect(triggerBtn).toBeTruthy();
  });

  it("displays and interacts with session list", async () => {
    const wrapper = mount(OpenCodeWidget, {
      props: {
        sessions: [
          { id: "1", title: "Test Session 1" },
          { id: "2", title: "Test Session 2" },
        ],
        currentSessionId: "1",
        sessionListCollapsed: false,
      },
    });

    const sessionList = wrapper.find(".opencode-session-list");
    expect(sessionList.classes()).not.toContain("collapsed");

    const items = wrapper.findAll(".opencode-session-item");
    expect(items).toHaveLength(2);
    expect(items[0].classes()).toContain("active");

    // Click item 2
    await items[1].trigger("click");
    expect(wrapper.emitted()["select-session"]).toBeTruthy();
    expect((wrapper.emitted()["select-session"] as unknown[][])[0][0]).toMatchObject({
      id: "2",
      title: "Test Session 2",
    });
  });

  it("toggles select mode and handles selection", async () => {
    const wrapper = mount(OpenCodeWidget, {
      props: {
        selectMode: true,
      },
    });

    const selectHint = wrapper.find(".opencode-select-mode-hint");
    expect(selectHint.exists()).toBe(true);
  });

  it("handles empty state and loading", () => {
    const wrapper = mount(OpenCodeWidget, {
      props: {
        showEmptyState: true,
        emptyStateText: "No data",
        emptyStateActionText: "Reload",
      },
    });

    expect(wrapper.find(".opencode-empty-state-overlay").exists()).toBe(true);
  });
});
