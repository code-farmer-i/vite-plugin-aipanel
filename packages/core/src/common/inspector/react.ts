/// <reference lib="dom" />
import { INSPECTOR_ADAPTER_IDS } from "../constants";
import {
  parseSourceLocation,
  type InspectorAdapter,
  type InspectorElementClickHandler,
  type InspectorSourceLocation,
} from "./types";

/** code-inspector-plugin 构建期注入的源码坐标属性（值为 "文件:行:列:节点名"） */
const SOURCE_LOCATION_ATTRIBUTE = "data-insp-path";

/** react-dev-inspector 注入的源码坐标属性（兼容读取：用户已配置时无需我们的构建期插件） */
const RDI_PATH_ATTRIBUTE = "data-inspector-relative-path";
const RDI_LINE_ATTRIBUTE = "data-inspector-line";
const RDI_COLUMN_ATTRIBUTE = "data-inspector-column";

/** React 挂在 DOM 元素上的 fiber 内部键前缀（无公开 API，仅用于运行时探测与兜底解析） */
const FIBER_KEY_PREFIX = "__reactFiber$";
const CONTAINER_KEY_PREFIX = "__reactContainer$";

/** React ≤19.1 开发构建下 fiber 上的 JSX 源码位置（19.2 起已移除，仅作兜底） */
interface ReactDebugSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface ReactFiber {
  _debugSource?: ReactDebugSource;
  return?: ReactFiber | null;
}

/** fiber 兜底解析的链上溯深度上限（防病态结构下的无界遍历） */
const FIBER_WALK_LIMIT = 50;

/** 兜底探测的正文元素扫描上限（探测仅在挂件初始化轮询时低频触发） */
const DETECT_SCAN_LIMIT = 200;

/** 宿主的元素点击处理器（React 无底层 inspector 运行时，适配器自装监听接管） */
let clickHandler: InspectorElementClickHandler | null = null;
let listenerInstalled = false;
let enabled = false;

function hasFiberKey(element: Element): boolean {
  const keys = Object.keys(element);
  return keys.some(
    (key) => key.startsWith(FIBER_KEY_PREFIX) || key.startsWith(CONTAINER_KEY_PREFIX),
  );
}

/** 页面是否运行着 React 应用（检测元素上的 React fiber 内部键） */
function detectReactRuntime(): boolean {
  if (typeof document === "undefined") return false;
  const roots = document.querySelectorAll("#root, #__next, [data-reactroot]");
  for (const element of [document.body, ...roots]) {
    if (element && hasFiberKey(element)) return true;
  }
  const descendants = document.body?.querySelectorAll("*") ?? [];
  const limit = Math.min(descendants.length, DETECT_SCAN_LIMIT);
  for (let index = 0; index < limit; index += 1) {
    if (hasFiberKey(descendants[index])) return true;
  }
  return false;
}

/** 读取元素上构建期注入的源码坐标标记（自研注入与 react-dev-inspector 兼容读取） */
function resolveFromAttributes(element: Element): InspectorSourceLocation | null {
  const marker = element.getAttribute(SOURCE_LOCATION_ATTRIBUTE);
  if (marker) {
    // 值为 "文件:行:列:节点名"，去掉末段节点名后复用统一解析
    const location = parseSourceLocation(marker.replace(/:[^:]*$/, ""));
    if (location) return location;
  }

  const rdiPath = element.getAttribute(RDI_PATH_ATTRIBUTE);
  if (rdiPath) {
    return {
      file: rdiPath,
      line: Number.parseInt(element.getAttribute(RDI_LINE_ATTRIBUTE) ?? "", 10) || null,
      column: Number.parseInt(element.getAttribute(RDI_COLUMN_ATTRIBUTE) ?? "", 10) || null,
    };
  }

  return null;
}

/** fiber._debugSource 兜底（React ≤19.1）：沿 fiber.return 链找最近携带源码位置的节点 */
function resolveFromFiber(element: Element): InspectorSourceLocation | null {
  const fiberKey = Object.keys(element).find((key) => key.startsWith(FIBER_KEY_PREFIX));
  let fiber: ReactFiber | null | undefined = fiberKey
    ? (element as unknown as Record<string, ReactFiber | undefined>)[fiberKey]
    : null;
  for (let depth = 0; fiber && depth < FIBER_WALK_LIMIT; depth += 1) {
    const source = fiber._debugSource;
    if (source?.fileName) {
      return {
        file: source.fileName,
        line: source.lineNumber ?? null,
        // React 的 columnNumber 为 0 基，统一转 1 基（与编辑器跳转一致）
        column: source.columnNumber != null ? source.columnNumber + 1 : null,
      };
    }
    fiber = fiber.return;
  }
  return null;
}

function handleDocumentClick(event: MouseEvent): void {
  if (!enabled) return;
  const element = event.target instanceof Element ? event.target : null;
  if (clickHandler?.(element, event)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/**
 * React 适配器：构建期由 vite 集成（@code-inspector/core transformCode）注入
 * data-insp-path 源码坐标标记，运行时按「注入标记 → react-dev-inspector 兼容属性 →
 * fiber._debugSource」依次解析；React 无底层 inspector 运行时，
 * 点击接管由适配器自装的 document 捕获监听实现。
 */
export const reactInspectorAdapter: InspectorAdapter = {
  id: INSPECTOR_ADAPTER_IDS.react,
  label: "React Inspector",
  ignoreSelectors: [],
  ignoreAttributes: [],

  isAvailable() {
    return detectReactRuntime();
  },

  resolveSourceLocation(element) {
    let current: Element | null = element;
    while (current) {
      const location = resolveFromAttributes(current) ?? resolveFromFiber(current);
      if (location?.file) return location;
      current = current.parentElement;
    }
    return null;
  },

  onElementClick(handler: InspectorElementClickHandler) {
    clickHandler = handler;
    if (listenerInstalled) return;
    // 捕获阶段安装，不依赖页面自身的事件委托；未启用时 handler 内部短路
    document.addEventListener("click", handleDocumentClick, true);
    listenerInstalled = true;
  },

  setEnabled(next: boolean) {
    enabled = next;
  },
};
