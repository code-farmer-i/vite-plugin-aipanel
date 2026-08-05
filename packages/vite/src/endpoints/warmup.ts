import type { ViteDevServer } from "vite";
import { createLogger } from "@vite-plugin-opencode-assistant/shared/node";
import { WARMUP_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import type { EndpointContext } from "./types";

const log = createLogger("Endpoints:Warmup");

export function setupWarmupEndpoint(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(WARMUP_API_PATH, async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method not allowed");
      return;
    }

    try {
      const result = await ctx.retryWarmupChromeMcp();
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);

      if (result.success) {
        res.end(JSON.stringify({ success: true }));
      } else {
        res.end(
          JSON.stringify({
            success: false,
            errorType: result.errorType,
            error: result.errorMessage,
          }),
        );
      }
    } catch (e) {
      log.error("Failed to retry warmup", { error: e });
      res.setHeader("Content-Type", "application/json");
      res.writeHead(500);
      res.end(
        JSON.stringify({
          success: false,
          errorType: "UNKNOWN",
          error: String(e),
        }),
      );
    }
  });
}
