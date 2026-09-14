/// <reference lib="dom" />
import { INSPECTOR_ADAPTER_IDS } from "../constants";
import {
  parseSourceLocation,
  type InspectorAdapter,
  type InspectorElementClickHandler,
  type InspectorSourceLocation,
} from "./types";

/** unplugin-vue-inspector 注入的源码坐标标记属性 */
const SOURCE_LOCATION_ATTRIBUTE = "data-v-inspector";

/** 旧版 unplugin-vue-inspector 通过 vnode props 传递源码坐标的键 */
const VNODE_SOURCE_KEY = "__v_inspector";

/** unplugin-vue-inspector 的忽略标记属性 */
const IGNORE_ATTRIBUTE = "data-v-inspector-ignore";

/** unplugin-vue-inspector 的覆盖层容器选择器 */
const OVERLAY_SELECTOR = "#vue-inspector-container";

/** unplugin-vue-inspector 暴露到页面的运行时控制对象 */
interface VueInspectorRuntime {
  handleClick: (e: MouseEvent) => void;
  enable: () => void;
  disable: () => void;
  /** AIPanel 已接管 handleClick 的标记（幂等安装） */
  __aipanel_hooked?: boolean;
}

declare global {
  interface Window {
    __VUE_INSPECTOR__?: VueInspectorRuntime;
  }
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

/** 当前页面的 unplugin-vue-inspector 运行时（未注入时为 undefined） */
function getRuntime(): VueInspectorRuntime | undefined {
  return typeof window === "undefined" ? undefined : window.__VUE_INSPECTOR__;
}

/** 元素是否属于适配器自身覆盖层或带忽略标记（不参与解析，继续向父级查找） */
function isAdapterOwned(element: Element): boolean {
  return element.hasAttribute(IGNORE_ATTRIBUTE) || Boolean(element.closest(OVERLAY_SELECTOR));
}

/** 读取元素（或其组件 vnode）上由 unplugin-vue-inspector 写入的源码坐标字符串 */
function getMarkerData(element: Element): string | undefined {
  const vnodeData = (element as unknown as { __vnode?: { props?: Record<string, unknown> } })
    .__vnode?.props?.[VNODE_SOURCE_KEY];
  if (vnodeData) return vnodeData as string;

  const ctxVNode = (
    element as unknown as {
      __vnode?: { ctx?: { vnode?: { el?: Element; props?: Record<string, unknown> } } };
    }
  ).__vnode?.ctx?.vnode;
  if (ctxVNode?.el === element) {
    const ctxData = ctxVNode.props?.[VNODE_SOURCE_KEY];
    if (ctxData) return ctxData as string;
  }

  const vueInstance = (
    element as unknown as {
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
    if (currentParent.vnode?.el === element) {
      const parentData = currentParent.vnode.props?.[VNODE_SOURCE_KEY];
      if (parentData) return parentData as string;
    }
    currentParent = currentParent.parent as typeof currentParent;
  }

  return element.getAttribute(SOURCE_LOCATION_ATTRIBUTE) ?? undefined;
}

/** 元素及其祖先上的源码坐标标记（含行、列） */
function resolveFromMarker(element: Element): InspectorSourceLocation | null {
  const data = getMarkerData(element);
  return data ? parseSourceLocation(data) : null;
}

/** Vue 组件实例上的 __file（仅文件，无行列） */
function resolveFromVueInstance(element: Element): InspectorSourceLocation | null {
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

/** 合并两个候选：优先落在项目内（非 node_modules）的坐标；都有行列的标记结果优先 */
function mergeSourceLocations(
  markerLocation: InspectorSourceLocation | null,
  instanceLocation: InspectorSourceLocation | null,
): InspectorSourceLocation | null {
  if (!markerLocation?.file && !instanceLocation?.file) return null;

  if (markerLocation?.file && instanceLocation?.file) {
    const isNodeModules = (path: string) => path.includes("node_modules");
    if (!isNodeModules(markerLocation.file)) return markerLocation;
    if (!isNodeModules(instanceLocation.file)) return instanceLocation;
    return markerLocation;
  }

  return markerLocation?.file ? markerLocation : instanceLocation;
}

/** 宿主的元素点击处理器（后注册者生效，与"只安装一次"的解包共用） */
let clickHandler: InspectorElementClickHandler | null = null;

/**
 * Vue 适配器：复用 unplugin-vue-inspector 注入的运行时与源码坐标标记，
 * 在宿主选择模式下接管点击、解析元素源码位置。
 */
export const vueInspectorAdapter: InspectorAdapter = {
  id: INSPECTOR_ADAPTER_IDS.vue,
  label: "Vue Inspector",
  ignoreSelectors: [OVERLAY_SELECTOR],
  ignoreAttributes: [IGNORE_ATTRIBUTE],

  isAvailable() {
    return Boolean(getRuntime());
  },

  resolveSourceLocation(element) {
    let current: Element | null = element;
    let markerLocation: InspectorSourceLocation | null = null;
    let instanceLocation: InspectorSourceLocation | null = null;

    while (current && !(markerLocation && instanceLocation)) {
      if (!isAdapterOwned(current)) {
        markerLocation ??= resolveFromMarker(current);
        instanceLocation ??= resolveFromVueInstance(current);
      }
      current = current.parentElement;
    }

    return mergeSourceLocations(markerLocation, instanceLocation);
  },

  onElementClick(handler: InspectorElementClickHandler) {
    clickHandler = handler;

    const runtime = getRuntime();
    if (!runtime || runtime.__aipanel_hooked) return;

    const originalHandleClick = runtime.handleClick.bind(runtime);

    runtime.handleClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (clickHandler?.(element, event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      originalHandleClick(event);
    };

    runtime.__aipanel_hooked = true;
  },

  setEnabled(enabled: boolean) {
    const runtime = getRuntime();
    if (!runtime) return;
    if (enabled) runtime.enable();
    else runtime.disable();
  },
};
