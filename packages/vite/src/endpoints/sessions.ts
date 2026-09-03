import type { ViteDevServer } from "vite";
import { SESSIONS_API_PATH } from "@aipanel/core";
import { RequestContext, createLogger } from "@aipanel/core/node";
import type { EndpointContext } from "./types";

const log = createLogger("Endpoints:Sessions");

export function setupSessionsEndpoint(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(SESSIONS_API_PATH, async (req, res) => {
    const reqCtx = new RequestContext(req.method || "GET", SESSIONS_API_PATH);

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

    try {
      if (req.method === "GET") {
        reqCtx.checkpoint("Fetching sessions");
        const url = new URL(req.url || "", `http://${req.headers.host}`);
        const activeSessionId = url.searchParams.get("current") || undefined;
        const [sessions, capabilities] = await Promise.all([
          ctx.getSessions(activeSessionId),
          ctx.getCapabilities(),
        ]);
        res.writeHead(200);
        // 会话 + Provider 能力一并返回，客户端一次往返即可完成深链自适应，避免独立能力端点引入竞态
        res.end(JSON.stringify({ sessions, capabilities }));
        reqCtx.end(200);
      } else if (req.method === "POST") {
        reqCtx.checkpoint("Creating session");
        const newSession = await ctx.createSession();
        res.writeHead(200);
        res.end(JSON.stringify(newSession));
        reqCtx.end(200);
      } else if (req.method === "DELETE") {
        const url = new URL(req.url || "", `http://${req.headers.host}`);
        const sessionId = url.searchParams.get("id");

        if (!sessionId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Session ID is required" }));
          reqCtx.end(400);
          return;
        }

        reqCtx.checkpoint(`Deleting session: ${sessionId}`);
        await ctx.deleteSession(sessionId);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        reqCtx.end(200);
      } else {
        res.writeHead(405);
        res.end(JSON.stringify({ error: "Method not allowed" }));
        reqCtx.end(405);
      }
    } catch (e) {
      log.error("Session API error", { error: e, method: req.method });
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(e) }));
      reqCtx.error(e);
    }
  });
}
