import { computed, type Ref } from "vue";
import { truncate } from "@aipanel/core";
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

function getBubbleFileText(element: AIPanelSelectedElement): string {
  const fileName = element.filePath?.split("/").pop() || "";
  const lineInfo = element.line
    ? `:${element.line}${element.column ? `:${element.column}` : ""}`
    : "";

  return `${fileName}${lineInfo}`;
}

function getPanelFileText(element: AIPanelSelectedElement): string {
  const fileName = element.filePath?.split("/").pop() || "未知文件";
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
}

export function useSelection(options: UseSelectionOptions) {
  const bubbleVisible = computed(() => options.selectMode.value);

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

  function handleClickSelectedNode(item: AIPanelSelectedElementItem): void {
    const description = item.element.description;
    if (!description) return;

    let targetElement: Element | null = null;

    if (description.includes("#")) {
      const idMatch = description.match(/#([^.[\s]+)/);
      if (idMatch) {
        targetElement = document.getElementById(idMatch[1]);
      }
    }

    if (!targetElement && description.includes(".")) {
      const classMatch = description.match(/^([a-z]+)\.([^[\s]+)/i);
      if (classMatch) {
        const tagName = classMatch[1];
        const classes = classMatch[2].split(".").filter(Boolean);
        const selector = `${tagName}.${classes.join(".")}`;
        targetElement = document.querySelector(selector);
      }
    }

    if (!targetElement) {
      const tagMatch = description.match(/^([a-z]+)/i);
      if (tagMatch) {
        const simpleSelector = description.split(/[.[\s]/)[0];
        targetElement = document.querySelector(simpleSelector);
      }
    }

    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });

      const highlightOverlay = document.createElement("div");
      highlightOverlay.className = "aipanel-element-highlight-temp";

      const widget = document.querySelector(".aipanel-widget");
      let primary = "#3b82f6";
      let primaryBg = "rgba(59, 130, 246, 0.1)";
      if (widget) {
        const style = getComputedStyle(widget);
        primary = style.getPropertyValue("--ap-primary").trim() || primary;
        primaryBg = style.getPropertyValue("--ap-primary-bg").trim() || primaryBg;
      }

      highlightOverlay.style.border = `2px solid ${primary}`;
      highlightOverlay.style.background = primaryBg;

      const rect = targetElement.getBoundingClientRect();
      highlightOverlay.style.top = `${rect.top + window.scrollY}px`;
      highlightOverlay.style.left = `${rect.left + window.scrollX}px`;
      highlightOverlay.style.width = `${rect.width}px`;
      highlightOverlay.style.height = `${rect.height}px`;
      document.body.appendChild(highlightOverlay);

      setTimeout(() => {
        highlightOverlay.remove();
      }, 2000);
    }
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
    handleClearSelectedNodes,
    handleClickSelectedNode,
    handleRemoveSelectedNode,
    handleToggleSelectMode,
  };
}
