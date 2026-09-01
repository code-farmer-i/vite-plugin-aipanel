import http from "http";
import type { ResultPromise } from "execa";
import type {
  ChatSession,
  LogFileConfig,
  ProviderConfig,
  ProviderEnvironmentInfo,
  ProviderEvent,
  ProviderStartOptions,
  ProviderStartResult,
  SessionStatus,
  WebProvider,
} from "@aipanel/core";
import { RETRY_DELAY } from "@aipanel/core";
import { createLogger } from "@aipanel/core/node";
import type {
  SessionInfo,
  OpenCodeLanguage,
  OpenCodeProviderOptions,
  OpenCodeSettings,
} from "./types";
import { DEFAULT_OPENCODE_PROVIDER_OPTIONS } from "./constants";
import { OpenCodeAPI } from "./api";
import { generateBridgeScript, type BridgeScriptOptions } from "./bridge-script";
import { prepareOpenCodeRuntime, startOpenCodeWeb } from "./opencode-web";
import { checkOpenCodeInstalled, getOpenCodeVersion, killOrphanOpenCodeProcesses } from "./system";

const log = createLogger("DefaultWebProvider");

/** DefaultWebProvider 构造配置（核心层传入的运行时参数） */
export interface DefaultWebProviderConfig {
  /** 服务主机名 */
  hostname: string;
  /** Chrome DevTools Protocol 端口 */
  chromeDevtoolsPort: number;
}

/** DefaultWebProvider 构造依赖（端口等运行时状态由编排层提供） */
export interface DefaultWebProviderDeps {
  /** 实际 Web 端口读取器 */
  getWebPort: () => number;
  /** 实际代理端口读取器 */
  getProxyPort: () => number;
}

/**
 * 默认 Web Provider
 * 组合 CLI 进程管理、REST API、桥接脚本，向核心层暴露 WebProvider 契约。
 */
export class DefaultWebProvider implements WebProvider {
  readonly id = "opencode";
  readonly displayName = "OpenCode Web";

  /** 支持会话 URL 深链；支持代码审查面板（右上角 </> 按钮，由 bridge 渲染） */
  readonly capabilities = { deepLink: true, reviewPanel: true } as const;

  /** REST 会话 API（Provider 内部使用） */
  private readonly api: OpenCodeAPI;

  private deps: DefaultWebProviderDeps;
  private process: ResultPromise | null = null;
  private bridgeOptions: BridgeScriptOptions = {};
  private readonly opts: OpenCodeProviderOptions;

  constructor(
    private config: DefaultWebProviderConfig,
    deps: DefaultWebProviderDeps,
    options?: Record<string, unknown>,
  ) {
    this.deps = deps;
    this.opts = resolveOpenCodeOptions(options);
    this.api = new OpenCodeAPI(
      config.hostname,
      deps.getWebPort,
      deps.getProxyPort,
      config.chromeDevtoolsPort,
    );
  }

  /** 代理注入到 HTML 的桥接脚本（Provider 资产） */
  get bridgeScript(): string | undefined {
    return generateBridgeScript(this.bridgeOptions);
  }

  /** 初始化桥接配置（主题/语言/设置） */
  applyConfig(config: ProviderConfig): void {
    this.bridgeOptions = {
      theme: config.theme,
      language: this.opts.language,
      settings: this.opts.settings,
    };
  }

  async checkEnvironment(): Promise<ProviderEnvironmentInfo> {
    if (!(await checkOpenCodeInstalled())) {
      return {
        ok: false,
        message: `OpenCode is not installed!

Please install OpenCode first:

  # YOLO
  curl -fsSL https://opencode.ai/install | bash

  # Package managers
  npm i -g opencode-ai@latest        # or bun/pnpm/yarn
  scoop install opencode             # Windows
  choco install opencode             # Windows
  brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
  brew install opencode              # macOS and Linux (official brew formula, updated less)
  sudo pacman -S opencode            # Arch Linux (Stable)
  paru -S opencode-bin               # Arch Linux (Latest from AUR)
  mise use -g opencode               # Any OS
  nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
        `,
      };
    }
    const version = await getOpenCodeVersion();
    return { ok: true, version: version ?? undefined };
  }

  async start(options: ProviderStartOptions): Promise<ProviderStartResult> {
    log.debug("Preparing OpenCode runtime", { cwd: options.cwd, vitePort: options.vitePort });
    const configDir = prepareOpenCodeRuntime(
      options.cwd,
      options.vitePort,
      this.opts.enableLsp,
      this.opts.enablePrettier,
    );

    log.debug("Starting OpenCode Web process", {
      port: options.port,
      hostname: options.hostname,
      configDir,
    });
    const proc = startOpenCodeWeb({
      port: options.port,
      hostname: options.hostname,
      serverUrl: "",
      cwd: options.cwd,
      configDir,
      corsOrigins: options.corsOrigins,
      contextApiUrl: options.contextApiUrl,
      logsApiUrl: options.logsApiUrl,
      logFilesJson: this.opts.logFiles ? JSON.stringify(this.opts.logFiles) : undefined,
      verbose: options.verbose,
      enableLsp: this.opts.enableLsp,
      enablePrettier: this.opts.enablePrettier,
      vueDevtoolsApiUrl: options.vueDevtoolsApiUrl,
    });
    this.process = proc;

    return { url: `http://${options.hostname}:${options.port}`, processHandle: proc };
  }

