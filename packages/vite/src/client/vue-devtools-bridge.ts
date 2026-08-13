/**
 * Vue DevTools 桥接脚本
 * 注入到用户页面，初始化 @vue/devtools-kit 并暴露到 window.__opencode_vue
 * AI 通过 Chrome DevTools evaluate_script 调用此 API
 *
 * API Proxy 自动对读操作做 safeStringify，getInspectorState 额外裁剪 Vue 内部数据
 */

import { devtools, devtoolsRouter, type InspectorState } from "@vue/devtools-kit";

// ==================== 裁剪常量 ====================

const MAX_STRING_LENGTH = 150;
const MAX_DEPTH = 3;
const MAX_KEYS = 20;

const VUE_INTERNAL_KEYS = new Set([
  "dep",
  "subs",
  "subsHead",
  "deps",
  "depsTail",
  "activeLink",
  "prevActiveLink",
  "nextDep",
  "prevDep",
  "flags",
  "globalVersion",
  "sc",
  "isSSR",
  "__v_isRef",
  "__v_isReadonly",
  "__v_skip",
  "computed",
  "effect",
  "setter",
  "fn",
]);

// 对 agent 无意义的状态分类
const SKIP_STATE_TYPES: Set<string> = new Set([
  "provided",
  "injected",
  "event listeners",
  "template refs",
]);

// ==================== 数据裁剪 ====================

function isVueInternalObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  // Vue 组件公共实例代理：枚举其 key 会在 dev 下触发警告，直接视为内部对象
  if ((value as { __isVue?: unknown }).__isVue === true) return true;
  const keys = Object.keys(value as object);
  const internalCount = keys.filter((k) => VUE_INTERNAL_KEYS.has(k)).length;
  return internalCount > 0 && internalCount >= keys.length * 0.5;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "<max depth>";

  // null / undefined 占位符
  if (value === null || value === "__undefined__") return null;

  // 字符串
  if (typeof value === "string") {
    if (value.startsWith("data:") || value.length > MAX_STRING_LENGTH)
      return `<${value.slice(0, 50)}... (${value.length} chars)>`;
    if (value === "[Circular Reference]" || value === "[Function]") return null;
    return value;
  }

  // 基本类型
  if (typeof value !== "object") return value;

  // 数组
  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((v) => sanitizeValue(v, depth + 1));
  }

  // Vue 内部对象 → 丢弃
  if (isVueInternalObject(value)) return null;

  // 普通对象
  const result: Record<string, unknown> = {};
  const keys = Object.keys(value as object)
    .filter((k) => !k.startsWith("Symbol("))
    .slice(0, MAX_KEYS);

  for (const key of keys) {
    if (VUE_INTERNAL_KEYS.has(key)) continue;
    const v = sanitizeValue((value as Record<string, unknown>)[key], depth + 1);
    if (v !== null) result[key] = v;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** 裁剪 InspectorState[]，去掉 Vue 内部数据和噪音类型 */
function sanitizeState(state: InspectorState[]): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const item of state) {
    if (SKIP_STATE_TYPES.has(item.type)) continue;

    if (!result[item.type]) result[item.type] = {};

    const value = sanitizeValue(item.value);
    if (value !== null) {
      result[item.type][item.key] = {
        value,
        ...(item.stateType ? { type: item.stateType } : {}),
      };
    }
  }
  return result;
}

// ==================== safeStringify ====================

function safeStringify(obj: unknown): string {
  const seen = new WeakSet();

  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular Reference]";
      seen.add(value);
    }
    if (typeof value === "function") return "[Function]";
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "bigint") return `${value}n`;
    if (value === undefined) return "__undefined__";
    return value;
  });
}

// ==================== API Proxy ====================

/** 需要自动 safeStringify 的读操作 */
const READ_METHODS = new Set([
  "getInspectorState",
  "getInspectorTree",
  "devtoolsState",
  "getRouterInfo",
  "getComponentRenderCode",
] as const);

interface InspectorStateResponse {
  state?: InspectorState[];
}

interface TreeNodeLike {
  id?: string;
  children?: TreeNodeLike[];
}

/** 从最新组件树判断 nodeId 是否存在（避免 instanceMap 因异步组件未挂载而滞后） */
async function isNodeIdValid(nodeId: unknown): Promise<boolean> {
  const targetId = String(nodeId);
  try {
    const tree = (await devtools.api.getInspectorTree({
      inspectorId: "components",
      filter: "",
    })) as unknown as TreeNodeLike[];

    const find = (nodes: TreeNodeLike[]): boolean =>
      nodes.some((n) => n.id === targetId || find(n.children ?? []));

    return find(tree);
  } catch {
    return false;
  }
}

const safeApi = new Proxy(devtools.api, {
  get(target, prop, receiver) {
    const original = Reflect.get(target, prop, receiver);
    if (typeof original !== "function" || !(READ_METHODS as Set<string>).has(prop as string))
      return original;

    return async (...args: unknown[]) => {
      if (prop === "getInspectorState") {
        const nodeId = (args[0] as { nodeId?: unknown } | undefined)?.nodeId;
        if (!(await isNodeIdValid(nodeId))) {
          return safeStringify({
            error: `组件 ${String(nodeId)} 已失效（页面可能已刷新或组件已卸载），请重新调用 vue-devtools_get_component_tree 获取最新 nodeId 后再试。`,
          });
        }
      }

      try {
        const raw = await (original as (...a: unknown[]) => unknown).apply(target, args);

        if (prop === "getInspectorState") {
          // 裁剪掉 Vue 内部对象 + 大幅缩小体积
          return safeStringify({
            state: sanitizeState(
              (raw as InspectorStateResponse)?.state ?? (raw as InspectorState[]),
            ),
          });
        }

        return safeStringify(raw);
      } catch (error) {
        // 页面刷新后 nodeId 可能已失效，devtools-kit 内部会因找不到组件实例而抛错。
        // 捕获并返回明确提示，避免在页面产生未处理的 Promise 拒绝。
        return safeStringify({
          error: `组件状态获取失败（${(error as Error).message}）。页面可能已刷新，请重新调用 vue-devtools_get_component_tree 获取最新 nodeId 后再试。`,
        });
      }
    };
  },
});

// ==================== 暴露到 window ====================

declare global {
  interface Window {
    __opencode_vue: {
      api: typeof safeApi;
      router: typeof devtoolsRouter;
      ctx: typeof devtools.ctx;
      safeStringify: typeof safeStringify;
    };
  }
}

devtools.init();

window.__opencode_vue = {
  api: safeApi,
  router: devtoolsRouter,
  ctx: devtools.ctx,
  safeStringify,
};
