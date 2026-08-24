import { fileURLToPath } from "node:url";
import type { ResultPromise } from "execa";
import type {
  ChatSession,
  ProviderConfig,
  ProviderEnvironmentInfo,
  ProviderEvent,
  ProviderStartOptions,
  ProviderStartResult,
  WebProvider,
} from "@aipanel/core";
import { createLogger } from "@aipanel/core/node";
import type { DeepSeekProviderOptions, ServerRequest, SessionSummary } from "./types";
import { DEFAULT_DEEPSEEK_PROVIDER_OPTIONS } from "./constants";
import { DSH_LOOPBACK_HOST, DSH_MUX_EVENTS_PATH, DSH_HOST_EVENTS_PATH } from "./constants";
import { DeepSeekAPI } from "./api";
import { generateBridgeScript, type BridgeScriptOptions } from "./bridge-script";
import { startDeepSeekWeb } from "./deepseek-web";
import { buildDshOverlay, writeDshOverlay } from "./profile";
import { checkDeepSeekInstalled, getDeepSeekVersion, killOrphanDeepSeekProcesses } from "./system";
import {
  dshProfileDir,
  ensureDshClient,
  resolveDevDshClientSource,
  DSH_CLIENT_PACKAGE,
} from "./dsh-install";

const log = createLogger("DeepSeekWebProvider");

/** DeepSeekWebProvider 构造配置（核心层传入的运行时参数） */
export interface DeepSeekWebProviderConfig {
  /** 服务主机名 */
  hostname: string;
}

/** DeepSeekWebProvider 构造依赖（端口等运行时状态由编排层提供） */
export interface DeepSeekWebProviderDeps {
  /** 实际 Web 端口读取器 */
  getWebPort: () => number;
  /** 实际代理端口读取器 */
  getProxyPort: () => number;
}

/**
 * DeepSeek Harness Web Provider
 * 组合 CLI 进程管理、RPC 会话 API、桥接脚本，向核心层暴露 WebProvider 契约。
 */
export class DeepSeekWebProvider implements WebProvider {
  readonly id = "deepseek";
  readonly displayName = "DeepSeek Harness";

  /** SPA 型无 URL 深链：iframe 保持应用壳，切会话通过 FOCUS_SESSION 消息完成 */
  readonly capabilities = { deepLink: false } as const;

  private readonly api: DeepSeekAPI;
  private deps: DeepSeekWebProviderDeps;
  private process: ResultPromise | null = null;
  private bridgeOptions: BridgeScriptOptions = {};
  private readonly opts: DeepSeekProviderOptions;

  constructor(
    config: DeepSeekWebProviderConfig,
    deps: DeepSeekWebProviderDeps,
    options?: Record<string, unknown>,
  ) {
    this.deps = deps;
    this.opts = resolveDeepSeekOptions(options);
    this.api = new DeepSeekAPI(DSH_LOOPBACK_HOST, deps.getWebPort);
  }

  /** 代理注入到 HTML 的桥接脚本（Provider 资产） */
  get bridgeScript(): string | undefined {
    return generateBridgeScript(this.bridgeOptions);
  }

  /** 初始化桥接配置（主题等） */
  applyConfig(config: ProviderConfig): void {
    this.bridgeOptions = { theme: config.theme ?? "auto" };
  }

  async checkEnvironment(): Promise<ProviderEnvironmentInfo> {
    if (!(await checkDeepSeekInstalled())) {
      return {
        ok: false,
        message: `DeepSeek Harness (dsh) is not installed!

Please install dsh first:

  npm install -g @deepseek-ai/dsh

or run without installing:

  npx @deepseek-ai/dsh web
        `,
      };
    }
    const version = await getDeepSeekVersion();
    return { ok: true, version: version ?? undefined };
  }

