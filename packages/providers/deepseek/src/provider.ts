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
import type {
  DeepSeekBusyEnter,
  DeepSeekPermissionPreset,
  DeepSeekProviderOptions,
  ServerRequest,
  SessionSummary,
} from "./types";
import { DEFAULT_DEEPSEEK_PROVIDER_OPTIONS } from "./constants";
import { DSH_LOOPBACK_HOST, DSH_MUX_EVENTS_PATH, DSH_HOST_EVENTS_PATH } from "./constants";
import { DeepSeekAPI } from "./api";
import { generateBridgeScript, type BridgeScriptOptions } from "./bridge-script";
import { startDeepSeekWeb } from "./deepseek-web";
import { buildDshOverlay, writeDshOverlay } from "./profile";
import { checkDeepSeekInstalled, getDeepSeekVersion, killOrphanDeepSeekProcesses } from "./system";
import {
  DSH_CLIENT_PACKAGE,
  DSH_PLUGIN_PACKAGE,
  dshProfileDir,
  ensureDshPackage,
  resolveDevDshPackageSource,
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

  /** 初始化桥接配置（主题、诊断开关等） */
  applyConfig(config: ProviderConfig): void {
    this.bridgeOptions = {
      theme: config.theme ?? "auto",
      diagnosticsEnabled: this.opts.enableDiagnostics ?? false,
    };
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
    // 统一官方方案安装 dsh 侧插件（dsh plugin --profile web add）：
    //   - dsh-client 浏览器插件（@ 菜单 chip 高亮）
    //   - dsh-plugin 宿主插件（审查工具 / 编辑后自动诊断）
    // dev 装本地目录（改代码 → 重建 → 重启生效）；生产装 npm 包。
    // 未就绪时 overlay 停用对应行，避免 dsh 因无法解析而 fail-loud，仅失去该能力。
    const profileDir = dshProfileDir(this.opts.home);

    const devClientDir = resolveDevDshPackageSource(import.meta.url, "dsh-client", "lib/client.js");
    const clientAvailable = await ensureDshPackage(
      profileDir,
      DSH_CLIENT_PACKAGE,
      devClientDir ?? DSH_CLIENT_PACKAGE,
      this.opts.home,
    );
    if (!clientAvailable) {
      log.warn("@aipanel/dsh-client unavailable; @ menu chip highlight disabled", {
        metaUrl: import.meta.url,
      });
    }

    const devPluginDir = resolveDevDshPackageSource(import.meta.url, "dsh-plugin", "dist/index.js");
    const pluginAvailable = await ensureDshPackage(
      profileDir,
      DSH_PLUGIN_PACKAGE,
      devPluginDir ?? DSH_PLUGIN_PACKAGE,
      this.opts.home,
    );
    if (!pluginAvailable) {
      log.warn("@aipanel/dsh-plugin unavailable; run_diagnostics & auto-diagnose disabled", {
        metaUrl: import.meta.url,
      });
    }

    // 生成 cordis overlay：接入 AIPanel MCP（浏览器控制/Debug 等）+ 审查工具插件（包名引用）
    const overlay = buildDshOverlay({
      vitePort: options.vitePort,
      cwd: options.cwd,
      pluginAvailable,
      clientAvailable,
      autoDiagnose: this.opts.autoDiagnose,
      enableDiagnostics: this.opts.enableDiagnostics,
    });
    const patchPath = writeDshOverlay(options.cwd, overlay);

    // dsh 服务 schema 只接受 127.0.0.1 / 0.0.0.0，且 CLI 拒绝 0.0.0.0 —— 强制 loopback
    const proc = startDeepSeekWeb({
      port: options.port,
      hostname: DSH_LOOPBACK_HOST,
      cwd: options.cwd,
      patchPath,
      home: this.opts.home,
      verbose: options.verbose,
    });
    this.process = proc;

    // 应用 providerOptions 指定的 dsh 用户设置（agent 预设 / 权限 / 繁忙 Enter 行为）。
    // 通过 settings.update 写用户层，需 dsh API 就绪后生效；失败仅告警，不阻塞启动。
    const settings = this.buildSettingsToApply();
    if (Object.keys(settings).length > 0) {
      void this.api.applySettings(settings).catch((e) => {
        log.warn("failed to apply provider settings to dsh", {
          settings,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }

    return { url: this.api.shellUrl, processHandle: proc };
  }

  /** 把 providerOptions 配置映射为 dsh settings 命名空间 patch（仅含用户显式配置项） */
  private buildSettingsToApply(): Record<string, Record<string, unknown>> {
    const sections: Record<string, Record<string, unknown>> = {};
    if (this.opts.agentPreset !== undefined) {
      // dsh settings agent-presets.default：新建会话的默认预设
      sections["agent-presets"] = { ...sections["agent-presets"], default: this.opts.agentPreset };
    }
    if (this.opts.permissionPreset !== undefined) {
      // dsh settings permission.defaultPreset：新会话默认权限预设
      sections.permission = {
        ...sections.permission,
        defaultPreset: this.opts.permissionPreset,
      };
    }
    if (this.opts.busyEnter !== undefined) {
      // dsh settings ui-conversation.busyEnter：繁忙时 Enter 键行为
      sections["ui-conversation"] = {
        ...sections["ui-conversation"],
        busyEnter: this.opts.busyEnter,
      };
    }
    return sections;
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
    // dsh session.create 仅返回 { sessionId }，不含标题/时间；title 由 dsh 侧自动生成前先用空
    const url = this.buildSessionUrl(projectDir, "");
    const created = await this.api.createSession(projectDir);
    return {
      id: created.sessionId,
      title: title ?? "",
      updatedAt: Date.now(),
      url,
    };
  }

  // 删除走归档：dsh 无硬删除语义（workspace.archiveSession），
  // 归档后 listSessions 按 archivedSessionIds 过滤即从列表消失。
  async deleteSession(sessionId: string): Promise<void> {
    await this.api.archiveSession(sessionId);
  }

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
    // dsh 标题在 projections.values.title，不在顶层
    title: s.projections?.values?.title ?? "",
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
    agentPreset: (po.agentPreset as string) ?? (options.agentPreset as string | undefined),
    permissionPreset:
      (po.permissionPreset as DeepSeekPermissionPreset) ??
      (options.permissionPreset as DeepSeekPermissionPreset | undefined),
    busyEnter:
      (po.busyEnter as DeepSeekBusyEnter) ?? (options.busyEnter as DeepSeekBusyEnter | undefined),
    autoDiagnose: (po.autoDiagnose as boolean) ?? (options.autoDiagnose as boolean | undefined),
    enableDiagnostics:
      (po.enableDiagnostics as boolean) ?? (options.enableDiagnostics as boolean | undefined),
  };
}
