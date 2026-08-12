/**
 * Vue DevTools API 端点
 * 接收 opencode 插件的请求，通过 MCP 代理在浏览器中执行 window.__opencode_vue
 */
import type { ViteDevServer } from "vite";
import { createLogger } from "@vite-plugin-opencode-assistant/shared/node";
import type { McpProxy } from "../core/mcp-proxy";
import type { PageContext } from "@vite-plugin-opencode-assistant/shared";
import { VUE_DEVTOOLS_ACTIONS } from "@vite-plugin-opencode-assistant/shared";
import {
  parseListPages,
  resolveChromePageId,
  getProjectOrigins,
  isProjectPage,
} from "../core/mcp-chrome";

const log = createLogger("Endpoints:VueDevtools");

export const VUE_DEVTOOLS_API_PATH = "/__opencode_vue_devtools__";

export function setupVueDevtoolsEndpoint(
  server: ViteDevServer,
  mcp: McpProxy,
  getPageContext: () => PageContext,
) {
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

      const result = await executeAction(
        action,
        args,
        mcp,
        getProjectOrigins(server),
        getPageContext,
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (e) {
      log.error("Vue DevTools API error", { error: (e as Error).message });
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: (e as Error).message }));
    }
  });
}

async function executeAction(
  action: string,
  args: Record<string, unknown> | undefined,
  mcp: McpProxy,
  projectOrigins: string[],
  getPageContext: () => PageContext,
): Promise<unknown> {
  const pageId = await resolveActivePageId(mcp, projectOrigins, getPageContext);
  if (pageId == null) {
    throw new Error("未找到活跃的项目页面，请先在浏览器中打开页面");
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
      return `async () => { return await window.__opencode_vue.api.getInspectorTree({ inspectorId: "components" }) }`;
    case VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_STATE:
      return `async () => { return await window.__opencode_vue.api.getInspectorState({ inspectorId: "components", nodeId: ${JSON.stringify(args?.nodeId)} }) }`;
    case VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_RENDER_CODE:
      return `async () => { return await window.__opencode_vue.api.getComponentRenderCode(${JSON.stringify(args?.nodeId)}) }`;
    case VUE_DEVTOOLS_ACTIONS.GET_APPS:
      return `async () => { return window.__opencode_vue.ctx.state.appRecords.map(r => ({ id: r.id, name: r.name })) }`;
    case VUE_DEVTOOLS_ACTIONS.TOGGLE_APP:
      return `async () => { await window.__opencode_vue.api.toggleApp(${JSON.stringify(args?.appId)}); return "ok" }`;
    case VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO:
      return `async () => { const r = window.__opencode_vue.router.value; return window.__opencode_vue.safeStringify({ currentRoute: r?.currentRoute?.value ?? null, routes: r?.getRoutes?.() ?? [] }) }`;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function resolveActivePageId(
  mcp: McpProxy,
  projectOrigins: string[],
  getPageContext: () => PageContext,
): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listResult: any = await mcp.callChromeDevTool("list_pages", {});
  const text: string | undefined = listResult?.result?.content?.[0]?.text;
  if (!text) return null;

  const allPages = parseListPages(text);
  const filtered = allPages.filter((p) => isProjectPage(p.url, projectOrigins));
  if (filtered.length === 0) return null;

  const pc = getPageContext();
  const chromeSelectedPageId = allPages.find((p) => p.selected)?.pageId;
  const resolved = await resolveChromePageId(
    mcp,
    pc.url,
    pc.title,
    projectOrigins,
    pc.sessionId,
    filtered,
    chromeSelectedPageId,
  );

  return resolved.ok ? resolved.pageId : null;
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
