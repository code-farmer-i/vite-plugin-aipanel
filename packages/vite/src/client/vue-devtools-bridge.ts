/**
 * Vue DevTools 桥接脚本
 * 注入到用户页面，初始化 @vue/devtools-kit 并暴露到 window.__aipanel_vue
 * AI 通过 Chrome DevTools evaluate_script 调用此 API
 *
 * - api Proxy：对读操作自动 safeStringify，getInspectorState 额外裁剪 Vue 内部数据；
 * - timeline：页面侧时间线采集器（常驻采集，见 vue-devtools-timeline.ts）。
 */

import { devtools, devtoolsRouter, type InspectorState } from "@vue/devtools-kit";
import { safeStringify, sanitizeState } from "./vue-devtools-sanitize";
import {
  createTimelineRecorder,
  type TimelineAppRecord,
  type TimelineHook,
  type TimelineRecorder,
  type TimelineRouterLike,
} from "./vue-devtools-timeline";

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

// ==================== 时间线采集器 ====================

/** 组件树 → nodeId 对应源码文件（时间线明细的 file 补全，与 MCP 工具同一个 inspector） */
async function getInspectorTree(): Promise<unknown> {
  return devtools.api.getInspectorTree({ inspectorId: "components", filter: "" });
}

type RouterHost = { config?: { globalProperties?: { $router?: unknown } } };

function asRouter(value: unknown): TimelineRouterLike | undefined {
  const router = value as TimelineRouterLike | null | undefined;
  return router && typeof router.afterEach === "function" ? router : undefined;
}

function resolveRouter(app: unknown): TimelineRouterLike | undefined {
  // 优先取该应用自己的 router（微前端/多应用场景），退化到 devtools-kit 探测到的那个
  const fromApp = asRouter((app as RouterHost | null)?.config?.globalProperties?.$router);
  return fromApp ?? asRouter(devtoolsRouter.value);
}

// ==================== 暴露到 window ====================

declare global {
  interface Window {
    __aipanel_vue: {
      api: typeof safeApi;
      router: typeof devtoolsRouter;
      ctx: typeof devtools.ctx;
      safeStringify: typeof safeStringify;
      timeline: TimelineRecorder;
    };
  }
}

devtools.init();

// init() 已把 devtools hook 挂到 window 上；直接订阅原始 hook 可绕开
// highPerfModeEnabled / timelineLayersState 两个门控（实测两者都会拦掉时间线事件）
const globalHook = (globalThis as { __VUE_DEVTOOLS_GLOBAL_HOOK__?: TimelineHook })
  .__VUE_DEVTOOLS_GLOBAL_HOOK__;

const timeline = createTimelineRecorder({
  hook: globalHook,
  getAppRecords: () => devtools.ctx.state.appRecords as unknown as TimelineAppRecord[],
  getInspectorTree,
  resolveRouter,
});
// 桥通常先于应用挂载执行（head-prepend），router 由 app:init 订阅；
// 若注入晚于应用挂载（手动注入等），这里补一次
timeline.attachRouters();

window.__aipanel_vue = {
  api: safeApi,
  router: devtoolsRouter,
  ctx: devtools.ctx,
  safeStringify,
  timeline,
};
