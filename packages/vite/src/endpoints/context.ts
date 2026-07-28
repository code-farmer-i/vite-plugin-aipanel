import type { ViteDevServer } from "vite";
import { CONTEXT_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import type { PageContext } from "@vite-plugin-opencode-assistant/shared";
import { RequestContext, createLogger } from "@vite-plugin-opencode-assistant/shared/node";
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
      log.debug(`[Context] GET → url=${pc.url} title=${pc.title} tabId=${pc.tabId}`);
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
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const tabId = data.tabId != null ? String(data.tabId) : "default";

          const existing = ctx.getPageContext();
          const newCtx: PageContext = {
            url: data.url || "",
            title: data.title || "",
            tabId: data.tabId ?? existing.tabId,
            tabIndex: data.tabIndex ?? existing.tabIndex,
            selectedElements: data.selectedElements || [],
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
