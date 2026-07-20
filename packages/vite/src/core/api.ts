import http from "http";
import type { SessionInfo, ModelInfo } from "@vite-plugin-opencode-assistant/shared";
import {
  DEFAULT_RETRIES,
  RETRY_DELAY,
  ChromeMcpWarmupErrorType,
  ChromeMcpWarmupError,
  CHROME_DEVTOOLS_PORT,
  sleep,
  base64Encode,
  extractTextFromResponse,
} from "@vite-plugin-opencode-assistant/shared";
import { PerformanceTimer, createLogger } from "@vite-plugin-opencode-assistant/shared/node";
import { checkChromeDevToolsAvailable } from "@vite-plugin-opencode-assistant/shared/node";

const log = createLogger("API");

export class OpenCodeAPI {
  constructor(
    private hostname: string,
    private getPort: () => number,
    private getProxyPort: () => number,
    private warmupChromeMcpConfig: boolean = false,
    private chromeDevtoolsPort: number = CHROME_DEVTOOLS_PORT,
  ) {}

  private createHttpRequest<T>(
    options: http.RequestOptions,
    body?: string,
    timeout?: number,
  ): Promise<T> {
    const timer = new PerformanceTimer("HTTP Request", {
      operation: `${options.method || "GET"} ${options.path}`,
    });

    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            timer.end(`✓ Status: ${res.statusCode}`);
            resolve(result);
          } catch {
            timer.end("❌ JSON parse error");
            reject(new Error(`JSON parse error: ${data.substring(0, 100)}`));
          }
        });
      });
      req.on("error", (e) => {
        timer.end("❌ Request failed");
        reject(e);
      });
      if (timeout) {
        req.setTimeout(timeout, () => {
          timer.end("❌ Request timeout");
          req.destroy();
          reject(new Error(`Request timeout after ${timeout}ms`));
        });
      }
      if (body) req.write(body);
      req.end();
    });
  }

  async getSessions(projectDir: string, retries = DEFAULT_RETRIES): Promise<SessionInfo[]> {
    const timer = log.timer("getSessions", { retries, projectDir });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, { operation: "getSessions", projectDir });
        const sessions = await this.createHttpRequest<SessionInfo[]>({
          hostname: this.hostname,
          port: this.getPort(),
          path: `/session?directory=${encodeURIComponent(projectDir)}`,
        });
        const sessionsWithUrl = sessions.map((s) => ({
          ...s,
          url: s.directory
            ? `http://${this.hostname}:${this.getProxyPort()}/${base64Encode(s.directory)}/session/${s.id}`
            : "",
        }));
        timer.end(`Found ${sessions.length} sessions`);
        return sessionsWithUrl;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        log.debug(`Attempt ${i + 1} failed: ${lastError.message}`, {
          operation: "getSessions",
        });
        if (i < retries - 1) {
          log.debug(`Retrying in ${RETRY_DELAY}ms...`, {
            operation: "getSessions",
          });
          await sleep(RETRY_DELAY);
        }
      }
    }

    timer.end("❌ All retries exhausted");
    throw lastError;
  }

  async createSession(
    projectDir: string,
    retries = DEFAULT_RETRIES,
    title?: string,
  ): Promise<SessionInfo> {
    const timer = log.timer("createSession", { retries, title, projectDir });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, {
          operation: "createSession",
          title,
          projectDir,
        });
        const requestBody = title ? JSON.stringify({ title }) : undefined;
        const session = await this.createHttpRequest<SessionInfo>(
          {
            hostname: this.hostname,
            port: this.getPort(),
            path: "/session",
            method: "POST",
            headers: {
              ...(requestBody ? { "Content-Type": "application/json" } : {}),
            },
          },
          requestBody,
        );
        const sessionWithUrl = {
          ...session,
          url: `http://${this.hostname}:${this.getProxyPort()}/${base64Encode(projectDir)}/session/${session.id}`,
        };
        timer.end(`Created session: ${session.id}`);
        return sessionWithUrl;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        log.debug(`Attempt ${i + 1} failed: ${lastError.message}`, {
          operation: "createSession",
        });
        if (i < retries - 1) {
          log.debug(`Retrying in ${RETRY_DELAY}ms...`, {
            operation: "createSession",
          });
          await sleep(RETRY_DELAY);
        }
      }
    }

    timer.end("❌ All retries exhausted");
    throw lastError;
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.createHttpRequest<{
        all: Array<{
          id: string;
          models: Record<
            string,
            {
              name?: string;
              cost?: { input: number; output: number };
              release_date: string;
            }
          >;
        }>;
        connected: string[];
      }>({
        hostname: this.hostname,
        port: this.getPort(),
        path: "/provider",
        method: "GET",
      });

      const connectedProviders = new Set(response.connected);

      const allModels: ModelInfo[] = [];

      for (const provider of response.all) {
        if (!connectedProviders.has(provider.id)) {
          log.debug("Skipping not connected provider", { providerID: provider.id });
          continue;
        }

        for (const [modelID, model] of Object.entries(provider.models)) {
          allModels.push({
            providerID: provider.id,
            modelID,
            name: model.name,
            inputCost: model.cost?.input ?? 0,
            releaseDate: model.release_date,
          });
        }
      }

      allModels.sort((a, b) => a.inputCost - b.inputCost);

      log.debug("Found available models for warmup", {
        count: allModels.length,
        connectedProviders: response.connected,
      });

      return allModels;
    } catch (error) {
      log.warn("Failed to get available models", { error });
      return [];
    }
  }

  async deleteSession(sessionId: string, retries = DEFAULT_RETRIES): Promise<void> {
    const timer = log.timer("deleteSession", { sessionId, retries });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, {
          operation: "deleteSession",
          sessionId,
        });
        await this.createHttpRequest<void>({
          hostname: this.hostname,
          port: this.getPort(),
          path: `/session/${sessionId}`,
          method: "DELETE",
        });
        timer.end(`Deleted session: ${sessionId}`);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        log.debug(`Attempt ${i + 1} failed: ${lastError.message}`, {
          operation: "deleteSession",
          sessionId,
        });
        if (i < retries - 1) {
          log.debug(`Retrying in ${RETRY_DELAY}ms...`, {
            operation: "deleteSession",
            sessionId,
          });
          await sleep(RETRY_DELAY);
        }
      }
    }

    timer.end("❌ All retries exhausted");
    throw lastError;
  }

  async getToolIds(retries = DEFAULT_RETRIES): Promise<string[]> {
    const timer = log.timer("getToolIds", { retries });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, {
          operation: "getToolIds",
        });
        const toolIds = await this.createHttpRequest<string[]>({
          hostname: this.hostname,
          port: this.getPort(),
          path: "/experimental/tool/ids",
        });
        timer.end(`Found ${toolIds.length} tools`);
        return toolIds;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        log.debug(`Attempt ${i + 1} failed: ${lastError.message}`, {
          operation: "getToolIds",
        });
        if (i < retries - 1) {
          log.debug(`Retrying in ${RETRY_DELAY}ms...`, {
            operation: "getToolIds",
          });
          await sleep(RETRY_DELAY);
        }
      }
    }

    timer.end("❌ All retries exhausted");
    throw lastError;
  }

  private async executeWarmupChromeMcp(
    projectDir: string,
    operation: "warmup" | "retry",
    viteOrigin?: string,
    selectedModel?: { providerID: string; modelID: string },
  ): Promise<{ success: boolean; error?: ChromeMcpWarmupError }> {
    const timer = log.timer(`${operation}WarmupChromeMcp`, { viteOrigin, operation });
    let warmupSessionId: string | null = null;

    const chromeAvailable = await checkChromeDevToolsAvailable(this.chromeDevtoolsPort);
    if (!chromeAvailable) {
      const error = new ChromeMcpWarmupError(
        ChromeMcpWarmupErrorType.CHROME_NOT_CONNECTED,
        "Chrome DevTools Protocol is not available",
        `Chrome remote debugging is not enabled or not running on port ${this.chromeDevtoolsPort}. Please enable Chrome remote debugging first.`,
      );
      log.warn(`Chrome DevTools not available for ${operation}`, {
        port: this.chromeDevtoolsPort,
        hint: "Enable Chrome remote debugging at chrome://inspect/#remote-debugging",
      });
      timer.end(`Chrome DevTools not available for ${operation}`);
      return { success: false, error };
    }

    log.debug(`Chrome DevTools is available, proceeding with ${operation} warmup`);

    try {
      const warmupSession = await this.createSession(
        projectDir,
        DEFAULT_RETRIES,
        "__chrome_mcp_warmup__",
      );
      warmupSessionId = warmupSession.id;

      let modelToUse = selectedModel;
      if (!modelToUse) {
        const models = await this.getAvailableModels();
        if (models.length > 0) {
          modelToUse = {
            providerID: models[0].providerID,
            modelID: models[0].modelID,
          };
          log.debug(`Using cheapest model for ${operation} warmup`, {
            providerID: modelToUse.providerID,
            modelID: modelToUse.modelID,
          });
        } else {
          log.debug(`No model available for ${operation}, using default model`);
        }
      } else {
        log.debug(`Using selected model for ${operation} warmup`, {
          providerID: modelToUse.providerID,
          modelID: modelToUse.modelID,
        });
      }

      const WARMUP_TIMEOUT = 60000;

      const data = await this.createHttpRequest<unknown>(
        {
          hostname: this.hostname,
          port: this.getPort(),
          path: `/session/${warmupSessionId}/message`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        JSON.stringify({
          parts: [
            {
              type: "text",
              text: "Test if the chrome-devtools_list_pages tool is available. If available, reply with: ready. If not available, explain why.",
            },
          ],
          ...(modelToUse && {
            model: {
              providerID: modelToUse.providerID,
              modelID: modelToUse.modelID,
            },
          }),
        }),
        WARMUP_TIMEOUT,
      );

      const responseText = extractTextFromResponse(data);

      if (!responseText) {
        throw new ChromeMcpWarmupError(
          ChromeMcpWarmupErrorType.AI_RESPONSE_ERROR,
          "AI did not respond to the warmup request",
          "Empty response from AI",
        );
      }

      const lowerResponse = responseText.toLowerCase();

      if (!lowerResponse.includes("ready")) {
        throw new ChromeMcpWarmupError(
          ChromeMcpWarmupErrorType.AI_RESPONSE_ERROR,
          "AI response does not indicate success",
          `AI responded with: ${responseText.substring(0, 200)}`,
        );
      }

      timer.end(`Chrome MCP ${operation} warmed up successfully`);
      return { success: true };
    } catch (e) {
      if (e instanceof ChromeMcpWarmupError) {
        if (e.type === ChromeMcpWarmupErrorType.SESSION_ERROR) {
          timer.end("Session creation failed");
        }

        log.warn(`Chrome MCP ${operation} warmup failed: ${e.type}`, {
          message: e.message,
          details: e.details,
        });
        timer.end(`Chrome MCP ${operation} warmup failed: ${e.type}`);
        return { success: false, error: e };
      }

      const errorMessage = e instanceof Error ? e.message : String(e);

      if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
        const error = new ChromeMcpWarmupError(
          ChromeMcpWarmupErrorType.AI_TIMEOUT,
          "AI response timeout",
          "AI did not respond within 60 seconds. Please check if the OpenCode AI model is properly configured and available.",
        );
        log.warn(`Chrome MCP ${operation} warmup timeout`, {
          error: errorMessage,
        });
        timer.end(`Chrome MCP ${operation} warmup timeout`);
        return { success: false, error };
      }

      const error = new ChromeMcpWarmupError(
        ChromeMcpWarmupErrorType.UNKNOWN,
        `Unknown error during Chrome MCP ${operation} warmup`,
        errorMessage,
      );
      log.warn(`Chrome MCP ${operation} warmup failed with unknown error`, {
        error: errorMessage,
      });
      timer.end(`Chrome MCP ${operation} warmup failed`);
      return { success: false, error };
    } finally {
      if (warmupSessionId) {
        try {
          await this.deleteSession(warmupSessionId, 5);
        } catch (e) {
          log.warn("Failed to delete warmup session after retries", {
            error: e,
            warmupSessionId,
          });
        }
      }
    }
  }

  async warmupChromeMcp(projectDir: string, viteOrigin?: string): Promise<void> {
    if (!this.warmupChromeMcpConfig) return;

    const models = await this.getAvailableModels();
    const cheapestModel = models[0];

    const result = await this.executeWarmupChromeMcp(
      projectDir,
      "warmup",
      viteOrigin,
      cheapestModel
        ? { providerID: cheapestModel.providerID, modelID: cheapestModel.modelID }
        : undefined,
    );
    if (!result.success) {
      throw result.error;
    }
  }

  async retryWarmupChromeMcp(
    projectDir: string,
    viteOrigin?: string,
    selectedModel?: { providerID: string; modelID: string },
  ): Promise<{ success: boolean; error?: ChromeMcpWarmupError }> {
    return this.executeWarmupChromeMcp(projectDir, "retry", viteOrigin, selectedModel);
  }

  async getOrCreateSession(projectDir: string): Promise<string> {
    const timer = log.timer("getOrCreateSession", { projectDir });

    log.debug("Getting sessions...", { projectDir });
    const sessions = await this.getSessions(projectDir);
    log.debug(`Found ${sessions.length} sessions`, {
      sessions: sessions.map((s) => ({ id: s.id, directory: s.directory })),
    });

    const matchingSession = sessions.find((s) => s.directory === projectDir);

    if (matchingSession) {
      const url = `http://${this.hostname}:${this.getProxyPort()}/${base64Encode(projectDir)}/session/${matchingSession.id}`;
      timer.end(`Using existing session: ${matchingSession.id}`);
      return url;
    }

    log.debug("Creating new session...", { projectDir });
    const newSession = await this.createSession(projectDir);
    const url = `http://${this.hostname}:${this.getProxyPort()}/${base64Encode(projectDir)}/session/${newSession.id}`;
    timer.end(`Created new session: ${newSession.id}`);
    return url;
  }
}
