/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { ref, watch, onMounted, onUnmounted, nextTick, type Ref } from "vue";
import { truncate } from "@aipanel/core";
import getCssSelector from "css-selector-generator";
import type { AIPanelSelectedElement } from "../src/types";

interface VueInspector {
  getTargetNode: (e: MouseEvent) => {
    targetNode: Element | null;
    params: { file?: string; line?: number; column?: number } | null;
  };
  handleClick: (e: MouseEvent) => void;
  enable: () => void;
  disable: () => void;
  __aipanel_hooked?: boolean;
}

declare global {
  interface Window {
    __VUE_INSPECTOR__?: VueInspector;
  }
}

interface UseInspectorOptions {
  selectMode: Ref<boolean>;
  onAddSelectedNode: (element: AIPanelSelectedElement) => void;
  onExitSelectMode: () => void;
}

interface FileInfo {
  file: string | null;
  line: number | null;
  column: number | null;
}

// 需要忽略的选择器列表
const IGNORE_SELECTORS = [
  "#vue-inspector-container",
  ".aipanel-widget",
  ".aipanel-element-highlight",
  ".aipanel-element-tooltip",
  ".aipanel-select-mode-hint",
  ".floating-bubble",
];

const IGNORE_ATTRIBUTE = "data-v-inspector-ignore";

const KEY_PROPS_DATA = "__v_inspector";
const KEY_DATA = "data-v-inspector";

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

interface Vue3ComponentInstance {
  type?: {
    __file?: string;
    name?: string;
  };
  parent?: Vue3ComponentInstance;
  vnode?: {
    type?: {
      __file?: string;
      name?: string;
    };
  };
}

interface Vue2ComponentInstance {
  $options?: {
    __file?: string;
    name?: string;
    _componentTag?: string;
  };
  $parent?: Vue2ComponentInstance;
}

function getFileInfoFromVueInstance(element: Element): FileInfo | null {
  const vue3Instance = (element as Element & { __vueParentComponent?: Vue3ComponentInstance })
    .__vueParentComponent;
  if (vue3Instance) {
    let current: Vue3ComponentInstance | undefined = vue3Instance;
    while (current) {
      const file = current.type?.__file || current.vnode?.type?.__file;
      if (file) {
        return { file, line: null, column: null };
      }
      current = current.parent;
    }
  }

  const vue2Instance = (element as Element & { __vue__?: Vue2ComponentInstance }).__vue__;
  if (vue2Instance) {
    let current: Vue2ComponentInstance | undefined = vue2Instance;
    while (current) {
      const file = current.$options?.__file;
      if (file) {
        return { file, line: null, column: null };
      }
      current = current.$parent;
    }
  }

  return null;
}

function shouldIgnoreElement(el: Element): boolean {
  if (el.hasAttribute(IGNORE_ATTRIBUTE)) return true;
  for (const selector of IGNORE_SELECTORS) {
    if (el.closest(selector)) return true;
  }
  return false;
}

function getDataFromElement(el: Element): string | undefined {
  const vnodeData = (el as unknown as { __vnode?: { props?: Record<string, unknown> } }).__vnode
    ?.props?.[KEY_PROPS_DATA];
  if (vnodeData) return vnodeData as string;

  const ctxVNode = (
    el as unknown as {
      __vnode?: { ctx?: { vnode?: { el?: Element; props?: Record<string, unknown> } } };
    }
  ).__vnode?.ctx?.vnode;
  if (ctxVNode?.el === el) {
    const ctxData = ctxVNode.props?.[KEY_PROPS_DATA];
    if (ctxData) return ctxData as string;
  }

  const vueInstance = (
    el as unknown as {
      __vueParentComponent?: {
        parent?: {
          vnode?: { el?: Element; props?: Record<string, unknown> };
          parent?: unknown;
        };
      };
    }
  ).__vueParentComponent;

  let currentParent = vueInstance?.parent;
  while (currentParent) {
    if (currentParent.vnode?.el === el) {
      const parentData = currentParent.vnode.props?.[KEY_PROPS_DATA];
      if (parentData) return parentData as string;
    }
    currentParent = currentParent.parent as typeof currentParent;
  }

  const attr = el.getAttribute(KEY_DATA);
  return attr ?? undefined;
}

function findInspectorFileInfo(element: Element): FileInfo | null {
  let current: Element | null = element;
  while (current) {
    if (shouldIgnoreElement(current)) {
      current = current.parentElement;
      continue;
    }
    const data = getDataFromElement(current);
    if (data) {
      const splitRE = /(.+):([\d]+):([\d]+)$/;
      const match = data.match(splitRE);
      if (match) {
        return {
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
        };
      }
    }
    current = current.parentElement;
  }
  return null;
}

