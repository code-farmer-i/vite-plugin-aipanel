import type { ViteDevServer } from "vite";
import { SSE_EVENTS_PATH } from "@aipanel/core";
import { RequestContext, createLogger } from "@aipanel/core/node";
import type { EndpointContext } from "./types";

const log = createLogger("Endpoints:SSE");

export function setupSseEndpoint(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(SSE_EVENTS_PATH, async (req, res) => {
    const reqCtx = new RequestContext("GET", SSE_EVENTS_PATH);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    ctx.sseClients.add(res);
    log.debug("SSE client connected", { totalClients: ctx.sseClients.size });

    res.write(`data: ${JSON.stringify({ type: "CONNECTED" })}\n\n`);

    // 推送当前完整状态（包括服务状态和任务）
    const statusPayload: Record<string, unknown> = { type: "STATUS_SYNC" };
    if (ctx.isServiceStarted !== undefined) {
      statusPayload.isStarted = ctx.isServiceStarted;
    }
    if (ctx.currentTask) {
      statusPayload.task = ctx.currentTask.task;
      Object.keys(ctx.currentTask).forEach((key) => {
        if (key !== "task") {
          statusPayload[key] = ctx.currentTask![key as keyof typeof ctx.currentTask];
        }
      });
    }

    res.write(`data: ${JSON.stringify(statusPayload)}\n\n`);

    req.on("close", () => {
      ctx.sseClients.delete(res);
      log.debug("SSE client disconnected", {
        totalClients: ctx.sseClients.size,
      });
    });

    reqCtx.end(200);
  });
}
