import type { ViteDevServer } from "vite";
import type { EndpointContext } from "./types";
import { setupWidgetEndpoints } from "./widget";
import { setupContextEndpoint } from "./context";
import { setupStartEndpoint } from "./start";
import { setupSseEndpoint } from "./sse";
import { setupSessionsEndpoint } from "./sessions";
import { setupWarmupEndpoint } from "./warmup";
import { setupLogsEndpoint } from "./logs";
import { setupMcpEndpoint, MCP_API_PATH } from "./mcp";
import { setupVueDevtoolsEndpoint, VUE_DEVTOOLS_API_PATH } from "./vue-devtools";
import type { McpProxy } from "../core/mcp-proxy";
import { LOGS_API_PATH } from "@vite-plugin-opencode-assistant/shared";

export * from "./types";
export { LOGS_API_PATH, MCP_API_PATH, VUE_DEVTOOLS_API_PATH };

export function setupMiddlewares(server: ViteDevServer, ctx: EndpointContext, mcp?: McpProxy) {
  setupWidgetEndpoints(server, ctx);
  setupContextEndpoint(server, ctx);
  setupStartEndpoint(server, ctx);
  setupSseEndpoint(server, ctx);
  setupSessionsEndpoint(server, ctx);
  setupWarmupEndpoint(server, ctx);
  setupLogsEndpoint(server);
  if (mcp) {
    setupMcpEndpoint(server, mcp, () => ctx.getPageContext());
    setupVueDevtoolsEndpoint(server, mcp, () => ctx.getPageContext());
  }
}
