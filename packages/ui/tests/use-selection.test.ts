/**
 * @aipanel/ui useSelection（AI-panel-widget 已选节点列表逻辑）单元测试。
 *
 * 覆盖目标：
 *  - bubbleVisible 跟随 selectMode；selectedElementItems 的 key/bubbleFileText/panelFileText/description 规则；
 *  - hasSelectedElements；handleToggleSelectMode 取反回调；
 *  - handleClearSelectedNodes（空列表不弹确认；非空弹确认且仅 confirmed 回调）；
 *  - handleRemoveSelectedNode 透传 { element, index, source }；
 *  - handleClickSelectedNode 支持 #id / tag.class / 纯标签三种描述，命中后 scrollIntoView + 插入临时遮罩并在 2s 后移除；
 *    未命中 / 空 description 无副作用。
 *
 * 策略：该 composable 无生命周期钩子，直接调用；用真实 DOM 构造描述命中场景，
 * jsdom 未实现 scrollIntoView，故在 beforeEach 打桩；定时器用假定时器推进验证遮罩移除。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { truncate } from "@aipanel/core";
import type { AIPanelSelectedElement } from "@aipanel/core";
import { useSelection } from "../src/AI-panel-widget/composables/use-selection";
import { unmountAll } from "./helpers";

type Options = Parameters<typeof useSelection>[0];

const originalScrollIntoView = Element.prototype.scrollIntoView;

function makeElement(overrides: Partial<AIPanelSelectedElement> = {}): AIPanelSelectedElement {
  return { filePath: null, line: null, column: null, innerText: "", description: "", ...overrides };
}

function setup(overrides: Partial<Options> = {}) {
  const selectMode = ref(false);
  const selectedElements = ref<AIPanelSelectedElement[]>([]);
  const onToggleSelectMode = vi.fn();
  const onRemoveSelectedNode = vi.fn();
  const onClearSelectedNodes = vi.fn();
  const showConfirmDialog = vi.fn(async () => true);
  const api = useSelection({
    selectMode,
    selectedElements,
    onToggleSelectMode,
    onRemoveSelectedNode,
    onClearSelectedNodes,
    showConfirmDialog,
    ...overrides,
  });
  return {
    api,
    selectMode,
    selectedElements,
    onToggleSelectMode,
    onRemoveSelectedNode,
    onClearSelectedNodes,
    showConfirmDialog,
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  vi.useRealTimers();
  await unmountAll();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useSelection", () => {
  it("bubbleVisible 跟随 selectMode", () => {
    const s = setup();
    expect(s.api.bubbleVisible.value).toBe(false);
    s.selectMode.value = true;
    expect(s.api.bubbleVisible.value).toBe(true);
  });

  it("selectedElementItems 映射 key / 文件文案 / description", () => {
    const s = setup();
    const element = makeElement({
      filePath: "/a/b/Foo.tsx",
      line: 10,
      column: 5,
      innerText: "hello",
      description: "button.foo",
    });
    s.selectedElements.value = [element];

    const item = s.api.selectedElementItems.value[0];
    expect(item.key).toBe("/a/b/Foo.tsx:10:5");
    expect(item.description).toBe("button.foo");
    expect(item.bubbleFileText).toBe("Foo.tsx:10:5");
    expect(item.panelFileText).toBe("hello · Foo.tsx:10:5");
    // ref 会把元素包成响应式代理，用深比较确认内容一致
    expect(item.element).toStrictEqual(element);
  });

  it("字段缺省时兜底：description 空为「未知元素」、无 filePath 回退、innerText 截断 30", () => {
    const s = setup();

    s.selectedElements.value = [
      makeElement({ description: "", innerText: "  ", filePath: "/a/B.tsx", line: 3 }),
    ];
    let item = s.api.selectedElementItems.value[0];
    expect(item.description).toBe("未知元素");
    expect(item.key).toBe("/a/B.tsx:3:0");
    expect(item.bubbleFileText).toBe("B.tsx:3");
    expect(item.panelFileText).toBe("B.tsx:3");

    s.selectedElements.value = [makeElement({ description: "div.x" })];
    item = s.api.selectedElementItems.value[0];
    expect(item.key).toBe("div.x-0");
    expect(item.bubbleFileText).toBe("");
    expect(item.panelFileText).toBe("未知文件");

    const longText = "y".repeat(50);
    s.selectedElements.value = [
      makeElement({ innerText: longText, filePath: "/a/L.tsx", line: 1, column: 1 }),
    ];
    item = s.api.selectedElementItems.value[0];
    expect(item.panelFileText).toBe(`${truncate(longText, 30)} · L.tsx:1:1`);
  });

  it("hasSelectedElements 反映列表是否非空", () => {
    const s = setup();
    expect(s.api.hasSelectedElements.value).toBe(false);
    s.selectedElements.value = [makeElement({ description: "a" })];
    expect(s.api.hasSelectedElements.value).toBe(true);
  });

  it("handleToggleSelectMode 取反并回调 onToggleSelectMode", () => {
    const s = setup();
    s.api.handleToggleSelectMode();
    expect(s.onToggleSelectMode).toHaveBeenCalledWith(true);

    s.selectMode.value = true;
    s.api.handleToggleSelectMode();
    expect(s.onToggleSelectMode).toHaveBeenLastCalledWith(false);
  });

  it("handleClearSelectedNodes：空列表不弹确认也不回调", async () => {
    const s = setup();
    await s.api.handleClearSelectedNodes();
    expect(s.showConfirmDialog).not.toHaveBeenCalled();
    expect(s.onClearSelectedNodes).not.toHaveBeenCalled();
  });

  it("handleClearSelectedNodes：非空弹确认，仅 confirmed 才回调", async () => {
    const s = setup();
    s.selectedElements.value = [
      makeElement({ description: "a" }),
      makeElement({ description: "b" }),
    ];

    s.showConfirmDialog.mockResolvedValueOnce(false);
    await s.api.handleClearSelectedNodes();
    expect(s.showConfirmDialog).toHaveBeenCalledWith(expect.stringContaining("2"));
    expect(s.onClearSelectedNodes).not.toHaveBeenCalled();

    s.showConfirmDialog.mockResolvedValueOnce(true);
    await s.api.handleClearSelectedNodes();
    expect(s.onClearSelectedNodes).toHaveBeenCalledTimes(1);
  });

  it("handleRemoveSelectedNode 透传 { element, index, source }", () => {
    const s = setup();
    const element = makeElement({ description: "a" });
    s.selectedElements.value = [element];
    const item = s.api.selectedElementItems.value[0];

    s.api.handleRemoveSelectedNode(item, 3, "bubble");
    expect(s.onRemoveSelectedNode).toHaveBeenCalledWith({
      element,
      index: 3,
      source: "bubble",
    });
  });

  it("handleClickSelectedNode：#id 命中时滚动并插入临时高亮，2 秒后移除", () => {
    vi.useFakeTimers();
    const s = setup();
    const el = document.createElement("div");
    el.id = "target-node";
    document.body.appendChild(el);

    s.selectedElements.value = [makeElement({ description: "#target-node" })];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.querySelector(".aipanel-element-highlight-temp")).not.toBeNull();

    vi.advanceTimersByTime(2000);
    expect(document.querySelector(".aipanel-element-highlight-temp")).toBeNull();
  });

  it("handleClickSelectedNode：tag.class 命中", () => {
    vi.useFakeTimers();
    const s = setup();
    const el = document.createElement("span");
    el.className = "pick-me";
    document.body.appendChild(el);

    s.selectedElements.value = [makeElement({ description: "span.pick-me" })];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".aipanel-element-highlight-temp")).not.toBeNull();
  });

  it("handleClickSelectedNode：纯标签命中", () => {
    vi.useFakeTimers();
    const s = setup();
    const el = document.createElement("p");
    document.body.appendChild(el);

    s.selectedElements.value = [makeElement({ description: "p" })];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".aipanel-element-highlight-temp")).not.toBeNull();
  });

  it("handleClickSelectedNode：未命中无副作用", () => {
    vi.useFakeTimers();
    const s = setup();
    const el = document.createElement("div");
    el.id = "existing";
    document.body.appendChild(el);

    s.selectedElements.value = [makeElement({ description: "#missing" })];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(el.scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector(".aipanel-element-highlight-temp")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handleClickSelectedNode：空 description 直接返回", () => {
    vi.useFakeTimers();
    const s = setup();
    s.selectedElements.value = [makeElement({ description: "" })];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);
    expect(document.querySelector(".aipanel-element-highlight-temp")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
