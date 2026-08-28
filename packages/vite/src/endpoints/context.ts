import type { ViteDevServer } from "vite";
import { CONTEXT_API_PATH } from "@aipanel/core";
import type { PageContext } from "@aipanel/core";
import { RequestContext, createLogger } from "@aipanel/core/node";
import { ensureNodeId } from "@aipanel/core";
import type { EndpointContext } from "./types";

const log = createLogger("Endpoints:Context");

export function setupContextEndpoint(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(CONTEXT_API_PATH, async (req, res) => {
    const reqCtx = new RequestContext(req.method || "GET", CONTEXT_API_PATH);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      reqCtx.end(200);
      return;
    }

    if (req.method === "GET") {
      const pc = ctx.getPageContext();
      res.writeHead(200);
      res.end(JSON.stringify(pc));
      reqCtx.end(200);
      return;
    }

    if (req.method === "DELETE") {
      ctx.clearSelectedElements();
      log.debug("Selected elements cleared", { sseClients: ctx.sseClients.size });

      let sentCount = 0;
      ctx.sseClients.forEach((client) => {
        try {
          client.write(`data: ${JSON.stringify({ type: "CLEAR_ELEMENTS" })}\n\n`);
          sentCount++;
        } catch (e) {
          log.debug("Failed to send SSE message", { error: e });
        }
      });
      log.debug("SSE messages sent", {
        count: sentCount,
        totalClients: ctx.sseClients.size,
      });

      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      reqCtx.end(200);
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      req.on("error", () => {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Request error" }));
      });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const tabId = data.tabId != null ? String(data.tabId) : "default";

          const existing = ctx.getPageContext();
          const selectedElements = (data.selectedElements as PageContext["selectedElements"]) || [];
          // 为缺少 id 的元素兜底分配节点 id（保证 @节点[id] 标记与上下文注入一致）
          selectedElements.forEach((el) => {
            if (el && typeof el === "object") ensureNodeId(el);
          });
          const newCtx: PageContext = {
            url: data.url || "",
            title: data.title || "",
            sessionId: data.sessionId,
            tabId: data.tabId ?? existing.tabId,
            tabIndex: data.tabIndex ?? existing.tabIndex,
            selectedElements,
          };

          ctx.setPageContext(tabId, newCtx);

          // 来自 Side Panel 的活跃 Tab 上下文，同步更新活跃 Tab ID
          if (data.active) {
            ctx.setActiveTabId(tabId);
          }

          log.debug("Context updated", {
            tabId,
            url: newCtx.url,
            title: newCtx.title,
            sessionId: newCtx.sessionId,
            selectedElementsCount: newCtx.selectedElements?.length || 0,
          });

          if (newCtx.selectedElements && newCtx.selectedElements.length > 0) {
            log.debug("Selected elements details", {
              elements: newCtx.selectedElements.map((el) => ({
                filePath: el.filePath,
                line: el.line,
                text: el.innerText?.substring(0, 50),
              })),
            });
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
          reqCtx.end(200);
        } catch (e) {
          log.debug("Invalid JSON in request body", { error: e });
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          reqCtx.error(e);
        }
      });
      return;
    }

    res.writeHead(405);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    reqCtx.end(405);
  });
}