  async start(options: ProviderStartOptions): Promise<ProviderStartResult> {
    log.debug("Starting dsh web process", {
      port: options.port,
      hostname: DSH_LOOPBACK_HOST,
      cwd: options.cwd,
      vitePort: options.vitePort,
    });
    // 统一官方方案安装 dsh-client 浏览器插件：dsh plugin --profile web add <target>。
    // dev 装本地目录（改代码 → 重建 → 重启生效）；生产装 npm 包 @aipanel/dsh-client。
    // 未就绪时 overlay 不注入/停用该行，避免 dsh 因无法解析而 fail-loud，仅失去 chip 高亮。
    const devClientDir = resolveDevDshClientSource(import.meta.url);
    const clientAvailable = await ensureDshClient(
      dshProfileDir(),
      devClientDir ?? DSH_CLIENT_PACKAGE,
    );
    if (!clientAvailable) {
      log.warn("@aipanel/dsh-client unavailable; @ menu chip highlight disabled", {
        metaUrl: import.meta.url,
      });
    }
    // 生成 cordis overlay：接入 AIPanel MCP（浏览器控制/Debug 等）+ 审查工具/元素选择插件
    const overlay = buildDshOverlay({
      vitePort: options.vitePort,
      cwd: options.cwd,
      pluginDistPath: this.resolvePluginDist(),
      clientAvailable,
    });
    const patchPath = writeDshOverlay(options.cwd, overlay);

    // dsh 服务 schema 只接受 127.0.0.1 / 0.0.0.0，且 CLI 拒绝 0.0.0.0 —— 强制 loopback
    const proc = startDeepSeekWeb({
      port: options.port,
      hostname: DSH_LOOPBACK_HOST,
      cwd: options.cwd,
      patchPath,
      verbose: options.verbose,
    });
    this.process = proc;

    return { url: this.api.shellUrl, processHandle: proc };
  }

  /** 解析 aipanel dsh-plugin 的构建产物路径（存在才在 overlay 里注入插件行）。
   * 注意用 fileURLToPath：URL.pathname 是 percent-encoded，中文路径下 existsSync 会误判不存在。 */
  private resolvePluginDist(): string | undefined {
    const fromHere = new URL("../dsh-plugin/dist/index.js", import.meta.url);
    return fileURLToPath(fromHere);
  }

  async stop(): Promise<void> {
    if (this.process) {
      log.debug("Killing dsh web process", { pid: this.process.pid });
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  async killOrphans(): Promise<number> {
    return killOrphanDeepSeekProcesses();
  }

  async listSessions(projectDir: string): Promise<ChatSession[]> {
    const sessions = await this.api.listSessions(projectDir);
    // 无 deepLink：所有会话共用应用壳 URL（走代理注入 bridge）
    const url = this.buildSessionUrl(projectDir, "");
    return sessions.map((s) => toChatSession(s, url));
  }

  async createSession(projectDir: string, title?: string): Promise<ChatSession> {
    // dsh session.create 不支持标题，忽略 title
    void title;
    const url = this.buildSessionUrl(projectDir, "");
    return toChatSession(await this.api.createSession(projectDir), url);
  }

  // 无 deleteSession：dsh 只支持归档（workspace.archiveSession），无硬删除语义。
  // core 检测到本接口未实现时自动隐藏删除入口。

  buildSessionUrl(projectDir: string, sessionId: string): string {
    void projectDir;
    void sessionId;
    // 无 deepLink 能力：所有会话共用应用壳 URL。必须走代理（proxyPort）而非直连 dsh，
    // 否则 bridge 脚本无法注入（主题同步 / FOCUS_SESSION 均依赖它）；切换会话靠 FOCUS_SESSION 消息
    return `http://${DSH_LOOPBACK_HOST}:${this.deps.getProxyPort()}/`;
  }

  subscribeEvents(handler: (e: ProviderEvent) => void): () => void {
    const port = this.deps.getWebPort();
    // dsh 事件流是下行 WebSocket（普通 http.get 会被 426 拒绝）：
    // mux 提供 session/event（推导 thinking），host 提供 host/session-status（运行态开关）
    const base = `ws://${DSH_LOOPBACK_HOST}:${port}`;
    const endpoints = [DSH_MUX_EVENTS_PATH, DSH_HOST_EVENTS_PATH];
    log.debug("Subscribing to dsh event streams (WebSocket)", {
      endpoints: endpoints.map((p) => base + p),
    });

    let aborted = false;
    const sockets = new Set<WebSocket>();
    const retryTimers = new Set<NodeJS.Timeout>();

    const cleanupAll = () => {
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      sockets.clear();
    };

    const connect = (path: string, attempt = 0) => {
      if (aborted) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(base + path);
      } catch (e) {
        log.warn("dsh event WebSocket create failed", { path, error: String(e) });
        scheduleReconnect(path, attempt + 1);
        return;
      }
      sockets.add(socket);

      // dsh 事件流是 downlink-only：只接收，绝不 send（发送会被 1008 关闭）
      socket.onmessage = (ev) => {
        try {
          const frame = JSON.parse(String(ev.data)) as Partial<ServerRequest>;
          const event = mapEvent(frame);
          if (event) handler(event);
        } catch {
          // 忽略无法解析的消息
        }
      };

      socket.onclose = () => {
        sockets.delete(socket);
        scheduleReconnect(path, attempt + 1);
      };

      socket.onerror = () => {
        // error 后通常紧跟 close，由 onclose 统一重连；主动关闭避免悬挂
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      };
    };

    const scheduleReconnect = (path: string, attempt: number) => {
      if (aborted) return;
      // 指数退避：250ms → 500ms → 1s → 2s → 5s（封顶），避免重连风暴
      const delays = [250, 500, 1000, 2000, 5000];
      const after = delays[Math.min(attempt, delays.length - 1)];
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        connect(path);
      }, after);
      retryTimers.add(timer);
    };

