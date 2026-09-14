/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { ref, watch, onMounted, onUnmounted, nextTick, type Ref } from "vue";
import {
  INSPECTOR_CHECK_INTERVAL,
  listInspectorAdapters,
  resolveInspectorAdapter,
  truncate,
  type InspectorSourceLocation,
} from "@aipanel/core";
import getCssSelector from "css-selector-generator";
import type { AIPanelSelectedElement } from "../src/types";

interface UseInspectorOptions {
  selectMode: Ref<boolean>;
  onAddSelectedNode: (element: AIPanelSelectedElement) => void;
  onExitSelectMode: () => void;
}

/** 挂件自身 UI 根节点：点击其内部元素透传给底层 inspector，不进入元素选择 */
const WIDGET_ROOT_SELECTOR = ".aipanel-widget";

/** 挂件自身 UI：不参与元素选择 */
const WIDGET_IGNORE_SELECTORS = [
  WIDGET_ROOT_SELECTOR,
  ".aipanel-element-highlight",
  ".aipanel-element-tooltip",
  ".aipanel-select-mode-hint",
  ".floating-bubble",
];

// 需要忽略的选择器/属性：挂件自身 UI + 各框架适配器自带的覆盖层与忽略标记（单一来源）
const IGNORE_SELECTORS = [
  ...WIDGET_IGNORE_SELECTORS,
  ...listInspectorAdapters().flatMap((adapter) => adapter.ignoreSelectors),
];

const IGNORE_ATTRIBUTES = listInspectorAdapters().flatMap((adapter) => adapter.ignoreAttributes);

function getDirectText(element: Element): string {
  // 不能只取直接文本节点：选中元素常含行内子元素（<span>/<b> 等），
  // 只取直接文本会丢掉子元素里的文本（"让 <b>AI</b> 成为" → "让 成为"）。
  // 改为读取整棵子树的可见文本；SVG 等无 innerText 时回退到 textContent。
  const el = element as HTMLElement;
  const text = el.innerText || element.textContent || "";
  return text.trim();
}

const DYNAMIC_ID_PATTERN =
  /^(?:el-|:r[0-9]+:|radix-|uid-|ts-|uuid-|id-[a-f0-9]{4,}|.*[0-9]{4,}.*|.*-[a-f0-9]{6,}$)/i;

const STATE_CLASS_PATTERN =
  /^(?:hover|active|focus|focus-visible|focus-within|disabled|enabled|checked|selected|open|closed|loading|error|success|warning|hidden|visible|show|hide|current|expanded|collapsed|pressed|dragging|droppable|sortable|placeholder|transition|enter|leave|appear|move)$/i;

const STATE_CLASS_PREFIX_PATTERN =
  /^(?:is-|has-|was-|are-|can-|should-|will-|did-|does-|on-|off-|in-|out-|at-|to-|from-)/i;

function isDynamicId(id: string): boolean {
  if (!id) return false;

  if (DYNAMIC_ID_PATTERN.test(id)) {
    return true;
  }

  const digitCount = (id.match(/\d/g) || []).length;
  const letterCount = (id.match(/[a-zA-Z]/g) || []).length;
  if (digitCount > letterCount && digitCount >= 3) {
    return true;
  }

  const dashParts = id.split("-");
  if (dashParts.length >= 3) {
    const lastPart = dashParts[dashParts.length - 1];
    if (/^\d+$/.test(lastPart) || /^[a-f0-9]{4,}$/i.test(lastPart)) {
      return true;
    }
  }

  return false;
}

function isStateClass(className: string): boolean {
  if (!className) return false;

  if (STATE_CLASS_PATTERN.test(className)) {
    return true;
  }

  if (STATE_CLASS_PREFIX_PATTERN.test(className)) {
    return true;
  }

  if (
    className.includes("-active") ||
    className.includes("-hover") ||
    className.includes("-focus")
  ) {
    return true;
  }

  if (/^(?:router-link|nuxt-link)/.test(className)) {
    return true;
  }

  return false;
}

