import type { ViteDevServer } from "vite";
import type { IncomingMessage } from "node:http";
import type { PageContext } from "@vite-plugin-opencode-assistant/shared";
import { MCP_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import { McpProxy } from "../core/mcp-proxy";
import { createLogger } from "@vite-plugin-opencode-assistant/shared/node";
import {
  parseListPages,
  resolveChromePageId,
  getProjectOrigins,
  isProjectPage,
} from "../core/mcp-chrome";
import { CUSTOM_TOOLS, TOOL_MAP } from "./mcp-tools";

const log = createLogger("McpEndpoint");

// Vite 中间件的 response 类型不标准，统一用此别名
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpResponse = any;

export { MCP_API_PATH };

// ========== 端点入口 ==========

export function setupMcpEndpoint(
  server: ViteDevServer,
  mcp: McpProxy,
  getPageContext: () => PageContext,
) {
  const projectOrigins = getProjectOrigins(server);

  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith(MCP_API_PATH)) return next();
    const url = new URL(req.url, `http://localhost`);

    // Token 校验
    const token =
      url.searchParams.get("token") ?? req.headers["authorization"]?.replace(/^Bearer /i, "");
    if (token !== mcp.accessToken) {
      sendMcpJson(res, 401, { error: "Unauthorized" });
      return;
    }

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET") {
      handleGetSse(req, res, mcp);
      return;
    }

    if (req.method === "DELETE") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "POST") {
      await handlePost(req, res, mcp, projectOrigins, getPageContext);
      return;
    }

    next();
  });
}

// ========== 请求处理 ==========

function handleGetSse(req: IncomingMessage, res: McpResponse, mcp: McpProxy) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Mcp-Session-Id": mcp.sessionId,
  });
  res.write(":ok\n\n");
  const keepAlive = setInterval(() => res.write(":ping\n\n"), 15000);
  req.on("close", () => clearInterval(keepAlive));
}

async function handlePost(
  req: IncomingMessage,
  res: McpResponse,
  mcp: McpProxy,
  projectOrigins: string[],
  getPageContext: () => PageContext,
) {
  try {
    const body = await readBody(req);
    if (!body) {
      res.writeHead(400);
      res.end("Empty body");
      return;
    }

    const { method, id } = tryParseRequest(body);
    log.debug("MCP request", { method, body: body.substring(0, 150) });

    switch (method) {
      case "tools/list":
        return handleToolsList(res, id, mcp.sessionId);
      case "tools/call":
        return handleToolsCall(res, id, body, mcp, projectOrigins, getPageContext);
      default:
        // initialize 等 → 直接转发
        return handleForward(res, body, mcp);
    }
  } catch (e) {
    log.debug("MCP POST error", { error: (e as Error).message });
    sendMcpJson(res, 500, {
      jsonrpc: "2.0",
      error: { code: -32603, message: (e as Error).message },
    });
  }
}

// ========== tools/list ==========

function handleToolsList(res: McpResponse, id: number | null, sessionId: string) {
  sendMcpJson(res, 200, { jsonrpc: "2.0", id, result: { tools: CUSTOM_TOOLS } }, sessionId);
}

// ========== tools/call 路由 ==========

function handleToolsCall(
  res: McpResponse,
  id: number | null,
  body: string,
  mcp: McpProxy,
  projectOrigins: string[],
  getPageContext: () => PageContext,
) {
  const params = tryParseParams(body);
  const toolName = params?.name;
  const mapped = toolName != null ? TOOL_MAP[toolName] : undefined;

  if (!mapped) {
    sendMcpError(res, id, -32601, `Tool not found: ${toolName}`, mcp.sessionId);
    return;
  }

  switch (toolName) {
    case "devtools_list_pages":
      return handleListPages(res, id, mcp, projectOrigins, getPageContext);
    default:
      return handleDevTool(res, id, mcp, mapped, params?.arguments || {}, projectOrigins);
  }
}

// ========== devtools_list_pages ==========

