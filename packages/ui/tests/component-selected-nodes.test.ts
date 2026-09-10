/**
 * 覆盖目标：SelectedNodes.vue（右侧已选节点工具带）
 * - 列表为空时加 collapsed class，且不渲染条目/清空按钮
 * - 非空时渲染 description（node-text）与 panelFileText（node-file）
 * - 点击条目回调 handleClickSelectedNode(item)
 * - 点击移除按钮（阻止冒泡）回调 handleRemoveSelectedNode({ item, index, source: 'panel' })
 * - showClearAll 且列表非空时渲染「一键清空」，点击回调 handleClearSelectedNodes
 *
 * 策略：mountWithContext 真实 provide/inject；context action 用 vi.fn 记录载荷。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import type { AIPanelSelectedElementItem } from "@aipanel/core";
import SelectedNodes from "../src/AI-panel-widget/src/components/SelectedNodes.vue";
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

describe("SelectedNodes", () => {
  it("空列表：collapsed class，无条目与清空按钮", () => {
    const { wrapper: w } = mountWithContext(SelectedNodes, {
      context: createWidgetContext({ selectedElementItems: ref([]) }),
    });
    wrapper = w;

    expect(w.find(".aipanel-right-toolbar").classes()).toContain("collapsed");
    expect(w.find(".aipanel-selected-node").exists()).toBe(false);
    expect(w.find(".aipanel-clear-all-btn").exists()).toBe(false);
    expect(w.find(".aipanel-selected-nodes-title").text()).toBe("已选节点");
  });

  it("非空列表：渲染 description / panelFileText 与清空按钮", () => {
    const items = [
      makeItem({ key: "a", description: "div.x", panelFileText: "div.x · A.tsx:2" }),
      makeItem({ key: "b", description: "span.y", panelFileText: "span.y · B.tsx:3" }),
    ];
    const { wrapper: w } = mountWithContext(SelectedNodes, {
      context: createWidgetContext({
        selectedElementItems: ref(items),
        showClearAll: ref(true),
      }),
    });
    wrapper = w;

    expect(w.find(".aipanel-right-toolbar").classes()).not.toContain("collapsed");
    const nodes = w.findAll(".aipanel-selected-node");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].find(".aipanel-node-text").text()).toBe("div.x");
    expect(nodes[0].find(".aipanel-node-file").text()).toBe("div.x · A.tsx:2");
    expect(w.find(".aipanel-clear-all-btn").text()).toBe("一键清空");
  });

  it("showClearAll 为假时即使有选中也不显示清空按钮", () => {
    const { wrapper: w } = mountWithContext(SelectedNodes, {
      context: createWidgetContext({
        selectedElementItems: ref([makeItem()]),
        showClearAll: ref(false),
      }),
    });
    wrapper = w;
    expect(w.find(".aipanel-clear-all-btn").exists()).toBe(false);
  });

  it("点击条目回调 handleClickSelectedNode", async () => {
    const handleClickSelectedNode = vi.fn();
    const handleRemoveSelectedNode = vi.fn();
    const { wrapper: w } = mountWithContext(SelectedNodes, {
      context: createWidgetContext({
        selectedElementItems: ref([makeItem({ description: "div.x" })]),
        handleClickSelectedNode,
        handleRemoveSelectedNode,
      }),
    });
    wrapper = w;

    await w.find(".aipanel-selected-node").trigger("click");
    expect(handleClickSelectedNode).toHaveBeenCalledTimes(1);
    expect(handleClickSelectedNode.mock.calls[0][0]).toMatchObject({ description: "div.x" });
    expect(handleRemoveSelectedNode).not.toHaveBeenCalled();
  });

  it("点击移除按钮回调 handleRemoveSelectedNode({ index, source: 'panel' }) 且不触发条目点击", async () => {
    const handleClickSelectedNode = vi.fn();
    const handleRemoveSelectedNode = vi.fn();
    const { wrapper: w } = mountWithContext(SelectedNodes, {
      context: createWidgetContext({
        selectedElementItems: ref([makeItem({ key: "a" }), makeItem({ key: "b" })]),
        handleClickSelectedNode,
        handleRemoveSelectedNode,
      }),
    });
    wrapper = w;

    await w.findAll(".aipanel-node-remove")[1].trigger("click");
    expect(handleRemoveSelectedNode).toHaveBeenCalledTimes(1);
    expect(handleRemoveSelectedNode.mock.calls[0][0]).toMatchObject({ index: 1, source: "panel" });
    expect(handleClickSelectedNode).not.toHaveBeenCalled();
  });

  it("点击一键清空回调 handleClearSelectedNodes", async () => {
    const handleClearSelectedNodes = vi.fn();
    const { wrapper: w } = mountWithContext(SelectedNodes, {
      context: createWidgetContext({
        selectedElementItems: ref([makeItem()]),
        handleClearSelectedNodes,
      }),
    });
    wrapper = w;

    await w.find(".aipanel-clear-all-btn").trigger("click");
    expect(handleClearSelectedNodes).toHaveBeenCalledTimes(1);
  });
});
