import type { ViteDevServer } from "vite";
import { CONTEXT_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import { RequestContext, createLogger } from "@vite-plugin-opencode-assistant/shared";
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
      res.writeHead(200);
      res.end(JSON.stringify(ctx.pageContext));
      reqCtx.end(200);
      return;
    }

    if (req.method === "DELETE") {
      ctx.pageContext.selectedElements = [];
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
          ctx.pageContext = {
            url: data.url || "",
            title: data.title || "",
            // 保留已有的 tabId/tabIndex（避免页内 widget 覆盖 Side Panel 写入的值）
            tabId: data.tabId ?? ctx.pageContext.tabId,
            tabIndex: data.tabIndex ?? ctx.pageContext.tabIndex,
            selectedElements: data.selectedElements || [],
          };

          log.debug("Context updated", {
            url: ctx.pageContext.url,
            title: ctx.pageContext.title,
            selectedElementsCount: ctx.pageContext.selectedElements?.length || 0,
          });

          if (ctx.pageContext.selectedElements && ctx.pageContext.selectedElements.length > 0) {
            log.debug("Selected elements details", {
              elements: ctx.pageContext.selectedElements.map((el) => ({
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