function mergeFileInfo(inspectorFileInfo: FileInfo | null, vueFileInfo: FileInfo | null): FileInfo {
  if (!inspectorFileInfo?.file && !vueFileInfo?.file) {
    return { file: null, line: null, column: null };
  }

  const isNodeModules = (path: string) => path.includes("node_modules");

  if (inspectorFileInfo?.file && vueFileInfo?.file) {
    if (!isNodeModules(inspectorFileInfo.file)) {
      return inspectorFileInfo;
    } else if (!isNodeModules(vueFileInfo.file)) {
      return vueFileInfo;
    } else {
      return inspectorFileInfo;
    }
  } else if (inspectorFileInfo?.file) {
    return inspectorFileInfo;
  } else {
    return vueFileInfo!;
  }
}

function getTargetElement(e: MouseEvent): Element | null {
  if (!e.target || !(e.target instanceof Element)) return null;
  const el = e.target as Element;
  if (shouldIgnoreElement(el)) return null;
  return el;
}

function getFileInfo(e: MouseEvent, element: Element | null): FileInfo {
  let inspectorFileInfo: FileInfo | null = null;

  if (element) {
    inspectorFileInfo = findInspectorFileInfo(element);
  }

  const vueFileInfo = element ? getFileInfoFromVueInstance(element) : null;

  return mergeFileInfo(inspectorFileInfo, vueFileInfo);
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

  const INSPECTOR_CHECK_INTERVAL = 500;
  let inspectorCheckTimer: number | null = null;
  let currentPrimary = "#3b82f6";
  let currentPrimaryBg = "rgba(59, 130, 246, 0.1)";

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
    const fileInfo = getFileInfo(e, elementToHighlight);

    setPointerEventsAuto(uiElements);

    if (elementToHighlight) {
      const widget = document.querySelector(".aipanel-widget");
      if (widget) {
        const style = getComputedStyle(widget);
        currentPrimary = style.getPropertyValue("--ap-primary").trim() || currentPrimary;
        currentPrimaryBg = style.getPropertyValue("--ap-primary-bg").trim() || currentPrimaryBg;
      }

      const description = getElementDescription(elementToHighlight);
      const fileName = fileInfo.file ? fileInfo.file.split("/").pop() : "";
      let lineInfo = "";
      if (fileInfo.line) {
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

  function setupInspectorHook() {
    const inspector = window.__VUE_INSPECTOR__;
    if (!inspector || inspector.__aipanel_hooked) return;

    const originalHandleClick = inspector.handleClick.bind(inspector);

    inspector.handleClick = function (e: MouseEvent) {
      if (options.selectMode.value) {
        const targetEl = e.target instanceof Element ? e.target : null;
        if (targetEl && targetEl.closest(".aipanel-widget")) {
          return originalHandleClick.call(inspector, e);
        }

        e.preventDefault();
        e.stopPropagation();

        const elementToSelect = getTargetElement(e);
        const fileInfo = getFileInfo(e, elementToSelect);

        if (elementToSelect) {
          const innerText = getDirectText(elementToSelect);
          const description = getElementDescription(elementToSelect);

          const elementInfo: AIPanelSelectedElement = {
            filePath: fileInfo.file,
            line: fileInfo.line,
            column: fileInfo.column,
            innerText: truncate(innerText, 200),
            description,
          };

          options.onAddSelectedNode(elementInfo);
        }
        return;
      }

      return originalHandleClick.call(inspector, e);
    };

    inspector.__aipanel_hooked = true;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && options.selectMode.value) {
      e.preventDefault();
      e.stopPropagation();
      options.onExitSelectMode();
    }
  }

  watch(options.selectMode, (newVal) => {
    const inspector = window.__VUE_INSPECTOR__;
    if (newVal) {
      if (inspector) {
        inspector.enable();
      }
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("keydown", handleKeydown, true);
    } else {
      if (inspector) {
        inspector.disable();
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("keydown", handleKeydown, true);
      highlightVisible.value = false;
      tooltipVisible.value = false;
    }
  });

  onMounted(() => {
    if (window.__VUE_INSPECTOR__) {
      setupInspectorHook();
    } else {
      inspectorCheckTimer = window.setInterval(() => {
        if (window.__VUE_INSPECTOR__) {
          setupInspectorHook();
          if (inspectorCheckTimer) {
            window.clearInterval(inspectorCheckTimer);
            inspectorCheckTimer = null;
          }
        }
      }, INSPECTOR_CHECK_INTERVAL);
    }
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