async function handleListPages(
  res: McpResponse,
  id: number | null,
  mcp: McpProxy,
  projectOrigins: string[],
  getPageContext: () => PageContext,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listResult: any = await mcp.callChromeDevTool("list_pages", {});
  const text: string | undefined = listResult?.result?.content?.[0]?.text;
  const allPages = text ? parseListPages(text) : [];

  const filtered = allPages.filter((p) => isProjectPage(p.url, projectOrigins));

  if (filtered.length === 0) {
    sendMcpResult(res, id, "暂无项目页面，请先在浏览器中打开本地开发页面", mcp.sessionId);
    return;
  }

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
  const activePageId = resolved.ok ? resolved.pageId : null;

  const pageList = filtered.map((p) => ({
    pageId: p.pageId,
    url: p.url,
    title: p.title,
    active: activePageId != null ? p.pageId === activePageId : false,
    selected: p.selected,
  }));

  sendMcpResult(res, id, JSON.stringify(pageList, null, 2), mcp.sessionId);
}

// ========== 其他 devtools_* 工具 ==========

async function handleDevTool(
  res: McpResponse,
  id: number | null,
  mcp: McpProxy,
  mapped: string,
  args: Record<string, unknown>,
  projectOrigins: string[],
) {
  // devtools_select_page 不需要校验选中页面
  if (mapped !== "select_page") {
    const passed = await ensureProjectPageSelected(mcp, projectOrigins);
    if (!passed) {
      sendMcpError(
        res,
        id,
        -32000,
        "Chrome DevTools 当前未选中项目页面，请先调用 devtools_list_pages 查看可用页面，再调用 devtools_select_page 选择目标页面",
        mcp.sessionId,
      );
      return;
    }
  }

  // 转发到 chrome-devtools-mcp
  const forwardBody = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: mapped, arguments: args },
  });

  const responseText = await mcp.forward(forwardBody);
  log.debug("MCP response", { mapped, response: responseText.substring(0, 100) });
  sendMcpJson(res, 200, responseText, mcp.sessionId);
}

// ========== 其他方法（initialize 等） ==========

async function handleForward(res: McpResponse, body: string, mcp: McpProxy) {
  const responseText = await mcp.forward(body);
  sendMcpJson(res, 200, responseText, mcp.sessionId);
}

// ========== Chrome 校验 ==========

/** 校验 Chrome 当前是否选中了某个项目页面 */
async function ensureProjectPageSelected(
  mcp: McpProxy,
  projectOrigins: string[],
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checkResult: any = await mcp.callChromeDevTool("list_pages", {});
  const checkText: string | undefined = checkResult?.result?.content?.[0]?.text;
  const checkPages = checkText ? parseListPages(checkText) : [];
  return checkPages.some((p) => p.selected && isProjectPage(p.url, projectOrigins));
}

// ========== 响应工具 ==========

/** 发送 MCP 成功响应 { jsonrpc, id, result: { content: [{ type: "text", text }] } } */
function sendMcpResult(res: McpResponse, id: number | null, text: string, sessionId: string) {
  sendMcpJson(
    res,
    200,
    {
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text }] },
    },
    sessionId,
  );
}

/** 发送 MCP 错误响应 { jsonrpc, id, error: { code, message } } */
function sendMcpError(
  res: McpResponse,
  id: number | null,
  code: number,
  message: string,
  sessionId: string,
) {
  sendMcpJson(
    res,
    200,
    {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    },
    sessionId,
  );
}

function sendMcpJson(
  res: McpResponse,
  statusCode: number,
  body: Record<string, unknown> | string,
  sessionId?: string,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  res.writeHead(statusCode, headers);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

// ========== 请求体解析 ==========

function readBody(req: IncomingMessage, maxSize = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > maxSize) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function tryParseRequest(body: string): { method: string; id: number | null } {
  try {
    const data = JSON.parse(body);
    return { method: data.method || "unknown", id: data.id ?? null };
  } catch {
    return { method: "unknown", id: null };
  }
}

function tryParseParams(
  body: string,
): { name: string; arguments?: Record<string, unknown> } | null {
  try {
    return JSON.parse(body).params ?? null;
  } catch {
    return null;
  }
}
