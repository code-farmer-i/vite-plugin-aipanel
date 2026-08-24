import type { ResultPromise } from "execa";
import type http from "http";
import type { PluginOptions, ServiceStartupTask, WebProvider } from "@aipanel/core";
import { DEFAULT_PROXY_PORT, SERVER_START_TIMEOUT, ChromeMcpWarmupErrorType } from "@aipanel/core";
import { createLogger, findAvailablePort } from "@aipanel/core/node";
import { findGitRoot, waitForServer } from "../utils/system";
import { startProxyServer } from "./proxy-server";
import type { McpProxy } from "./mcp-proxy";

const log = createLogger("Service");

export class AIPanelService {
  public webProcess: ResultPromise | null = null;
  public actualWebPort: number;
  public actualProxyPort: number;
  public isStarted = false;
  private startPromise: Promise<void> | null = null;
  private proxyServer: http.Server | null = null;
  public chromeMcpWarmupFailed = false;
  public chromeMcpWarmupErrorType: ChromeMcpWarmupErrorType | null = null;
  public chromeMcpWarmupErrorMessage: string | null = null;
  public currentTask: { task: ServiceStartupTask; data?: Record<string, unknown> } | null = null;
  public workspaceRoot: string | null = null;
  private mcp: McpProxy | null = null;
  private provider: WebProvider | null = null;
  private unsubscribeEvents: (() => void) | null = null;

  constructor(
    private config: Required<PluginOptions>,
    private sseClients: Set<http.ServerResponse>,
    private onPortAllocated: (port: number) => void,
    private onProxyPortAllocated: (port: number) => void,
  ) {
    this.actualWebPort = config.webPort;
    this.actualProxyPort = config.proxyPort ?? DEFAULT_PROXY_PORT;
  }

  /** 设置 Provider（由编排层动态加载后调用） */
  setProvider(provider: WebProvider): void {
    this.provider = provider;
  }

  private sendTaskUpdate(task: ServiceStartupTask, data?: Record<string, unknown>) {
    this.currentTask = { task, ...data };
    this.sseClients.forEach((client) => {
      try {
        client.write(`data: ${JSON.stringify({ type: "TASK_UPDATE", task, ...data })}\n\n`);
      } catch (e) {
        log.debug("Failed to send TASK_UPDATE event", { error: e });
      }
    });
  }

