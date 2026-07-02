import type { Plugin, ViteDevServer } from "vite";
import type http from "http";
import Inspector from "unplugin-vue-inspector/vite";
import type { OpenCodeOptions, PageContext } from "@vite-plugin-opencode-assistant/shared";
import {
  CONTEXT_API_PATH,
  DEFAULT_CONFIG,
  DEFAULT_PROXY_PORT,
  createLogger,
  setVerbose,
  initProcessLogCapture,
} from "@vite-plugin-opencode-assistant/shared";

import { setupMiddlewares, LOGS_API_PATH } from "./endpoints/index";
import { injectWidget } from "./core/injector";
import { OpenCodeAPI } from "./core/api";
import { OpenCodeService } from "./core/service";
import { resolveWidgetPath, resolveWidgetStylePath } from "./utils/paths";

export default function opencodePlugin(options: OpenCodeOptions = {}): Plugin[] {
  const plugins: Plugin[] = [];

  plugins.push(
    ...Inspector({
      enabled: false,
      toggleButtonVisibility: "never",
      toggleComboKey: false,
    }),
  );

  plugins.push(createOpenCodePlugin(options));

  return plugins;
}

function createOpenCodePlugin(options: OpenCodeOptions = {}): Plugin {
  const config = { ...DEFAULT_CONFIG, ...options } as Required<OpenCodeOptions>;

  setVerbose(config.verbose);

  // 初始化进程日志捕获
  initProcessLogCapture({ maxSize: 500 });

  const log = createLogger("Plugin");

  let actualWebPort = config.webPort;
  let actualProxyPort = config.proxyPort ?? DEFAULT_PROXY_PORT;
  let pageContext: PageContext = { url: "", title: "" };

  const sseClients: Set<http.ServerResponse> = new Set();

  const api = new OpenCodeAPI(
    config.hostname,
    () => actualWebPort,
    () => actualProxyPort,
    config.warmupChromeMcp,
    config.chromeDevtoolsPort,
  );
  const service = new OpenCodeService(
    config,
    api,
    sseClients,
    (port) => {
      actualWebPort = port;
    },
    (port) => {
      actualProxyPort = port;
    },
  );

  return {
    name: "vite-plugin-opencode",
    apply(_viteConfig, env) {
      if (!config.enabled) return false;

      return env.command === "serve" && process.env.NODE_ENV !== "test";
    },

    async configureServer(server: ViteDevServer) {
      const timer = log.timer("configureServer");

      let viteOrigin = "";
      const getViteOrigin = () => viteOrigin;

      setupMiddlewares(server, {
        get webUrl() {
          return actualWebPort ? `http://${config.hostname}:${actualWebPort}` : null;
        },
        get sseClients() {
          return sseClients;
        },
        get pageContext() {
          return pageContext;
        },
        set pageContext(ctx) {
          pageContext = ctx;
        },
        get isServiceStarted() {
          return service.isStarted;
        },
        get currentTask() {
          return service.currentTask;
        },
        getSessions: () => api.getSessions(service.workspaceRoot!),
        createSession: () => api.createSession(service.workspaceRoot!),
        deleteSession: (id) => api.deleteSession(id),
        resolveWidgetPath,
        resolveWidgetStylePath,
        getAvailableModels: () => service.getAvailableModels(),
        retryWarmupChromeMcp: (selectedModel) =>
          service.retryWarmupChromeMcp(getViteOrigin(), selectedModel),
      });

      server.httpServer?.on("listening", async () => {
        log.debug("Vite server listening event fired");

        const address = server.httpServer?.address();
        let vitePort: number;
        let viteHost: string;

        if (address && typeof address === "object") {
          vitePort = address.port;
          const addr = address.address;
          if (addr === "::" || addr === "::1" || addr === "0.0.0.0" || !addr) {
            viteHost = "localhost";
          } else {
            viteHost = addr;
          }
        } else {
          const host = server.config.server.host;
          vitePort = server.config.server.port || 5173;
          viteHost =
            typeof host === "string" && host !== "0.0.0.0" && host !== "::" && host !== "::1"
              ? host
              : "localhost";
        }

        viteOrigin = `http://${viteHost}:${vitePort}`;
        const contextApiUrl = `http://${viteHost}:${vitePort}${CONTEXT_API_PATH}`;
        const logsApiUrl = `http://${viteHost}:${vitePort}${LOGS_API_PATH}`;

        log.debug("Vite server ready", {
          vitePort,
          viteHost,
          viteOrigin,
          contextApiUrl,
          logsApiUrl,
        });

        try {
          await service.start([viteOrigin], contextApiUrl, logsApiUrl, viteOrigin);
        } catch (e) {
          log.error("Failed to start services", { error: e });
        }
      });

      server.httpServer?.on("close", () => {
        log.debug("HTTP server closing");
        service.stop();
      });

      const cleanup = async () => {
        log.debug("Process cleanup triggered");
        await service.stop();
        process.exit(0);
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      timer.end("✓ Server configured");
    },

    transformIndexHtml(html) {
      const timer = log.timer("transformIndexHtml");

      const widget = injectWidget({
        theme: config.theme,
        open: config.open,
        hotkey: config.hotkey,
        proxyPort: actualProxyPort,
        proxyHost: config.hostname,
        displayMode: config.displayMode,
        splitMode: config.splitMode,
      });

      timer.end();
      return html.replace("</body>", `${widget}</body>`);
    },
  };
}
