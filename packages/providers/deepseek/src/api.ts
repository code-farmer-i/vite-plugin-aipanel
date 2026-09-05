import http from "http";
import { randomUUID } from "node:crypto";
import { DEFAULT_RETRIES, RETRY_DELAY, sleep } from "@aipanel/core";
import { PerformanceTimer, createLogger } from "@aipanel/core/node";
import { DSH_API_BASE, DSH_REMOTE_MUX_PATH } from "./constants";
import type {
  ClientRequest,
  ServerResponse,
  SessionListResult,
  SessionSummary,
  WorkspaceCreateResult,
  WorkspaceListResult,
} from "./types";

const log = createLogger("DeepSeekAPI");

/**
 * dsh 会话 API 客户端。
 * dsh 使用自定义四象限 RPC envelope（{type:'client-request',rpcId,method,payload} →
 * {type:'server-response',rpcId,result:{ok,value|error}}），本节封装该协议。
 */
export class DeepSeekAPI {
  /** dsh 启动打印的 launch token（browser-session 认证），由 provider 在捕获后写入 */
  private launchToken?: string;
  /** 启动早期等待 token 就绪的源（dsh 进程 stdout 的 LaunchToken.wait），未就绪时勿立即抛错 */
  private launchTokenSource?: () => Promise<string>;
  /** browser-session 签名 Cookie（经 launch token 换取），dsh web 所有 /api 请求必须携带 */
  private authCookie?: string;
  /** 认证引导的幂等 Promise，避免并发多次换取 */
  private authPromise?: Promise<void>;

  constructor(
    private hostname: string,
    private getWebPort: () => number,
  ) {}

  /** 应用壳 URL（无 deepLink 能力，所有会话共用） */
  get shellUrl(): string {
    return `http://${this.hostname}:${this.getWebPort()}`;
  }

  /** 注入 dsh 启动时打印的 launch token（来自 deepseek-web 的 stdout 解析） */
  setLaunchToken(token: string): void {
    this.launchToken = token;
  }

  /**
   * 绑定 launch token 等待源（dsh 进程 stdout 解析的 LaunchToken.wait）。
   * 启动早期 widget 可能在 token 捕获前就发起 /api 请求，此时先等待 token 就绪而非抛错。
   */
  setLaunchTokenSource(source: () => Promise<string>): void {
    this.launchTokenSource = source;
  }

  /** 当前 browser-session Cookie（未认证时 undefined）；供代理向转发请求注入同一 Cookie */
  getAuthCookie(): string | undefined {
    return this.authCookie;
  }

  /**
   * 用 launch token 首次访问索引页换取 browser-session Cookie（dsh 0.1.2+ 的 browser-auth 门禁）。
   * 幂等：已认证时直接返回。失败时抛错（调用方按需降级，不阻塞 dsh 启动）。
   */
  async authenticate(): Promise<void> {
    if (this.authCookie) return;
    if (!this.authPromise) {
      this.authPromise = this.bootstrapAuthCookie().then(
        (cookie) => {
          this.authCookie = cookie;
          log.debug("dsh browser-session authenticated");
        },
        (err) => {
          this.authPromise = undefined;
          throw err;
        },
      );
    }
    return this.authPromise;
  }

