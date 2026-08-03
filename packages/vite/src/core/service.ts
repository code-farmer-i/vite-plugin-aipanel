import type { ResultPromise } from "execa";
import type http from "http";
import type { ModelInfo } from "@vite-plugin-opencode-assistant/shared";
import { prepareOpenCodeRuntime, startOpenCodeWeb } from "./opencode-web";
import type { OpenCodeOptions, ServiceStartupTask } from "@vite-plugin-opencode-assistant/shared";
import {
  DEFAULT_PROXY_PORT,
  SERVER_START_TIMEOUT,
  ChromeMcpWarmupError,
  ChromeMcpWarmupErrorType,
} from "@vite-plugin-opencode-assistant/shared";
import { createLogger, findAvailablePort } from "@vite-plugin-opencode-assistant/shared/node";
import {
  checkOpenCodeInstalled,
  findGitRoot,
  getOpenCodeVersion,
  killOrphanOpenCodeProcesses,
  waitForServer,
} from "../utils/system";
import type { OpenCodeAPI } from "./api";
import { startProxyServer } from "./proxy-server";
import type { McpProxy } from "./mcp-proxy";

const log = createLogger("Service");

export class OpenCodeService {
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

  constructor(
    private config: Required<OpenCodeOptions>,
    private api: OpenCodeAPI,
    private sseClients: Set<http.ServerResponse>,
    private onPortAllocated: (port: number) => void,
    private onProxyPortAllocated: (port: number) => void,
  ) {
    this.actualWebPort = config.webPort;
    this.actualProxyPort = config.proxyPort ?? DEFAULT_PROXY_PORT;
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
    mcpToken: string,
    vitePort: number,
    corsOrigins: string[],
    contextApiUrl: string,
    logsApiUrl: string,
    viteOrigin: string,
    mcp: McpProxy,
  ): Promise<void> {
    if (this.isStarted && this.webProcess) {
      log.debug("Services already started, skipping");
      return;
    }
    if (this.startPromise) {
      log.debug("Waiting for existing start promise");
      return this.startPromise;
    }

    this.startPromise = (async () => {
      const timer = log.timer("startServices", {
        corsOrigins,
        contextApiUrl,
        logsApiUrl,
        viteOrigin,
      });
      log.info("Starting OpenCode services...");

      const orphanCount = await killOrphanOpenCodeProcesses();
      if (orphanCount > 0) {
        log.debug(`Killed ${orphanCount} orphan OpenCode process(es)`);
      }

      this.sendTaskUpdate("checking_opencode");
      if (!(await checkOpenCodeInstalled())) {
        log.error(`OpenCode is not installed!

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
        `);
        this.sendTaskUpdate("opencode_not_installed");
        this.startPromise = null;
        timer.end("❌ OpenCode not installed");
        return;
      }

      timer.checkpoint("OpenCode installation verified");

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
      const configDir = prepareOpenCodeRuntime(
        this.workspaceRoot,
        vitePort,
        mcpToken,
        this.config.enableLsp,
      );

      timer.checkpoint("Plugin setup complete");

      this.sendTaskUpdate("starting_web");
      log.debug("Starting OpenCode Web process...", {
        port: this.actualWebPort,
        hostname: this.config.hostname,
        configDir,
      });

      this.webProcess = startOpenCodeWeb({
        port: this.actualWebPort,
        hostname: this.config.hostname,
        serverUrl: "",
        cwd: this.workspaceRoot,
        configDir,
        corsOrigins,
        contextApiUrl,
        logsApiUrl,
        logFilesJson: this.config.logFiles ? JSON.stringify(this.config.logFiles) : undefined,
        enableBlockOnError: this.config.enableBlockOnError,
        verbose: this.config.verbose,
        enableLsp: this.config.enableLsp,
      });

      timer.checkpoint("Web process started");
      const webUrl = `http://${this.config.hostname}:${this.actualWebPort}`;
      log.debug(`Waiting for OpenCode Web to become ready at ${webUrl}...`);

      this.sendTaskUpdate("waiting_web_ready");
      try {
        await waitForServer(webUrl, SERVER_START_TIMEOUT, this.webProcess);

        if (this.webProcess?.exitCode !== null && this.webProcess?.exitCode !== undefined) {
          throw new Error(`OpenCode process exited with code ${this.webProcess.exitCode}`);
        }

        const version = await getOpenCodeVersion();
        log.info(`OpenCode Web started at ${webUrl}${version ? ` (opencode ${version})` : ""}`);
      } catch (e) {
        log.error("OpenCode Web failed to start", { error: e });
        this.sendTaskUpdate("web_start_timeout");
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
          theme: this.config.theme,
          language: this.config.language,
          settings: this.config.settings,
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
            theme: this.config.theme,
            language: this.config.language,
            settings: this.config.settings,
            hostname: this.config.hostname,
          });
          this.proxyServer = result.server;
          this.actualProxyPort = result.actualPort;
          this.onProxyPortAllocated(this.actualProxyPort);
          log.debug(`Proxy server started on fallback port ${this.actualProxyPort}`);
        } else {
          throw err;
        }
      }
      timer.checkpoint("Proxy server started");

      this.sendTaskUpdate("warming_up_chrome");
      let warmupFailed = false;
      try {
        const ok = await mcp.verify();
        if (!ok) throw new Error("MCP tools list returned empty");
        timer.checkpoint("Chrome MCP warmup complete");
      } catch (e) {
        log.warn("Chrome MCP warmup failed", { error: e });
        this.chromeMcpWarmupFailed = true;
        warmupFailed = true;

        // 保存错误类型和错误信息
        if (e instanceof ChromeMcpWarmupError) {
          this.chromeMcpWarmupErrorType = e.type;
          this.chromeMcpWarmupErrorMessage = e.message;
        } else {
          this.chromeMcpWarmupErrorType = ChromeMcpWarmupErrorType.UNKNOWN;
          this.chromeMcpWarmupErrorMessage = e instanceof Error ? e.message : String(e);
        }
      }

      this.sendTaskUpdate("creating_session");

      this.isStarted = true;

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

  async getAvailableModels(): Promise<ModelInfo[]> {
    return this.api.getAvailableModels();
  }

  async retryWarmupChromeMcp(
    viteOrigin?: string,
    selectedModel?: { providerID: string; modelID: string },
  ): Promise<{ success: boolean; errorType?: string; errorMessage?: string }> {
    const result = await this.api.retryWarmupChromeMcp(
      this.workspaceRoot!,
      viteOrigin,
      selectedModel,
    );
    if (result.success) {
      this.chromeMcpWarmupFailed = false;
      this.sendTaskUpdate("ready");
      return { success: true };
    }

    const error = result.error;
    return {
      success: false,
      errorType: error?.type,
      errorMessage: error?.message || "Unknown error",
    };
  }

  async stop(): Promise<void> {
    const timer = log.timer("stopServices");
    log.info("Stopping OpenCode services...");

    if (this.proxyServer) {
      log.debug("Closing proxy server");
      this.proxyServer.close();
      this.proxyServer = null;
    }

    if (this.webProcess) {
      log.debug("Killing web process", { pid: this.webProcess.pid });
      this.webProcess.kill("SIGTERM");
      this.webProcess = null;
    }

    this.isStarted = false;
    this.startPromise = null;
    timer.end("✓ Services stopped");
  }
}
