import type { ViteDevServer } from "vite";
import fs from "fs";
import { WIDGET_SCRIPT_PATH, WIDGET_STYLE_PATH } from "@vite-plugin-opencode-assistant/shared";
import { RequestContext } from "@vite-plugin-opencode-assistant/shared";
import type { EndpointContext } from "./types";

export function setupWidgetEndpoints(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(WIDGET_SCRIPT_PATH, async (_req, res) => {
    const reqCtx = new RequestContext("GET", WIDGET_SCRIPT_PATH);
    const widgetPath = ctx.resolveWidgetPath();

    if (fs.existsSync(widgetPath)) {
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Access-Control-Allow-Origin", "*");
      fs.createReadStream(widgetPath).pipe(res);
      reqCtx.end(200);
    } else {
      res.writeHead(404);
      res.end("Widget script not found");
      reqCtx.end(404);
    }
  });

  server.middlewares.use(WIDGET_STYLE_PATH, async (_req, res) => {
    const reqCtx = new RequestContext("GET", WIDGET_STYLE_PATH);
    const stylePath = ctx.resolveWidgetStylePath();

    if (fs.existsSync(stylePath)) {
      res.setHeader("Content-Type", "text/css");
      res.setHeader("Access-Control-Allow-Origin", "*");
      fs.createReadStream(stylePath).pipe(res);
      reqCtx.end(200);
    } else {
      res.writeHead(404);
      res.end("Widget style not found");
      reqCtx.end(404);
    }
  });
}
