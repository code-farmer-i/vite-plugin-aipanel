import http from "http";
import type { SessionInfo } from "./types";
import {
  DEFAULT_RETRIES,
  RETRY_DELAY,
  CHROME_DEVTOOLS_PORT,
  sleep,
  base64Encode,
} from "@aipanel/core";
import { PerformanceTimer, createLogger } from "@aipanel/core/node";

const log = createLogger("API");

export class OpenCodeAPI {
  constructor(
    private hostname: string,
    private getPort: () => number,
    private getProxyPort: () => number,
    private chromeDevtoolsPort: number = CHROME_DEVTOOLS_PORT,
  ) {}

  /** 构建代理 iframe URL（旧版格式：/{base64(projectDir)}/session/{id}） */
  buildSessionProxyUrl(projectDir: string, sessionId: string): string {
    return `http://${this.hostname}:${this.getProxyPort()}/${base64Encode(projectDir)}/session/${sessionId}`;
  }

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
          url: s.directory && s.id ? this.buildSessionProxyUrl(s.directory, s.id) : "",
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
          url: this.buildSessionProxyUrl(projectDir, session.id),
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

  async getOrCreateSession(projectDir: string): Promise<string> {
    const timer = log.timer("getOrCreateSession", { projectDir });

    log.debug("Getting sessions...", { projectDir });
    const sessions = await this.getSessions(projectDir);
    log.debug(`Found ${sessions.length} sessions`, {
      sessions: sessions.map((s) => ({ id: s.id, directory: s.directory })),
    });

    const matchingSession = sessions.find((s) => s.directory === projectDir);

    if (matchingSession) {
      const url = this.buildSessionProxyUrl(projectDir, matchingSession.id);
      timer.end(`Using existing session: ${matchingSession.id}`);
      return url;
    }

    log.debug("Creating new session...", { projectDir });
    const newSession = await this.createSession(projectDir);
    const url = this.buildSessionProxyUrl(projectDir, newSession.id);
    timer.end(`Created new session: ${newSession.id}`);
    return url;
  }
}
