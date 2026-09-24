import { computed, type Ref } from "vue";
import { fileNameOf, sleep, truncate } from "@aipanel/core";
import type {
  AIPanelRemoveSelectedPayload,
  AIPanelSelectedElement,
  AIPanelSelectedElementItem,
} from "../src/types";

function getElementKey(element: AIPanelSelectedElement, index: number): string {
  if (element.filePath && element.line) {
    return `${element.filePath}:${element.line}:${element.column ?? 0}`;
  }

  return `${element.description}-${index}`;
}

/** 读并清除跨页面定位交接（跳转前暂存的目标选择器）；无交接返回 null */
function takePendingLocate(): string | null {
  try {
    const selector = sessionStorage.getItem("__aipanel_pending_locate__");
    sessionStorage.removeItem("__aipanel_pending_locate__");
    return selector || null;
  } catch {
    return null;
  }
}

/** 暂存跨页面定位交接（写失败不影响跳转本身） */
function stashPendingLocate(selector: string): void {
  try {
    sessionStorage.setItem("__aipanel_pending_locate__", selector);
  } catch {
    /* ignore */
  }
}

/** 两个地址是否指向不同页面（按 URL 规范化比较；非法地址按字面比较） */
function isDifferentPage(a: string, b: string): boolean {
  try {
    return new URL(a, window.location.href).href !== new URL(b, window.location.href).href;
  } catch {
    return a !== b;
  }
}

/**
 * 是否只有 hash 不同：hash 路由的 SPA 跳转不重建文档（挂件不会重新挂载），
 * 需要在当前上下文里等路由渲染后再高亮；其余地址变化都是整页导航。
 */
function isHashOnlyChange(a: string, b: string): boolean {
  try {
    const next = new URL(a, window.location.href);
    const current = new URL(b, window.location.href);
    return (
      next.origin === current.origin &&
      next.pathname === current.pathname &&
      next.search === current.search
    );
  } catch {
    return false;
  }
}

/** 按选择器在页面里找元素；选择器非法（历史数据）时放弃，不做更宽松的猜测匹配 */
function queryPageElement(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function getBubbleFileText(element: AIPanelSelectedElement): string {
  const fileName = element.filePath ? fileNameOf(element.filePath) : "";
  const lineInfo = element.line
    ? `:${element.line}${element.column ? `:${element.column}` : ""}`
    : "";

  return `${fileName}${lineInfo}`;
}

function getPanelFileText(element: AIPanelSelectedElement): string {
  const fileName = (element.filePath && fileNameOf(element.filePath)) || "未知文件";
  const lineInfo = element.line
    ? `:${element.line}${element.column ? `:${element.column}` : ""}`
    : "";
  const textPreview = element.innerText?.trim()
    ? `${truncate(element.innerText.trim(), 30)} · `
    : "";

  return `${textPreview}${fileName}${lineInfo}`;
}

export interface UseSelectionOptions {
  selectMode: Ref<boolean>;
  selectedElements: Ref<AIPanelSelectedElement[]>;
  onToggleSelectMode: (mode: boolean) => void;
  onRemoveSelectedNode: (payload: AIPanelRemoveSelectedPayload) => void;
  onClearSelectedNodes: () => void;
  showConfirmDialog: (message: string) => Promise<boolean>;
  /**
   * 是否在页面内定位（默认 true；可传 getter，显示模式运行时可变）。
   * 扩展模式下挂件在侧栏、页面不在本上下文，置 false 以免去操作侧栏自身的 document。
   */
  locateInPage?: boolean | (() => boolean);
  /** 高亮元素：复用选择模式的高亮框闪烁（由挂件的 inspector 提供） */
  flashHighlight?: (element: Element) => void;
  /** 跳转到目标页（默认 window.location.assign；测试可注入） */
  navigate?: (url: string) => void;
  /** 轻提示（定位失败时给出原因） */
  notify?: (message: string) => void;
}

export function useSelection(options: UseSelectionOptions) {
  const bubbleVisible = computed(() => options.selectMode.value);

  /** 当前是否在页面内定位（选项可为布尔或 getter） */
  function shouldLocateInPage(): boolean {
    const value = options.locateInPage;
    return typeof value === "function" ? value() : value !== false;
  }

  const selectedElementItems = computed<AIPanelSelectedElementItem[]>(() =>
    (options.selectedElements.value || []).map(
      (element: AIPanelSelectedElement, index: number) => ({
        key: getElementKey(element, index),
        description: element.description || "未知元素",
        bubbleFileText: getBubbleFileText(element),
        panelFileText: getPanelFileText(element),
        element,
      }),
    ),
  );

  const hasSelectedElements = computed(() => selectedElementItems.value.length > 0);

  function handleToggleSelectMode(): void {
    options.onToggleSelectMode(!options.selectMode.value);
  }

  /**
   * 点击已选节点（或 dsh 里的 chip）：跳到它被选中时的页面并闪烁高亮。
   * 同页直接定位；hash 路由跳转不重建文档，就地等渲染后定位；
   * 整页导航则先暂存选择器，落地页挂件挂载时消费。
   */
  function handleLocateSelectedElement(element: AIPanelSelectedElement): void {
    if (!shouldLocateInPage()) return;

    const selector = element.description?.trim();
    if (!selector) return;

    const navigate = options.navigate ?? ((to: string) => window.location.assign(to));
    const url = element.previewPageUrl;
    if (url && isDifferentPage(url, window.location.href)) {
      if (isHashOnlyChange(url, window.location.href)) {
        navigate(url);
        void flashWhenRendered(selector);
        return;
      }
      stashPendingLocate(selector);
      navigate(url);
      return;
    }

    const target = queryPageElement(selector);
    if (!target) {
      options.notify?.("未找到该节点，页面可能已变化");
      return;
    }
    options.flashHighlight?.(target);
  }

  function handleClickSelectedNode(item: AIPanelSelectedElementItem): void {
    handleLocateSelectedElement(item.element);
  }

  /**
   * 等元素出现再闪烁（最多 2 秒）：路由渲染与挂件挂载都可能晚于触发。
   * @returns 是否命中并完成闪烁
   */
  async function flashWhenRendered(selector: string): Promise<boolean> {
    const deadline = Date.now() + 2000;
    for (;;) {
      const target = queryPageElement(selector);
      if (target) {
        options.flashHighlight?.(target);
        return true;
      }
      if (Date.now() >= deadline) return false;
      await sleep(50);
    }
  }

  /** 消费整页跳转前暂存的定位交接（挂件挂载时调用） */
  async function consumePendingLocate(): Promise<void> {
    if (!shouldLocateInPage()) return;
    const selector = takePendingLocate();
    if (selector) await flashWhenRendered(selector);
  }

  function handleRemoveSelectedNode(
    item: AIPanelSelectedElementItem,
    index: number,
    source: AIPanelRemoveSelectedPayload["source"],
  ): void {
    options.onRemoveSelectedNode({ element: item.element, index, source });
  }

  async function handleClearSelectedNodes(): Promise<void> {
    if (!options.selectedElements.value || options.selectedElements.value.length === 0) return;
    const confirmed = await options.showConfirmDialog(
      `确定要清空所有 ${options.selectedElements.value.length} 个已选节点吗？`,
    );
    if (confirmed) {
      options.onClearSelectedNodes();
    }
  }

  return {
    bubbleVisible,
    hasSelectedElements,
    selectedElementItems,
    consumePendingLocate,
    handleClearSelectedNodes,
    handleClickSelectedNode,
    handleLocateSelectedElement,
    handleRemoveSelectedNode,
    handleToggleSelectMode,
  };
}