    endpoints.forEach((p) => connect(p));

    return () => {
      aborted = true;
      cleanupAll();
    };
  }
}

/**
 * 归一化：dsh 事件帧（ServerRequest）→ ProviderEvent
 * - host/session-status.running → session.status
 * - session/event 的会话日志事件 → 推导 thinking / streaming
 */
function mapEvent(frame: Partial<ServerRequest>): ProviderEvent | null {
  if (!frame || typeof frame.method !== "string" || !frame.payload) return null;
  const payload = frame.payload;
  const sessionId = (payload.sessionId as string | undefined) ?? "";

  switch (frame.method) {
    case "host/session-status": {
      if (!sessionId) return null;
      const running = payload.running === true;
      return { type: "session.status", sessionId, status: running ? "running" : "idle" };
    }
    case "session/event": {
      const event = payload.event as { type?: string } | undefined;
      const type = event?.type ?? "";
      if (!sessionId || !type) return null;
      switch (type) {
        case "assistant/message":
        case "turn/end":
          return { type: "thinking", sessionId, thinking: false };
        case "assistant/chunk":
        case "thinking/delta":
        case "turn/start":
        case "step/start":
          return { type: "thinking", sessionId, thinking: true };
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/** 归一化：dsh 会话摘要 → ChatSession（无 deepLink，url 为共用应用壳地址） */
function toChatSession(s: SessionSummary, url?: string): ChatSession {
  return {
    id: s.sessionId,
    title: "",
    updatedAt: s.updatedAt,
    parentId: s.parentSessionId,
    url,
  };
}

/**
 * 从用户完整插件配置中解析 DeepSeek 专属配置
 * 优先级：providerOptions（新写法）> 顶层字段（旧写法）> provider 默认值。
 */
function resolveDeepSeekOptions(options?: Record<string, unknown>): DeepSeekProviderOptions {
  if (!options) return { ...DEFAULT_DEEPSEEK_PROVIDER_OPTIONS };
  const po = (options.providerOptions ?? {}) as Record<string, unknown>;
  return {
    ...DEFAULT_DEEPSEEK_PROVIDER_OPTIONS,
    home: (po.home as string) ?? (options.home as string | undefined),
  };
}
