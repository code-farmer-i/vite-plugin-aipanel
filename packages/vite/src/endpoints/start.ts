import type { ViteDevServer } from "vite";
import type { EndpointContext } from "./types";
import { START_API_PATH } from "@aipanel/core";
import { RequestContext } from "@aipanel/core/node";

export function setupStartEndpoint(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(START_API_PATH, async (_req, res) => {
    // 该端点被扩展背景脚本每 2s 轮询一次，属于心跳请求，静默以避免刷屏
    const reqCtx = new RequestContext("GET", START_API_PATH, { quiet: true });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      proxyPort: ctx.actualProxyPort,
      webPort: ctx.actualWebPort,
      projectRoot: server.config.root,
      serviceInstanceId: ctx.serviceInstanceId,
    }));
    reqCtx.end(200);
  });
}
