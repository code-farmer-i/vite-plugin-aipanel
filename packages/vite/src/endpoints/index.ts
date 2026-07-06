import type { ViteDevServer } from "vite";
import type { EndpointContext } from "./types";
import { setupWidgetEndpoints } from "./widget";
import { setupContextEndpoint } from "./context";
import { setupStartEndpoint } from "./start";
import { setupSseEndpoint } from "./sse";
import { setupSessionsEndpoint } from "./sessions";
import { setupWarmupEndpoint } from "./warmup";
import { setupLogsEndpoint, LOGS_API_PATH } from "./logs";

export * from "./types";
export { LOGS_API_PATH };

export function setupMiddlewares(server: ViteDevServer, ctx: EndpointContext) {
  setupWidgetEndpoints(server, ctx);
  setupContextEndpoint(server, ctx);
  setupStartEndpoint(server, ctx);
  setupSseEndpoint(server, ctx);
  setupSessionsEndpoint(server, ctx);
  setupWarmupEndpoint(server, ctx);
  setupLogsEndpoint(server);
}
