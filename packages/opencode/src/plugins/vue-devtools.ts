/**
 * @fileoverview Vue DevTools 集成插件
 * @description 为 OpenCode Agent 提供 Vue DevTools 全套运行时检查工具
 */
import type { Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { setVerbose, createLogger } from "@vite-plugin-opencode-assistant/shared/node";
import { VUE_DEVTOOLS_ACTIONS } from "@vite-plugin-opencode-assistant/shared";

if (process.env.OPENCODE_VERBOSE === "1") {
  setVerbose(true);
}

const log = createLogger("OpenCodePluginVueDevtools");

/** 通用 HTTP 调用封装 */
async function callVueDevtoolsApi(
  apiUrl: string,
  action: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, args }),
  });

  const data = (await response.json()) as { success: boolean; data?: unknown; error?: string };
  if (!data.success) {
    throw new Error(data.error ?? "Unknown error");
  }
  return data.data;
}

export default {
  id: "vite-plugin-opencode-assistant/vue-devtools",
  async server(): Promise<Hooks> {
    log.debug("VueDevtoolsPlugin loading...");

    const apiUrl = process.env.OPENCODE_VUE_DEVTOOLS_API_URL;
    if (!apiUrl) {
      log.warn("OPENCODE_VUE_DEVTOOLS_API_URL is not set, vue-devtools plugin will not work");
      return {};
    }

    log.debug("Plugin initialized, API URL:", { apiUrl });

    // ============================================================
    // App 管理
    // ============================================================

    const vueDevtoolsGetApps = tool({
      description: `获取当前页面所有 Vue 应用实例列表。

**何时使用**：
- 排查微前端/多实例场景下操作的是哪个应用
- 切换活跃应用前查看有哪些可用`,
      args: {},
      async execute() {
        const result = await callVueDevtoolsApi(apiUrl, VUE_DEVTOOLS_ACTIONS.GET_APPS);
        return JSON.stringify(result);
      },
    });

    const vueDevtoolsSetActiveApp = tool({
      description: `切换当前活跃的 Vue 应用实例。后续所有 vue_devtools_* 工具都操作这个应用。`,
      args: {
        appId: tool.schema.string().describe("应用 ID（从 vue_devtools_get_apps 获取）"),
      },
      async execute(args) {
        await callVueDevtoolsApi(apiUrl, VUE_DEVTOOLS_ACTIONS.TOGGLE_APP, { appId: args.appId });
        return `已切换到应用 ${args.appId}`;
      },
    });

    // ============================================================
    // 组件树
    // ============================================================

    const vueDevtoolsGetComponentTree = tool({
      description: `获取当前活跃 Vue 应用的完整组件树。

**何时使用**：
- 了解页面组件层级结构
- 找到目标组件的 nodeId（后续查状态用）
- 排查组件未渲染问题

**返回**：组件树 [{ id, name, children, file, ... }]`,
      args: {},
      async execute() {
        const result = await callVueDevtoolsApi(apiUrl, VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_TREE);
        return JSON.stringify(result);
      },
    });

    const vueDevtoolsFindComponent = tool({
      description: `在组件树中按名称搜索组件，返回匹配组件的 nodeId 列表。

**何时使用**：
- 不知道组件的 nodeId，通过名称快速定位
- 查找页面上某个组件的所有实例

**返回**：[{ nodeId, name }] 匹配列表`,
      args: {
        name: tool.schema.string().describe("组件名称（支持部分匹配，不区分大小写）"),
      },
      async execute(args) {
        const tree = await callVueDevtoolsApi(apiUrl, VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_TREE);
        const text = JSON.stringify(tree);
        const searchName = args.name.toLowerCase();

        const results: { nodeId: string; name: string }[] = [];
        const namePattern = /"name":"([^"]+)"/g;
        const idPattern = /"id":"([^"]+)"/g;

        let nameMatch: RegExpExecArray | null;
        while ((nameMatch = namePattern.exec(text)) !== null) {
          const name = nameMatch[1];
          if (!name.toLowerCase().includes(searchName)) continue;

          // 向前搜索最近的 "id" 字段
          const beforeText = text.substring(0, nameMatch.index);
          const idMatches = [...beforeText.matchAll(idPattern)];
          if (idMatches.length > 0) {
            const nodeId = idMatches[idMatches.length - 1][1];
            if (!results.find((r) => r.nodeId === nodeId)) {
              results.push({ nodeId, name });
            }
          }
        }

        return JSON.stringify(results);
      },
    });

    // ============================================================
    // 组件状态
    // ============================================================

    const vueDevtoolsGetComponentState = tool({
      description: `获取指定组件的完整运行时状态。

**何时使用**：
- 排查 props 传值是否正确
- 查看 ref/reactive 响应式数据的当前值
- 检查 computed 计算结果
- 查看 attrs / events / inject / provide / template refs`,
      args: {
        nodeId: tool.schema
          .string()
          .describe("组件节点 ID（从 vue_devtools_get_component_tree 获取）"),
      },
      async execute(args) {
        const result = await callVueDevtoolsApi(apiUrl, VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_STATE, {
          nodeId: args.nodeId,
        });
        return result as string;
      },
    });

    const vueDevtoolsGetComponentRenderCode = tool({
      description: `获取组件的渲染函数源码。`,
      args: {
        nodeId: tool.schema.string().describe("组件节点 ID"),
      },
      async execute(args) {
        const result = await callVueDevtoolsApi(
          apiUrl,
          VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_RENDER_CODE,
          {
            nodeId: args.nodeId,
          },
        );
        return result as string;
      },
    });

    // ============================================================
    // 路由信息
    // ============================================================

    const vueDevtoolsGetCurrentRoute = tool({
      description: `获取 Vue Router 的当前路由信息。

**何时使用**：
- 排查路由跳转问题
- 查看当前路由 path/params/query/hash
- 确认路由守卫和 matched 记录`,
      args: {},
      async execute() {
        const result = await callVueDevtoolsApi(apiUrl, VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO);
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        const data = (parsed ?? {}) as { currentRoute?: unknown; routes?: unknown };
        return JSON.stringify(data.currentRoute ?? null);
      },
    });

    const vueDevtoolsGetRoutes = tool({
      description: `获取 Vue Router 的完整路由表。

**何时使用**：
- 查看所有已注册路由
- 确认路由配置是否正确
- 查看路由嵌套关系`,
      args: {},
      async execute() {
        const result = await callVueDevtoolsApi(apiUrl, VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO);
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        const data = (parsed ?? {}) as { currentRoute?: unknown; routes?: unknown };
        return JSON.stringify(data.routes ?? null);
      },
    });

    return {
      tool: {
        vue_devtools_get_apps: vueDevtoolsGetApps,
        vue_devtools_set_active_app: vueDevtoolsSetActiveApp,
        vue_devtools_get_component_tree: vueDevtoolsGetComponentTree,
        vue_devtools_find_component: vueDevtoolsFindComponent,
        vue_devtools_get_component_state: vueDevtoolsGetComponentState,
        vue_devtools_get_component_render_code: vueDevtoolsGetComponentRenderCode,
        vue_devtools_get_current_route: vueDevtoolsGetCurrentRoute,
        vue_devtools_get_routes: vueDevtoolsGetRoutes,
      },
    };
  },
};
