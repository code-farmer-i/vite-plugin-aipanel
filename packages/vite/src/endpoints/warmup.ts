import type { ViteDevServer } from "vite";
import { createLogger, WARMUP_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import type { EndpointContext } from "./types";

const log = createLogger("Endpoints:Warmup");

export function setupWarmupEndpoint(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(WARMUP_API_PATH, async (req, res) => {
    if (req.method === "GET") {
      try {
        const models = await ctx.getAvailableModels();
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, models }));
      } catch (e) {
        log.error("Failed to get available models", { error: e });
        res.setHeader("Content-Type", "application/json");
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, models: [] }));
      }
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method not allowed");
      return;
    }

    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      let selectedModel: { providerID: string; modelID: string } | undefined;
      if (body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.providerID && parsed.modelID) {
            selectedModel = { providerID: parsed.providerID, modelID: parsed.modelID };
          }
        } catch {
          log.debug("Failed to parse request body, using default model");
        }
      }

      const result = await ctx.retryWarmupChromeMcp(selectedModel);
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
