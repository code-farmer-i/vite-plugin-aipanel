/**
 * 覆盖目标：SelectedBubbles.vue（选择模式下的已选元素气泡列表）
 * - bubbleVisible 驱动 .visible class
 * - 空列表渲染「暂无选中元素」，非空渲染每条 description 与（有值时）bubbleFileText
 * - 点击条目回调 handleClickSelectedNode(item)
 * - 点击移除按钮（阻止冒泡）回调 handleRemoveSelectedNode({ item, index, source: 'bubble' })
 *
 * 策略：mountWithContext 真实 provide/inject；用 vi.fn 记录 context action 载荷。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import type { AIPanelSelectedElementItem } from "@aipanel/core";
import SelectedBubbles from "../src/AI-panel-widget/src/components/SelectedBubbles.vue";
import { createWidgetContext, mountWithContext } from "./component-widget-context";

function makeItem(overrides: Partial<AIPanelSelectedElementItem> = {}): AIPanelSelectedElementItem {
  return {
    key: "k",
    description: "button.foo",
    bubbleFileText: "Foo.tsx:1",
    panelFileText: "button.foo · Foo.tsx:1",
    element: {
      filePath: "/a/Foo.tsx",
      line: 1,
      column: null,
      innerText: "",
      description: "button.foo",
    },
    ...overrides,
  };
}

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SelectedBubbles", () => {
  it("bubbleVisible 驱动 visible class，空列表显示占位文案", () => {
    const { wrapper: w } = mountWithContext(SelectedBubbles, {
      context: createWidgetContext({ bubbleVisible: ref(true), selectedElementItems: ref([]) }),
    });
    wrapper = w;

    expect(w.find(".aipanel-selected-bubbles").classes()).toContain("visible");
    expect(w.find(".aipanel-bubble-empty").text()).toBe("暂无选中元素");
    expect(w.find(".aipanel-selected-bubble").exists()).toBe(false);
  });

  it("非空列表渲染 description 与 bubbleFileText（为空时不渲染文件行）", () => {
    const items = [
      makeItem({ key: "a", description: "div.x", bubbleFileText: "A.tsx:2:3" }),
      makeItem({ key: "b", description: "span.y", bubbleFileText: "" }),
    ];
    const { wrapper: w } = mountWithContext(SelectedBubbles, {
      context: createWidgetContext({
        bubbleVisible: ref(false),
        selectedElementItems: ref(items),
      }),
    });
    wrapper = w;

    expect(w.find(".aipanel-selected-bubbles").classes()).not.toContain("visible");
    const bubbles = w.findAll(".aipanel-selected-bubble");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].find(".aipanel-bubble-text").text()).toBe("div.x");
    expect(bubbles[0].find(".aipanel-bubble-file").text()).toBe("A.tsx:2:3");
    // bubbleFileText 为空时不出文件行
    expect(bubbles[1].find(".aipanel-bubble-file").exists()).toBe(false);
  });

  it("点击条目回调 handleClickSelectedNode，且不移除", async () => {
    const items = [makeItem({ key: "a", description: "div.x" })];
    const handleClickSelectedNode = vi.fn();
    const handleRemoveSelectedNode = vi.fn();
    const { wrapper: w } = mountWithContext(SelectedBubbles, {
      context: createWidgetContext({
        bubbleVisible: ref(true),
        selectedElementItems: ref(items),
        handleClickSelectedNode,
        handleRemoveSelectedNode,
      }),
    });
    wrapper = w;

    await w.find(".aipanel-selected-bubble").trigger("click");
    expect(handleClickSelectedNode).toHaveBeenCalledTimes(1);
    expect(handleClickSelectedNode.mock.calls[0][0]).toMatchObject({ description: "div.x" });
    expect(handleRemoveSelectedNode).not.toHaveBeenCalled();
  });

  it("点击移除按钮回调 handleRemoveSelectedNode 且不触发条目点击", async () => {
    const items = [makeItem({ key: "a", description: "div.x" }), makeItem({ key: "b" })];
    const handleClickSelectedNode = vi.fn();
    const handleRemoveSelectedNode = vi.fn();
    const { wrapper: w } = mountWithContext(SelectedBubbles, {
      context: createWidgetContext({
        bubbleVisible: ref(true),
        selectedElementItems: ref(items),
        handleClickSelectedNode,
        handleRemoveSelectedNode,
      }),
    });
    wrapper = w;

    await w.findAll(".aipanel-bubble-remove")[1].trigger("click");
    expect(handleRemoveSelectedNode).toHaveBeenCalledTimes(1);
    expect(handleRemoveSelectedNode.mock.calls[0][0]).toMatchObject({ index: 1, source: "bubble" });
    expect(handleClickSelectedNode).not.toHaveBeenCalled();
  });
});