  async stop(): Promise<void> {
    if (this.process) {
      log.debug("Killing web process", { pid: this.process.pid });
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  async killOrphans(): Promise<number> {
    return killOrphanOpenCodeProcesses();
  }

  async listSessions(projectDir: string): Promise<ChatSession[]> {
    const sessions = await this.api.getSessions(projectDir);
    return sessions
      .filter((s) => {
        // 过滤内部会话（warmup）、subagent 子会话（parentID）、已归档会话
        if (s.title === "__chrome_mcp_warmup__") return false;
        if (s.parentID) return false;
        if (s.time?.archived) return false;
        return true;
      })
      .map((s) => toChatSession(s));
  }

  async createSession(projectDir: string, title?: string): Promise<ChatSession> {
    const session = await this.api.createSession(projectDir, undefined, title);
    return toChatSession(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.api.deleteSession(sessionId);
  }

  buildSessionUrl(projectDir: string, sessionId: string): string {
    return this.api.buildSessionProxyUrl(projectDir, sessionId);
  }

  subscribeEvents(handler: (e: ProviderEvent) => void): () => void {
    const port = this.deps.getWebPort();
    const url = `http://${this.config.hostname}:${port}/global/event`;
    log.debug("Subscribing to provider event stream", { url });

    let aborted = false;
    let currentReq: http.ClientRequest | null = null;
    let retryTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      currentReq?.destroy();
      currentReq = null;
    };

    const scheduleReconnect = () => {
      if (aborted) return;
      cleanup();
      retryTimer = setTimeout(connect, RETRY_DELAY);
    };

    const connect = () => {
      if (aborted) return;
      const req = http.get(url, (res) => {
        res.setEncoding("utf-8");
        let buffer = "";
        res.on("data", (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data) continue;
            try {
              const message = JSON.parse(data) as { payload?: unknown };
              const event = mapEvent(message.payload);
              if (event) handler(event);
            } catch {
              // 忽略无法解析的消息
            }
          }
        });
        res.on("end", scheduleReconnect);
        res.on("error", scheduleReconnect);
      });
      req.on("error", scheduleReconnect);
      currentReq = req;
    };

    connect();

    return () => {
      aborted = true;
      cleanup();
    };
  }
}

/**
 * 归一化：Provider 私有事件 → ProviderEvent
 * thinking 推导：assistant 消息未完成（time.completed 缺失）或出现增量分片
 */
function mapEvent(payload: unknown): ProviderEvent | null {
  if (!payload || typeof payload !== "object") return null;

  const msg = payload as {
    type?: string;
    properties?: {
      sessionID?: string;
      status?: { type?: string };
      info?: {
        id?: string;
        sessionID?: string;
        role?: string;
        title?: string;
        time?: {
          completed?: number;
          created?: number;
          updated?: number;
          archived?: number;
        };
      };
    };
  };
  const props = msg.properties;
  if (!props) return null;

  switch (msg.type) {
    case "session.updated": {
      const info = props.info;
      if (!info?.id) return null;
      return {
        type: "session.updated",
        session: {
          id: info.id,
          title: info.title ?? "",
          createdAt: info.time?.created,
          updatedAt: info.time?.updated,
          archived: info.time?.archived !== undefined,
        },
      };
    }
    case "session.status": {
      const sessionId = props.sessionID;
      if (!sessionId) return null;
      const status = (props.status?.type ?? "idle") as SessionStatus;
      return { type: "session.status", sessionId, status };
    }
    case "message.updated": {
      const info = props.info;
      if (info?.role !== "assistant" || !info.sessionID) return null;
      const thinking = typeof info.time?.completed !== "number";
      return { type: "thinking", sessionId: info.sessionID, thinking };
    }
    case "message.part.delta": {
      const sessionId = props.sessionID;
      if (!sessionId) return null;
      return { type: "thinking", sessionId, thinking: true };
    }
    default:
      return null;
  }
}

/** 归一化：Provider 私有会话 → ChatSession */
function toChatSession(s: SessionInfo): ChatSession {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.time?.created,
    updatedAt: s.time?.updated,
    archived: s.time?.archived !== undefined,
    parentId: s.parentID,
    url: s.url,
  };
}

/**
 * 从用户完整插件配置中解析 OpenCode 专属配置
 * 优先级：providerOptions（新写法）> 顶层 deprecated 字段（旧写法）> provider 默认值。
 * logFiles 为通用配置（仅顶层字段，见 core PluginOptions），直接读取。
 */
function resolveOpenCodeOptions(options?: Record<string, unknown>): OpenCodeProviderOptions {
  if (!options) return { ...DEFAULT_OPENCODE_PROVIDER_OPTIONS };

  const po = (options.providerOptions ?? {}) as Record<string, unknown>;
  return {
    ...DEFAULT_OPENCODE_PROVIDER_OPTIONS,
    language: (po.language as OpenCodeLanguage) ?? (options.language as OpenCodeLanguage),
    settings: (po.settings as OpenCodeSettings) ?? (options.settings as OpenCodeSettings),
    logFiles: options.logFiles as LogFileConfig[],
    enableLsp: (po.enableLsp as boolean) ?? (options.enableLsp as boolean),
    enablePrettier: (po.enablePrettier as boolean) ?? (options.enablePrettier as boolean),
  };
}
