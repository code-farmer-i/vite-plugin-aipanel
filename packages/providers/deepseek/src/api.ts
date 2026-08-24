import http from "http";
import { randomUUID } from "node:crypto";
import { DEFAULT_RETRIES, RETRY_DELAY, sleep } from "@aipanel/core";
import { PerformanceTimer, createLogger } from "@aipanel/core/node";
import { DSH_API_BASE } from "./constants";
import type {
  ClientRequest,
  ServerResponse,
  SessionListResult,
  SessionSummary,
  WorkspaceListResult,
} from "./types";

const log = createLogger("DeepSeekAPI");

/**
 * dsh 会话 API 客户端。
 * dsh 使用自定义四象限 RPC envelope（{type:'client-request',rpcId,method,payload} →
 * {type:'server-response',rpcId,result:{ok,value|error}}），本节封装该协议。
 */
export class DeepSeekAPI {
  constructor(
    private hostname: string,
    private getWebPort: () => number,
  ) {}

  /** 应用壳 URL（无 deepLink 能力，所有会话共用） */
  get shellUrl(): string {
    return `http://${this.hostname}:${this.getWebPort()}`;
  }

  /** 发起一次 unary RPC，返回 result.value（ok=false 时抛错） */
  private async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const message: ClientRequest = {
      type: "client-request",
      rpcId: randomUUID(),
      method,
      payload,
    };
    const response = await this.createHttpRequest<ServerResponse>(
      {
        hostname: this.hostname,
        port: this.getWebPort(),
        path: `${DSH_API_BASE}/${method}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      JSON.stringify(message),
    );
    if (response?.result?.ok !== true) {
      const err =
        response?.result && "error" in response.result ? response.result.error : undefined;
      throw new Error(
        `dsh RPC ${method} failed: ${err?.message ?? JSON.stringify(response?.result ?? response)}`,
      );
    }
    return response.result.value as T;
  }

  /**
   * 列出当前项目目录下的会话。
   * dsh 的 session.list 不提供按目录过滤，故结合 workspace.list（path→sessionIds）
   * 与各会话的 cwd 字段，在本端合并去重出属于 projectDir 的会话集。
   */
  async listSessions(projectDir: string, retries = DEFAULT_RETRIES): Promise<SessionSummary[]> {
    const timer = log.timer("listSessions", { projectDir, retries });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, { method: "session.list", projectDir });

        // 1) workspace.list：按 path 精确匹配目录（value 是 {items:[...], archivedSessionIds:[...]} 容器，不是数组）
        const workspaces = await this.call<WorkspaceListResult>("workspace.list");
        const matchedWorkspace = workspaces.items.find((w) => w.path === projectDir);
        const ownedByWorkspace = new Set(matchedWorkspace?.sessionIds ?? []);

        // 2) session.list：全量 + 按 cwd 过滤做兜底（value 同样是 {items:[...]} 容器）
        const sessions = await this.call<SessionListResult>("session.list");
        const all = sessions.items;

        const filtered = all.filter((s) => {
          if (s.blank) return false; // 尚未开过 turn 的冷会话，列表通常隐藏
          if (ownedByWorkspace.has(s.sessionId)) return true;
          if (s.cwd && s.cwd === projectDir) return true;
          return false;
        });

        const result = filtered.sort((a, b) => b.updatedAt - a.updatedAt);
        timer.end(`Found ${result.length} sessions`);
        return result;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        log.debug(`Attempt ${i + 1} failed: ${lastError.message}`, { method: "listSessions" });
        if (i < retries - 1) {
          await sleep(RETRY_DELAY);
        }
      }
    }

    timer.end("❌ All retries exhausted");
    throw lastError;
  }

  /** 在当前目录下创建会话 */
  async createSession(projectDir: string, retries = DEFAULT_RETRIES): Promise<SessionSummary> {
    const timer = log.timer("createSession", { projectDir, retries });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, {
          method: "session.create",
          projectDir,
        });
        const session = await this.call<SessionSummary>("session.create", { cwd: projectDir });
        timer.end(`Created session: ${session.sessionId}`);
        return session;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        log.debug(`Attempt ${i + 1} failed: ${lastError.message}`, { method: "createSession" });
        if (i < retries - 1) {
          await sleep(RETRY_DELAY);
        }
      }
    }

    timer.end("❌ All retries exhausted");
    throw lastError;
  }

  /** 归档会话（dsh 无硬删除，仅归档；幂等） */
  async archiveSession(sessionId: string, retries = DEFAULT_RETRIES): Promise<void> {
    const timer = log.timer("archiveSession", { sessionId, retries });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, { method: "workspace.archiveSession" });
        await this.call("workspace.archiveSession", { sessionId });
        timer.end(`Archived session: ${sessionId}`);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        log.debug(`Attempt ${i + 1} failed: ${lastError.message}`, {
          method: "archiveSession",
        });
        if (i < retries - 1) {
          await sleep(RETRY_DELAY);
        }
      }
    }

    timer.end("❌ All retries exhausted");
    throw lastError;
  }

  private createHttpRequest<T>(options: http.RequestOptions, body?: string): Promise<T> {
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
      if (body) req.write(body);
      req.end();
    });
  }
}