  async start(
    vitePort: number,
    corsOrigins: string[],
    contextApiUrl: string,
    logsApiUrl: string,
    viteOrigin: string,
    mcp: McpProxy,
    vueDevtoolsApiUrl?: string,
  ): Promise<void> {
    if (this.isStarted && this.webProcess) {
      log.debug("Services already started, skipping");
      return;
    }
    if (this.startPromise) {
      log.debug("Waiting for existing start promise");
      return this.startPromise;
    }

    this.mcp = mcp;

    const provider = this.provider;
    if (!provider) {
      throw new Error("Provider 未初始化，请先调用 setProvider");
    }

    this.startPromise = (async () => {
      const timer = log.timer("startServices", {
        corsOrigins,
        contextApiUrl,
        logsApiUrl,
        viteOrigin,
      });
      log.info("Starting Web UI services...");

      const orphanCount = (await provider.killOrphans?.()) ?? 0;
      if (orphanCount > 0) {
        log.debug(`Killed ${orphanCount} orphan Web UI process(es)`);
      }

      this.sendTaskUpdate("checking_provider");
      const env = await provider.checkEnvironment();
      if (!env.ok) {
        log.error(env.message ?? "Provider environment check failed");
        this.sendTaskUpdate("provider_not_installed");
        this.startPromise = null;
        timer.end("❌ Provider environment check failed");
        return;
      }
      const providerVersion = env.version;

      timer.checkpoint("Provider environment verified");

      this.sendTaskUpdate("allocating_port");
      this.actualWebPort = await findAvailablePort(this.config.webPort, this.config.hostname);
      this.onPortAllocated(this.actualWebPort);

      if (this.actualWebPort !== this.config.webPort) {
        log.info(`Port ${this.config.webPort} is in use, using ${this.actualWebPort} instead`);
      } else {
        log.debug(`Using port ${this.actualWebPort}`);
      }

      timer.checkpoint("Port allocated");

      this.workspaceRoot = findGitRoot(process.cwd());
      log.debug(`Using workspace root: ${this.workspaceRoot}`);

      this.sendTaskUpdate("preparing_runtime");
      this.sendTaskUpdate("starting_web");
      const startResult = await provider.start({
        port: this.actualWebPort,
        hostname: this.config.hostname,
        cwd: this.workspaceRoot,
        corsOrigins,
        vitePort,
        contextApiUrl,
        logsApiUrl,
        verbose: this.config.verbose,
        vueDevtoolsApiUrl,
      });
      this.webProcess = (startResult.processHandle as ResultPromise | null) ?? null;

      timer.checkpoint("Web process started");
      const webUrl = startResult.url;
      log.debug(`Waiting for Web UI to become ready at ${webUrl}...`);

      this.sendTaskUpdate("waiting_web_ready");
      try {
        await waitForServer(webUrl, SERVER_START_TIMEOUT, this.webProcess ?? undefined);

        if (this.webProcess?.exitCode !== null && this.webProcess?.exitCode !== undefined) {
          throw new Error(`Web process exited with code ${this.webProcess.exitCode}`);
        }

        log.info(
          `Web UI started at ${webUrl}${providerVersion ? ` (${provider.displayName} ${providerVersion})` : ""}`,
        );
      } catch (e) {
        log.error("Web UI failed to start", { error: e });
        this.sendTaskUpdate("web_start_timeout");
        // 清理已启动的 Web 进程，避免残留占用端口（killOrphans 只清理 PPID=1 的孤儿）
        await provider.stop();
        this.webProcess = null;
        this.startPromise = null;
        timer.end("❌ Web start timeout");
        return;
      }

      this.sendTaskUpdate("starting_proxy");
      let proxyStartPort = this.config.proxyPort ?? DEFAULT_PROXY_PORT;
      if (proxyStartPort === this.actualWebPort) {
        proxyStartPort = this.actualWebPort + 1;
        log.debug(`Proxy start port conflicts with web port, using ${proxyStartPort} instead`);
      }
      this.actualProxyPort = await findAvailablePort(proxyStartPort, this.config.hostname);
      this.onProxyPortAllocated(this.actualProxyPort);

      if (this.actualProxyPort !== (this.config.proxyPort ?? DEFAULT_PROXY_PORT)) {
        log.info(
          `Proxy port ${this.config.proxyPort ?? DEFAULT_PROXY_PORT} is in use, using ${this.actualProxyPort} instead`,
        );
      } else {
        log.debug(`Using proxy port ${this.actualProxyPort}`);
      }

      try {
        const result = await startProxyServer(webUrl, this.actualProxyPort, {
          bridgeScript: provider.bridgeScript,
          hostname: this.config.hostname,
        });
        this.proxyServer = result.server;
        if (result.actualPort !== this.actualProxyPort) {
          log.info(
            `Proxy port ${this.actualProxyPort} was taken, using ${result.actualPort} instead`,
          );
          this.actualProxyPort = result.actualPort;
          this.onProxyPortAllocated(this.actualProxyPort);
        }
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === "EADDRINUSE") {
          log.debug(`Proxy port ${this.actualProxyPort} became unavailable, trying next port...`);
          const nextPort = await findAvailablePort(this.actualProxyPort + 1, this.config.hostname);
          const result = await startProxyServer(webUrl, nextPort, {
            bridgeScript: provider.bridgeScript,
            hostname: this.config.hostname,
          });
          this.proxyServer = result.server;
          this.actualProxyPort = result.actualPort;
          this.onProxyPortAllocated(this.actualProxyPort);
          log.debug(`Proxy server started on fallback port ${this.actualProxyPort}`);
        } else {
          log.error("Proxy server failed to start", { error: nodeErr });
          // 清理已启动的 Web 进程，并重置 startPromise 以便后续可重试
          await provider.stop();
          this.webProcess = null;
          this.startPromise = null;
          return;
        }
      }
      timer.checkpoint("Proxy server started");

      this.sendTaskUpdate("warming_up_chrome");
      let warmupFailed = false;
      try {
        const result = await mcp.verify();
        if (!result.ok) throw new Error(result.error ?? "Chrome MCP not available");
        timer.checkpoint("Chrome MCP warmup complete");
      } catch (e) {
        log.warn("Chrome MCP warmup failed", { error: e });
        this.chromeMcpWarmupFailed = true;
        warmupFailed = true;
        this.chromeMcpWarmupErrorType = ChromeMcpWarmupErrorType.UNKNOWN;
        this.chromeMcpWarmupErrorMessage = e instanceof Error ? e.message : String(e);
      }

      this.sendTaskUpdate("creating_session");

      this.isStarted = true;

      // 订阅 Provider 事件流，归一化后广播给所有 SSE 客户端（SESSION_EVENT）
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = provider.subscribeEvents((event) => {
        this.sseClients.forEach((client) => {
          try {
            client.write(`data: ${JSON.stringify({ type: "SESSION_EVENT", event })}\n\n`);
          } catch (e) {
            log.debug("Failed to send SESSION_EVENT", { error: e });
          }
        });
      });

      if (warmupFailed) {
        this.sendTaskUpdate("chrome_mcp_failed", {
          errorType: this.chromeMcpWarmupErrorType,
          errorMessage: this.chromeMcpWarmupErrorMessage,
        });
      } else {
        this.sendTaskUpdate("ready");
      }
      timer.end("✓ Services started successfully");
    })();

    return this.startPromise;
  }

  async retryWarmupChromeMcp(): Promise<{
    success: boolean;
    errorType?: string;
    errorMessage?: string;
  }> {
    if (!this.mcp) {
      return { success: false, errorType: "UNKNOWN", errorMessage: "MCP not initialized" };
    }

    try {
      const result = await this.mcp.verify();
      if (result.ok) {
        this.chromeMcpWarmupFailed = false;
        this.sendTaskUpdate("ready");
        return { success: true };
      }
      return {
        success: false,
        errorType: "CHROME_NOT_CONNECTED",
        errorMessage: result.error ?? "Chrome MCP not available",
      };
    } catch (e) {
      return {
        success: false,
        errorType: "UNKNOWN",
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async stop(): Promise<void> {
    const timer = log.timer("stopServices");
    log.info("Stopping Web UI services...");

    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;

    if (this.proxyServer) {
      log.debug("Closing proxy server");
      this.proxyServer.close();
      this.proxyServer = null;
    }

    await this.provider?.stop();
    this.webProcess = null;

    this.isStarted = false;
    this.startPromise = null;
    timer.end("✓ Services stopped");
  }
}
