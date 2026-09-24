/**
 * @aipanel/ui useSelection（AI-panel-widget 已选节点列表逻辑）单元测试。
 *
 * 覆盖目标：
 *  - bubbleVisible 跟随 selectMode；selectedElementItems 的 key/bubbleFileText/panelFileText/description 规则；
 *  - hasSelectedElements；handleToggleSelectMode 取反回调；
 *  - handleClearSelectedNodes（空列表不弹确认；非空弹确认且仅 confirmed 回调）；
 *  - handleRemoveSelectedNode 透传 { element, index, source }；
 *  - handleClickSelectedNode：description 作为 CSS 选择器命中 → flashHighlight（高亮由挂件复用选择框实现）；
 *    未命中 → notify；目标页不同 → 暂存选择器 + navigate；locateInPage=false（扩展侧栏）不操作页面；
 *  - consumePendingLocate：消费跳转交接（只消费一次）、无交接不动作。
 *
 * 策略：该 composable 无生命周期钩子，直接调用；高亮/跳转/提示均注入 spy，
 * 用真实 DOM 构造选择器命中场景。
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
  const flashHighlight = vi.fn();
  const navigate = vi.fn();
  const notify = vi.fn();
  const api = useSelection({
    selectMode,
    selectedElements,
    onToggleSelectMode,
    onRemoveSelectedNode,
    onClearSelectedNodes,
    showConfirmDialog,
    flashHighlight,
    navigate,
    notify,
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
    flashHighlight,
    navigate,
    notify,
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
  sessionStorage.clear();
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

  it("handleClickSelectedNode：描述命中时闪烁高亮（复用选择模式的高亮框）", () => {
    const s = setup();
    const el = document.createElement("span");
    el.className = "line";
    document.body.appendChild(el);

    s.selectedElements.value = [makeElement({ description: ".line:nth-child(1)" })];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(s.flashHighlight).toHaveBeenCalledWith(el);
    expect(s.navigate).not.toHaveBeenCalled();
  });

  it("handleClickSelectedNode：#id / tag.class / 纯标签描述都按选择器命中", () => {
    const s = setup();
    const byId = document.createElement("div");
    byId.id = "target-node";
    const byClass = document.createElement("span");
    byClass.className = "pick-me";
    const byTag = document.createElement("p");
    document.body.append(byId, byClass, byTag);

    for (const [description, expected] of [
      ["#target-node", byId],
      ["span.pick-me", byClass],
      ["p", byTag],
    ] as const) {
      s.flashHighlight.mockClear();
      s.api.handleLocateSelectedElement(makeElement({ description }));
      expect(s.flashHighlight).toHaveBeenCalledWith(expected);
    }
  });

  it("handleClickSelectedNode：未命中时提示，不闪烁", () => {
    const s = setup();
    const el = document.createElement("div");
    el.id = "existing";
    document.body.appendChild(el);

    s.selectedElements.value = [makeElement({ description: "#missing" })];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(s.flashHighlight).not.toHaveBeenCalled();
    expect(s.notify).toHaveBeenCalledWith(expect.stringContaining("未找到"));
  });

  it("handleClickSelectedNode：空 description 直接返回", () => {
    const s = setup();
    s.selectedElements.value = [makeElement({ description: "" })];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(s.flashHighlight).not.toHaveBeenCalled();
    expect(s.notify).not.toHaveBeenCalled();
  });

  it("handleClickSelectedNode：节点在别的页面时先暂存选择器再跳转", () => {
    const s = setup();
    s.selectedElements.value = [
      makeElement({ description: ".hero-title", previewPageUrl: "http://localhost:5173/#/guide" }),
    ];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(s.navigate).toHaveBeenCalledWith("http://localhost:5173/#/guide");
    expect(s.flashHighlight).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("__aipanel_pending_locate__")).toBe(".hero-title");
  });

  it("handleClickSelectedNode：同页（含同 hash）不跳转，直接闪烁", () => {
    const s = setup();
    const el = document.createElement("span");
    el.className = "hero-title";
    document.body.appendChild(el);

    s.selectedElements.value = [
      makeElement({ description: ".hero-title", previewPageUrl: window.location.href }),
    ];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(s.navigate).not.toHaveBeenCalled();
    expect(s.flashHighlight).toHaveBeenCalledWith(el);
  });

  it("handleClickSelectedNode：仅 hash 不同的路由跳转就地等渲染后闪烁，不暂存交接", async () => {
    // 跳转后元素才出现：模拟 hash 路由渲染
    const navigate = vi.fn(() => {
      const el = document.createElement("div");
      el.id = "route-target";
      document.body.appendChild(el);
    });
    const s = setup({ navigate });
    // 仅 hash 不同（同 origin/path/search）：hash 路由不重建文档
    const hashUrl = `${window.location.origin}${window.location.pathname}#/guide`;
    s.selectedElements.value = [
      makeElement({ description: "#route-target", previewPageUrl: hashUrl }),
    ];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(navigate).toHaveBeenCalledWith(hashUrl);
    expect(sessionStorage.getItem("__aipanel_pending_locate__")).toBeNull();
    await vi.waitFor(() => expect(s.flashHighlight).toHaveBeenCalledTimes(1));
  });

  it("handleClickSelectedNode：locateInPage=false（侧栏）时不操作页面", () => {
    const s = setup({ locateInPage: false });
    const el = document.createElement("p");
    document.body.appendChild(el);

    s.selectedElements.value = [
      makeElement({ description: "p", previewPageUrl: "http://localhost:5173/#/other" }),
    ];
    s.api.handleClickSelectedNode(s.api.selectedElementItems.value[0]);

    expect(s.navigate).not.toHaveBeenCalled();
    expect(s.flashHighlight).not.toHaveBeenCalled();
  });

  it("consumePendingLocate：消费跳转交接并闪烁，交接只消费一次", async () => {
    const s = setup();
    sessionStorage.setItem("__aipanel_pending_locate__", "#landed");
    const el = document.createElement("div");
    el.id = "landed";
    document.body.appendChild(el);

    await s.api.consumePendingLocate();

    expect(s.flashHighlight).toHaveBeenCalledWith(el);
    expect(sessionStorage.getItem("__aipanel_pending_locate__")).toBeNull();

    s.flashHighlight.mockClear();
    await s.api.consumePendingLocate();
    expect(s.flashHighlight).not.toHaveBeenCalled();
  });

  it("consumePendingLocate：无交接时不动作", async () => {
    const s = setup();
    await s.api.consumePendingLocate();
    expect(s.flashHighlight).not.toHaveBeenCalled();
  });
});
