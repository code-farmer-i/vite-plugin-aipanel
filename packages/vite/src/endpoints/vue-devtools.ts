/**
 * Vue DevTools API 端点
 * 接收 aipanel 插件的请求，通过 MCP 代理在浏览器中执行 window.__aipanel_vue
 */
import type { ViteDevServer } from "vite";
import { createLogger } from "@aipanel/core/node";
import type { McpProxy } from "../core/mcp-proxy";
import { VUE_DEVTOOLS_ACTIONS, VUE_DEVTOOLS_API_PATH } from "@aipanel/core";
import { getProjectOrigins, validatePageId } from "../core/mcp-chrome";

const log = createLogger("Endpoints:VueDevtools");

export { VUE_DEVTOOLS_API_PATH };

export function setupVueDevtoolsEndpoint(server: ViteDevServer, mcp: McpProxy) {
  server.middlewares.use(VUE_DEVTOOLS_API_PATH, async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      const body = await readBody(req);
      const { action, args } = JSON.parse(body) as {
        action: string;
        args?: Record<string, unknown>;
      };

      const result = await executeAction(action, args, mcp, getProjectOrigins(server));
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (e) {
      log.error("Vue DevTools API error", { error: (e as Error).message });
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: (e as Error).message }));
    }
  });
}

export async function executeAction(
  action: string,
  args: Record<string, unknown> | undefined,
  mcp: McpProxy,
  /** vue-devtools 桥只注入在项目页面，范围为自动项目页 origins */
  projectOrigins: string[],
): Promise<unknown> {
  // 从 args 中提取并校验 pageId
  const pageId = args?.pageId;
  if (typeof pageId !== "number") {
    throw new Error("缺少 pageId 参数，请先获取页面 ID");
  }

  // 验证 pageId 是否为项目页面（桥仅存在于项目页）
  const validation = await validatePageId(mcp, pageId, projectOrigins);
  if (!validation.valid) {
    log.error("pageId 无效或不在可操作范围", {
      pageId,
      allowedPageIds: validation.allowedPages.map((p) => p.pageId),
    });
    throw new Error(validation.error);
  }

  // 选中目标页面
  await mcp.callChromeDevTool("select_page", { pageId, bringToFront: false });

  // 构建 execute_script 调用
  const callExpr = buildCallExpr(action, args);

  const result = await mcp.callChromeDevTool("evaluate_script", {
    function: callExpr,
  });

  const parsed = parseEvalResult(result);
  return parsed;
}

function buildCallExpr(action: string, args?: Record<string, unknown>): string {
  switch (action) {
    case VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_TREE:
      return `async () => { return await window.__aipanel_vue.api.getInspectorTree({ inspectorId: "components", filter: ${JSON.stringify(args?.filter ?? "")} }) }`;
    case VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_STATE:
      return `async () => { return await window.__aipanel_vue.api.getInspectorState({ inspectorId: "components", nodeId: ${JSON.stringify(args?.nodeId)} }) }`;
    case VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_RENDER_CODE:
      return `async () => { return await window.__aipanel_vue.api.getComponentRenderCode(${JSON.stringify(args?.nodeId)}) }`;
    case VUE_DEVTOOLS_ACTIONS.GET_APPS:
      return `async () => { return window.__aipanel_vue.ctx.state.appRecords.map(r => ({ id: r.id, name: r.name })) }`;
    case VUE_DEVTOOLS_ACTIONS.TOGGLE_APP:
      return `async () => { await window.__aipanel_vue.api.toggleApp(${JSON.stringify(args?.appId)}); return "ok" }`;
    case VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO:
      // currentRoute / routes 必须各自 safeStringify：safeStringify 的 seen 是调用级共享的，
      // 放在一起序列化时，currentRoute.matched 与 getRoutes() 共享的同一批路由记录会被误判成循环引用
      return `async () => { const r = window.__aipanel_vue.router.value; const s = window.__aipanel_vue.safeStringify; return { currentRoute: JSON.parse(s(r?.currentRoute?.value ?? null)), routes: JSON.parse(s(r?.getRoutes?.() ?? [])) } }`;
    case VUE_DEVTOOLS_ACTIONS.GET_TIMELINE:
      return timelineExpr(`timeline.get(${JSON.stringify(withoutPageId(args))})`);
    case VUE_DEVTOOLS_ACTIONS.MARK_TIMELINE:
      return timelineExpr(`timeline.mark(${JSON.stringify(String(args?.label ?? ""))})`);
    case VUE_DEVTOOLS_ACTIONS.CLEAR_TIMELINE:
      return timelineExpr("timeline.clear()");
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * 时间线动作统一包装：页面桥可能是旧版本（dev server 的模块缓存），
 * 直接调用会在页面里抛 TypeError；这里给出模型能读懂的错误，而不是让它猜"工具是不是坏了"。
 */
function timelineExpr(call: string): string {
  return `async () => { const timeline = window.__aipanel_vue && window.__aipanel_vue.timeline; if (!timeline) return { error: "时间线采集器不可用：页面桥版本过旧，请重启 dev server 并整页刷新后再试" }; return await ${call} }`;
}

/** 时间线查询参数不需要 pageId（它已在 host 侧校验过） */
function withoutPageId(args?: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...(args ?? {}) };
  delete rest.pageId;
  return rest;
}

function parseEvalResult(result: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = result as any;
  const text: string | undefined = r?.result?.content?.[0]?.text;
  if (!text) return null;

  // Chrome DevTools MCP 可能把返回值包在 markdown 代码块中:
  // "Script ran on page and returned:\n```json\n{content}\n```"
  let jsonText = text;
  const mdMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (mdMatch) {
    jsonText = mdMatch[1];
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    return text;
  }
}

function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
