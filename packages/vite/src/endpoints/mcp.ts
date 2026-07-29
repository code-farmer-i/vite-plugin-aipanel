import type { ViteDevServer } from "vite";
import type { IncomingMessage } from "node:http";
import type { PageContext } from "@vite-plugin-opencode-assistant/shared";
import { MCP_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import { McpProxy } from "../core/mcp-proxy";
import { createLogger } from "@vite-plugin-opencode-assistant/shared/node";
import { parseListPages, resolveChromePageId, getProjectOrigin } from "../endpoints/context";
import { CUSTOM_TOOLS, TOOL_MAP } from "./mcp-tools";

const log = createLogger("McpEndpoint");

export { MCP_API_PATH };

// ========== 端点 ==========

export function setupMcpEndpoint(
  server: ViteDevServer,
  mcp: McpProxy,
  getPageContext: () => PageContext,
) {
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith(MCP_API_PATH)) return next();

    // Token 校验
    const url = new URL(req.url, `http://localhost`);
    const token =
      url.searchParams.get("token") ?? req.headers["authorization"]?.replace(/^Bearer /i, "");
    if (token !== mcp.accessToken) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
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
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Mcp-Session-Id": mcp.sessionId,
      });
      res.write(":ok\n\n");
      const keepAlive = setInterval(() => res.write(":ping\n\n"), 15000);
      req.on("close", () => clearInterval(keepAlive));
      return;
    }

    if (req.method === "DELETE") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readBody(req as IncomingMessage);
        if (!body) {
          res.writeHead(400);
          res.end("Empty body");
          return;
        }

        const { method, id } = tryParseRequest(body);
        log.debug("MCP request", { method, body: body.substring(0, 150) });

        // tools/list → 返回自定义工具集
        if (method === "tools/list") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Mcp-Session-Id": mcp.sessionId,
          });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: CUSTOM_TOOLS } }));
          return;
        }

        // tools/call
        if (method === "tools/call") {
          const params = tryParseParams(body);
          const toolName = params?.name;
          const mapped = toolName != null ? TOOL_MAP[toolName] : undefined;

          if (!mapped) {
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Mcp-Session-Id": mcp.sessionId,
            });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32601, message: `Tool not found: ${toolName}` },
              }),
            );
            return;
          }

          // devtools_list_pages：调用 list_pages 并过滤为项目页面
          if (toolName === "devtools_list_pages") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const listResult: any = await mcp.callChromeDevTool("list_pages", {});
            const text: string | undefined = listResult?.result?.content?.[0]?.text;
            const allPages = text ? parseListPages(text) : [];

            // 按当前项目 URL 过滤
            const pc = getPageContext();
            const projectOrigin = getProjectOrigin(pc.url);
            if (!projectOrigin) {
              res.writeHead(200, {
                "Content-Type": "application/json",
                "Mcp-Session-Id": mcp.sessionId,
              });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  result: {
                    content: [
                      { type: "text", text: "暂无项目页面，请先在浏览器中打开本地开发页面" },
                    ],
                  },
                }),
              );
              return;
            }
            const filtered = allPages.filter((p) => p.url.startsWith(projectOrigin));

            // 保存 Chrome 原始选中页（可能在非项目页面上）
            const chromeSelectedPageId = allPages.find((p) => p.selected)?.pageId;

            // 复用已解析的页面列表，避免重复 list_pages 调用
            const resolved = await resolveChromePageId(
              mcp,
              pc.url,
              pc.title,
              pc.sessionId,
              filtered,
              chromeSelectedPageId,
            );
            const activePageId = resolved.ok ? resolved.pageId : null;

            res.writeHead(200, {
              "Content-Type": "application/json",
              "Mcp-Session-Id": mcp.sessionId,
            });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                result: {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(
                        filtered.map((p) => ({
                          pageId: p.pageId,
                          url: p.url,
                          title: p.title,
                          active: activePageId != null ? p.pageId === activePageId : false,
                          selected: p.selected,
                        })),
                        null,
                        2,
                      ),
                    },
                  ],
                },
              }),
            );
            return;
          }

          // 其他工具：校验 Chrome 是否选中项目页面
          if (toolName !== "devtools_select_page") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const checkResult: any = await mcp.callChromeDevTool("list_pages", {});
            const checkText: string | undefined = checkResult?.result?.content?.[0]?.text;
            const checkPages = checkText ? parseListPages(checkText) : [];
            const pc = getPageContext();
            const origin = getProjectOrigin(pc.url);
            const hasProjectSelected = origin
              ? checkPages.some((p) => p.selected && p.url.startsWith(origin))
              : true;

            if (!hasProjectSelected) {
              res.writeHead(200, {
                "Content-Type": "application/json",
                "Mcp-Session-Id": mcp.sessionId,
              });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: -32000,
                    message:
                      "Chrome DevTools 当前未选中项目页面，请先调用 devtools_list_pages 查看可用页面，再调用 devtools_select_page 选择目标页面",
                  },
                }),
              );
              return;
            }
          }

          // 其他工具：直接转发给 chrome-devtools-mcp
          const forwardBody = JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: {
              name: mapped,
              arguments: params?.arguments || {},
            },
          });

          const responseText = await mcp.forward(forwardBody);
          log.debug("MCP response", { method: toolName, response: responseText.substring(0, 100) });

          res.writeHead(200, {
            "Content-Type": "application/json",
            "Mcp-Session-Id": mcp.sessionId,
          });
          res.end(responseText);
          return;
        }

        // 其他方法（initialize 等）→ 直接转发
        const responseText = await mcp.forward(body);
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": mcp.sessionId });
        res.end(responseText);
      } catch (e) {
        log.debug("MCP POST error", { error: (e as Error).message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: (e as Error).message },
          }),
        );
      }
      return;
    }

    next();
  });
}

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