function getElementDescription(element: Element): string {
  return getCssSelector(element, {
    selectors: ["id", "class", "tag", "nthchild"],
    combineWithinSelector: true,
    combineBetweenSelectors: true,
    maxCombinations: 100,
    maxCandidates: 100,
    blacklist: [
      (selectorValue: string) => {
        const idMatch = selectorValue.match(/^#(.+)$/);
        if (idMatch) {
          return isDynamicId(idMatch[1]);
        }
        const classMatch = selectorValue.match(/^\.([a-zA-Z_-][\w-]*)$/);
        if (classMatch) {
          return isStateClass(classMatch[1]);
        }
        return false;
      },
    ],
  });
}

function shouldIgnoreElement(el: Element): boolean {
  if (IGNORE_ATTRIBUTES.some((attribute) => el.hasAttribute(attribute))) return true;
  for (const selector of IGNORE_SELECTORS) {
    if (el.closest(selector)) return true;
  }
  return false;
}

/** 元素源码位置：依次尝试各框架适配器解析（与 inspector 运行时是否就绪无关） */
function resolveElementSourceLocation(element: Element | null): InspectorSourceLocation | null {
  if (!element) return null;
  for (const adapter of listInspectorAdapters()) {
    const location = adapter.resolveSourceLocation(element);
    if (location?.file) return location;
  }
  return null;
}

function getTargetElement(e: MouseEvent): Element | null {
  if (!e.target || !(e.target instanceof Element)) return null;
  const el = e.target as Element;
  if (shouldIgnoreElement(el)) return null;
  return el;
}

export function useInspector(options: UseInspectorOptions) {
  const highlightVisible = ref(false);
  const highlightStyle = ref<Record<string, string>>({
    top: "0px",
    left: "0px",
    width: "0px",
    height: "0px",
  });

  const tooltipVisible = ref(false);
  const tooltipStyle = ref({ top: "0px", left: "0px" });
  const tooltipContent = ref({ description: "", fileInfo: "" });

  let inspectorCheckTimer: number | null = null;
  let currentPrimary = "#4176e6";
  let currentPrimaryBg = "rgba(65, 118, 230, 0.1)";

  function setPointerEventsNone(elements: (Element | null)[]) {
    elements.forEach((el) => {
      if (el) (el as HTMLElement).style.pointerEvents = "none";
    });
  }

  function setPointerEventsAuto(elements: (Element | null)[]) {
    elements.forEach((el) => {
      if (el) (el as HTMLElement).style.pointerEvents = "";
    });
  }

  function handleMouseMoveCore(e: MouseEvent) {
    if (!options.selectMode.value) return;

    const highlight = document.querySelector(".aipanel-element-highlight");
    const tooltip = document.querySelector(".aipanel-element-tooltip");
    const selectHint = document.querySelector(".aipanel-select-mode-hint");
    const floatingBubble = document.querySelector(".floating-bubble");

    const uiElements = [highlight, tooltip, selectHint, floatingBubble];
    setPointerEventsNone(uiElements);

    const elementToHighlight = getTargetElement(e);
    const fileInfo = resolveElementSourceLocation(elementToHighlight);

    setPointerEventsAuto(uiElements);

    if (elementToHighlight) {
      const widget = document.querySelector(".aipanel-widget");
      if (widget) {
        const style = getComputedStyle(widget);
        // 选择高亮用品牌强调色（deepseek 蓝），不用主操作 CTA 色
        currentPrimary = style.getPropertyValue("--ap-accent").trim() || currentPrimary;
        currentPrimaryBg = style.getPropertyValue("--ap-accent-bg").trim() || currentPrimaryBg;
      }

      const description = getElementDescription(elementToHighlight);
      const fileName = fileInfo?.file ? fileInfo.file.split("/").pop() : "";
      let lineInfo = "";
      if (fileInfo?.line) {
        lineInfo = `:${fileInfo.line}`;
        if (fileInfo.column) {
          lineInfo += `:${fileInfo.column}`;
        }
      }
      const fileInfoText = fileName ? `${fileName}${lineInfo}` : "";

      tooltipContent.value = {
        description,
        fileInfo: fileInfoText,
      };

      const rect = elementToHighlight.getBoundingClientRect();

      const newTop = `${rect.top}px`;
      const newLeft = `${rect.left}px`;
      const newWidth = `${rect.width}px`;
      const newHeight = `${rect.height}px`;

      if (
        highlightStyle.value.top !== newTop ||
        highlightStyle.value.left !== newLeft ||
        highlightStyle.value.width !== newWidth ||
        highlightStyle.value.height !== newHeight
      ) {
        highlightStyle.value = {
          top: newTop,
          left: newLeft,
          width: newWidth,
          height: newHeight,
          border: `2px solid ${currentPrimary}`,
          background: currentPrimaryBg,
        };
      }

      // 标记 highlight 可见
      highlightVisible.value = true;
      tooltipVisible.value = true;

      // 等 Vue 把新内容渲染到 DOM 后，再读取真实尺寸并计算位置
      // 这样多行换行的 tooltip 也能精确避让选中元素
      void nextTick(() => {
        const tooltipEl = document.querySelector(".aipanel-element-tooltip") as HTMLElement | null;
        if (!tooltipEl) return;

        const tooltipWidth = tooltipEl.offsetWidth;
        const tooltipHeight = tooltipEl.offsetHeight;
        if (tooltipWidth === 0 || tooltipHeight === 0) return;

        const margin = 10;
        const gap = 4;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const clampLeft = (left: number) =>
          Math.max(margin, Math.min(left, viewportWidth - tooltipWidth - margin));
        const clampTop = (top: number) =>
          Math.max(margin, Math.min(top, viewportHeight - tooltipHeight - margin));

        const candidateTop = rect.top - tooltipHeight - gap;
        const candidateBottom = rect.bottom + gap;
        const candidateRight = rect.right + gap;
        const candidateLeft = rect.left - tooltipWidth - gap;
        const verticalCenter = rect.top + (rect.height - tooltipHeight) / 2;

        let tooltipTop = 0;
        let tooltipLeft = 0;
        let placed = false;

        // 1) 元素上方
        if (candidateTop >= margin) {
          tooltipTop = candidateTop;
          tooltipLeft = clampLeft(rect.left);
          placed = true;
        }

        // 2) 元素下方
        if (!placed && candidateBottom + tooltipHeight <= viewportHeight - margin) {
          tooltipTop = candidateBottom;
          tooltipLeft = clampLeft(rect.left);
          placed = true;
        }

        // 3) 元素右侧
        if (!placed && candidateRight + tooltipWidth <= viewportWidth - margin) {
          tooltipLeft = candidateRight;
          tooltipTop = clampTop(verticalCenter);
          placed = true;
        }

        // 4) 元素左侧
        if (!placed && candidateLeft >= margin) {
          tooltipLeft = candidateLeft;
          tooltipTop = clampTop(verticalCenter);
          placed = true;
        }

        // 5) 兜底：选择与元素不重叠的视口角落
        if (!placed) {
          const corners: Array<{ top: number; left: number }> = [
            { top: margin, left: margin },
            { top: margin, left: viewportWidth - tooltipWidth - margin },
            { top: viewportHeight - tooltipHeight - margin, left: margin },
            {
              top: viewportHeight - tooltipHeight - margin,
              left: viewportWidth - tooltipWidth - margin,
            },
          ];

          for (const corner of corners) {
            const tooltipRight = corner.left + tooltipWidth;
            const tooltipBottom = corner.top + tooltipHeight;
            const overlaps =
              tooltipRight <= rect.left ||
              rect.right <= corner.left ||
              tooltipBottom <= rect.top ||
              rect.bottom <= corner.top;

            if (overlaps) {
              tooltipTop = corner.top;
              tooltipLeft = corner.left;
              placed = true;
              break;
            }
          }

          if (!placed) {
            tooltipTop = margin;
            tooltipLeft = margin;
          }
        }

        const newTooltipTop = `${tooltipTop}px`;
        const newTooltipLeft = `${tooltipLeft}px`;

        if (
          tooltipStyle.value.top !== newTooltipTop ||
          tooltipStyle.value.left !== newTooltipLeft
        ) {
          tooltipStyle.value = {
            top: newTooltipTop,
            left: newTooltipLeft,
          };
        }
      });
    } else {
      highlightVisible.value = false;
      tooltipVisible.value = false;
    }
  }

  const handleMouseMove = handleMouseMoveCore;

  /**
   * 元素点击：交给当前可用的框架适配器接管。
   * 返回 true = 宿主接管（适配器抑制底层默认行为）；返回 false = 透传给底层 inspector。
   */
  function handleElementClick(element: Element | null): boolean {
    if (!options.selectMode.value) return false;

    // 点击挂件自身 UI：透传给底层 inspector
    if (element?.closest(WIDGET_ROOT_SELECTOR)) return false;

    const elementToSelect = element && !shouldIgnoreElement(element) ? element : null;

    if (elementToSelect) {
      const fileInfo = resolveElementSourceLocation(elementToSelect);
      const innerText = getDirectText(elementToSelect);
      const description = getElementDescription(elementToSelect);

      const elementInfo: AIPanelSelectedElement = {
        filePath: fileInfo?.file ?? null,
        line: fileInfo?.line ?? null,
        column: fileInfo?.column ?? null,
        innerText: truncate(innerText, 200),
        description,
      };

      options.onAddSelectedNode(elementInfo);
    }

    return true;
  }

  /** 安装点击接管：适配器运行时未就绪时返回 false，由调用方轮询重试 */
  function hookInspector(): boolean {
    const adapter = resolveInspectorAdapter();
    if (!adapter) return false;
    adapter.onElementClick(handleElementClick);
    return true;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && options.selectMode.value) {
      e.preventDefault();
      e.stopPropagation();
      options.onExitSelectMode();
    }
  }

  watch(options.selectMode, (newVal) => {
    resolveInspectorAdapter()?.setEnabled(newVal);

    if (newVal) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("keydown", handleKeydown, true);
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("keydown", handleKeydown, true);
      highlightVisible.value = false;
      tooltipVisible.value = false;
    }
  });

  onMounted(() => {
    if (hookInspector()) return;

    inspectorCheckTimer = window.setInterval(() => {
      if (!hookInspector()) return;
      if (inspectorCheckTimer) {
        window.clearInterval(inspectorCheckTimer);
        inspectorCheckTimer = null;
      }
    }, INSPECTOR_CHECK_INTERVAL);
  });

  onUnmounted(() => {
    if (inspectorCheckTimer) {
      window.clearInterval(inspectorCheckTimer);
    }
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("keydown", handleKeydown, true);
  });

  return {
    highlightVisible,
    highlightStyle,
    tooltipVisible,
    tooltipStyle,
    tooltipContent,
  };
}