  /**
   * GET /?token=<launchToken>，从 303 响应捕获 Set-Cookie（browser-auth 用签名 cookie 换首访权限）。
   * node:http 不自动跟随 303，因此能拿到该次响应的 Set-Cookie。
   */
  private bootstrapAuthCookie(): Promise<string> {
    if (!this.launchToken) {
      return Promise.reject(new Error("dsh API authenticate called before setLaunchToken"));
    }
    const token = this.launchToken;
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: this.hostname,
          port: this.getWebPort(),
          path: `/?token=${encodeURIComponent(token)}`,
          method: "GET",
          headers: { Accept: "text/html" },
        },
        (res) => {
          const setCookie = res.headers["set-cookie"];
          const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
          res.resume(); // 消费并丢弃响应体，避免 socket 悬挂
          if (cookies.length > 0) {
            // 只取 name=value 段，丢弃 Max-Age/Path/HttpOnly 等属性
            resolve(cookies[0].split(";")[0].trim());
            return;
          }
          reject(
            new Error(
              `dsh auth bootstrap failed (status ${res.statusCode}, no Set-Cookie); token may be invalid`,
            ),
          );
        },
      );
      req.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
      req.end();
    });
  }

  /** 确保已认证（未认证时先等待 launch token 就绪；无 token 来源才抛错） */
  private async ensureAuthenticated(): Promise<void> {
    if (this.authCookie) return;
    if (!this.launchToken) {
      // 启动早期 dsh 尚未打印 token：等待就绪（take from stdout）而非立即抛错，避免会话请求过早失败。
      if (this.launchTokenSource) {
        this.launchToken = await this.launchTokenSource();
      }
      if (!this.launchToken) {
        throw new Error("dsh API not authenticated: launch token not available");
      }
    }
    await this.authenticate();
  }

  /** 发起一次 unary RPC，返回 result.value（ok=false 时抛错） */
  private async call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    // dsh 0.1.2+ 对所有 /api 请求强制 browser-session 认证：先确保换取到签名 Cookie。
    await this.ensureAuthenticated();
    // dsh 0.1.2+ 的 Remote RPC 要求 payload 必须是形如 { args: {...} } 的单一 plain-object args 字段
    // （remoteRequest 校验仅含 args 键且为纯对象；gateway 再按 descriptor 的 wire 名逐 key 校验）。
    // 各方法 args 须按各自参数 wire 名分键：如 session/list 用 { _request }，session/create 用 { request }。
    const message: ClientRequest = {
      type: "client-request",
      rpcId: randomUUID(),
      method,
      payload: { args },
    };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authCookie) {
      headers.Cookie = this.authCookie;
    }
    const response = await this.createHttpRequest<ServerResponse>(
      {
        hostname: this.hostname,
        port: this.getWebPort(),
        path: `${DSH_API_BASE}/${method}`,
        method: "POST",
        headers,
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
   * 列出当前项目目录下的会话（可见性口径与 dsh UI 对齐）。
   * 取 workspace/follow baseline（workspace.list 在 dsh 0.1.2+ 已移除）按 path 匹配工作区，
   * 得 sessionIds 与全局 archivedSessionIds，再结合 session/list 的 cwd 过滤去重；
   * 过滤规则同 dsh-client-ui-workspace 的 sessionVisible：
   *   排除 origin=subagent 的子代理会话（UI 不单列）、排除归档；blank（未开过回合）仅当
   *   sessionId === activeSessionId（当前选中会话，对应 UI 的 New Session 占位行）时展示。
   */
  async listSessions(
    projectDir: string,
    activeSessionId?: string,
    retries = DEFAULT_RETRIES,
  ): Promise<SessionSummary[]> {
    const timer = log.timer("listSessions", { projectDir, activeSessionId, retries });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, { method: "session/list", projectDir });

        // 1) workspace/follow baseline：按 path 精确匹配目录，取该工作区 sessionIds 与全局归档集
        //（value 是 { items:[...], archivedSessionIds:[...] } 容器，不是数组）。
        const workspaces = await this.fetchWorkspaceBaseline();
        const matchedWorkspace = workspaces.items.find((w) => w.path === projectDir);
        const ownedByWorkspace = new Set(matchedWorkspace?.sessionIds ?? []);
        // dsh 归档会话仍留在 workspace.sessionIds 账户里（只有分组 UI 才隐藏），这里按全局归档集显式排除
        const archived = new Set(workspaces.archivedSessionIds);

        // 2) session/list：全量 + 按 cwd 过滤做兜底（value 同样是 {items:[...]} 容器）。
        // descriptor 的 args 参数 wire 名为 _request，故 args = { _request: { cursor? } }。
        const sessions = await this.call<SessionListResult>("session/list", { _request: {} });
        const all = sessions.items;

        // 可见性规则与 dsh 0.1.2 UI（dsh-client-ui-workspace 的 sessionVisible）对齐：
        //  - origin=subagent 子代理不单列（UI 渲染在父会话内部，不在侧边栏占行）
        //  - 全局 archivedSessionIds → 排除
        //  - blank（尚未开过回合）仅当前选中会话可见（UI 只保留一条 New Session 占位行）
        const filtered = all.filter((s) => {
          if (s.origin === "subagent") return false;
          if (s.blank && s.sessionId !== activeSessionId) return false;
          if (archived.has(s.sessionId)) return false;
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

  /** 在当前目录下创建会话（dsh 仅返回 { sessionId, agentPreset? }，非完整 SessionSummary）。
   * 与旧逻辑一致：先确保 projectDir 对应的 workspace 存在（workspace/create 幂等 get-or-create），
   * 再用 workspaceId 调 session/create，让新会话挂到该 workspace。 */
  async createSession(
    projectDir: string,
    retries = DEFAULT_RETRIES,
  ): Promise<{ sessionId: string }> {
    const timer = log.timer("createSession", { projectDir, retries });
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        log.debug(`Attempt ${i + 1}/${retries}`, {
          method: "session/create",
          projectDir,
        });
        // 保持原逻辑：workspace/create（get-or-create）→ session/create(workspaceId)。
        const { workspace } = await this.call<WorkspaceCreateResult>("workspace/create", {
          request: { path: projectDir },
        });
        const session = await this.call<{ sessionId: string }>("session/create", {
          request: { workspaceId: workspace.workspaceId },
        });
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
        log.debug(`Attempt ${i + 1}/${retries}`, { method: "workspace/archiveSession" });
        // descriptor 参数 wire 名为 request，故 args = { request: { sessionId } }。
        await this.call("workspace/archiveSession", { request: { sessionId } });
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

  /**
   * 取 workspace/follow 流的 baseline（等价旧 workspace.list 的快照：{ items, archivedSessionIds }）。
   * dsh 0.1.2+ 无 workspace.list RPC，工作区发现走 /api/remote.mux 上的 workspace/follow 流。
   * 直连 dsh web（webPort）并携带 browser-session Cookie（原生 WebSocket 支持自定义请求头），
   * 打开流读到首个 baseline 帧即关闭；启动早期 webPort 已就绪，不存在代理时序竞态。
   */
  private async fetchWorkspaceBaseline(): Promise<WorkspaceListResult> {
    // 先确保已认证（换取到 Cookie 才能过 /api 的 browser-auth 门禁）
    await this.ensureAuthenticated();
    return new Promise((resolve, reject) => {
      const cookie = this.authCookie;
      if (!cookie) {
        reject(new Error("dsh workspace baseline unavailable: not authenticated"));
        return;
      }
      const url = `ws://${this.hostname}:${this.getWebPort()}${DSH_REMOTE_MUX_PATH}`;
      // 原生 undici WebSocket 的 options 不在 DOM lib 类型内，这里做一次窄化 cast
      const ws = new WebSocket(url, {
        headers: { Cookie: cookie },
      } as unknown as string[]);
      const streamId = randomUUID();
      let settled = false;
      const finish = (err?: Error, value?: WorkspaceListResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve(value!);
      };
      const timer = setTimeout(
        () => finish(new Error("dsh workspace baseline fetch timed out")),
        15000,
      );
      ws.onopen = () => {
        try {
          // remote.mux 开流消息：{ type:'open', streamId, endpoint, payload:{ args } }；workspace/follow 无参数。
          ws.send(
            JSON.stringify({
              type: "open",
              streamId,
              endpoint: "workspace/follow",
              payload: { args: {} },
            }),
          );
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type?: string;
            streamId?: string;
            value?: { type?: string; value?: WorkspaceListResult };
            error?: { message?: string };
          };
          if (!msg || msg.streamId !== streamId) return;
          if (msg.type === "item" && msg.value?.type === "baseline" && msg.value.value) {
            finish(undefined, {
              items: msg.value.value.items ?? [],
              archivedSessionIds: msg.value.value.archivedSessionIds ?? [],
            });
          } else if (msg.type === "error") {
            finish(new Error(`dsh workspace/follow failed: ${msg.error?.message ?? "unknown"}`));
          }
        } catch {
          /* ignore unparsable frames */
        }
      };
      ws.onerror = () => finish(new Error("dsh workspace baseline WebSocket error"));
      ws.onclose = () => {
        if (!settled) finish(new Error("dsh workspace baseline WebSocket closed before baseline"));
      };
    });
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
          const status = res.statusCode ?? 0;
          // HTTP 层失败（如 401 未认证 / 5xx）优先给出可诊断信息，避免被当成 JSON 解析错误
          if (status < 200 || status >= 300) {
            timer.end(`❌ HTTP ${status}`);
            reject(
              new Error(
                `dsh HTTP ${status} on ${options.method ?? "GET"} ${options.path}: ${(data || "(empty body)").substring(0, 200)}`,
              ),
            );
            return;
          }
          try {
            const result = JSON.parse(data);
            timer.end(`✓ Status: ${status}`);
            resolve(result);
          } catch {
            timer.end("❌ JSON parse error");
            reject(
              new Error(`dsh HTTP ${status}: response is not JSON: ${data.substring(0, 200)}`),
            );
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
