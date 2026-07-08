import type { ViteDevServer } from "vite";
import type { EndpointContext } from "./types";
import { START_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import { RequestContext } from "@vite-plugin-opencode-assistant/shared";

export function setupStartEndpoint(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(START_API_PATH, async (_req, res) => {
    const reqCtx = new RequestContext("GET", START_API_PATH);

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
