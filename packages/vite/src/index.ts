import type { Plugin, ViteDevServer } from "vite";
import type http from "http";
import crypto from "crypto";
import Inspector from "unplugin-vue-inspector/vite";
import type { OpenCodeOptions, PageContext } from "@vite-plugin-opencode-assistant/shared";
import {
  CONTEXT_API_PATH,
  DEFAULT_CONFIG,
  DEFAULT_PROXY_PORT,
  setVerbose,
} from "@vite-plugin-opencode-assistant/shared";
import { createLogger, initProcessLogCapture } from "@vite-plugin-opencode-assistant/shared/node";

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
  let projectRoot = "";
  const pageContext: PageContext = { url: "", title: "" };
  /** 非扩展模式使用 "default" 作为 key */
  const DEFAULT_TAB = "default";
  const pageContexts = new Map<string, PageContext>([[DEFAULT_TAB, pageContext]]);
  let activeTabId = DEFAULT_TAB;
  const serviceInstanceId = crypto.randomUUID();

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

      projectRoot = server.config.root;

      let viteOrigin = "";
      const getViteOrigin = () => viteOrigin;

      setupMiddlewares(server, {
        get webUrl() {
          return actualWebPort ? `http://${config.hostname}:${actualWebPort}` : null;
        },
        get sseClients() {
          return sseClients;
        },
        getPageContext() {
          return (
            pageContexts.get(activeTabId) || pageContexts.get(DEFAULT_TAB) || { url: "", title: "" }
          );
        },
        setPageContext(tabId: string, ctx: PageContext) {
          pageContexts.set(tabId || DEFAULT_TAB, ctx);
        },
        setActiveTabId(tabId: string) {
          activeTabId = tabId;
        },
        clearSelectedElements() {
          const ctx = pageContexts.get(activeTabId);
          if (ctx) {
            ctx.selectedElements = [];
            pageContexts.set(activeTabId, ctx);
          }
          // 同时清除默认上下文
          const defaultCtx = pageContexts.get(DEFAULT_TAB);
          if (defaultCtx) {
            defaultCtx.selectedElements = [];
          }
        },
        get isServiceStarted() {
          return service.isStarted;
        },
        get currentTask() {
          return service.currentTask;
        },
        get actualProxyPort() {
          return actualProxyPort;
        },
        get actualWebPort() {
          return actualWebPort;
        },
        get serviceInstanceId() {
          return serviceInstanceId;
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
        displayMode: config.displayMode === "extension" ? "extension-selector" : config.displayMode,
        splitMode: config.splitMode,
        serviceInstanceId,
        webPort: actualWebPort,
        projectRoot,
        verbose: config.verbose,
      });

      // 页面标题注入唯一标识，使 Chrome DevTools MCP list_pages 中同 URL Tab 可区分
      const pageKey = Math.random().toString(36).slice(2, 5);
      const titleInject = `<script>(function(){var k="[${pageKey}]",d=document,p=!1,f=function(){if(p)return;var t=d.title;if(t.indexOf(k)===0)return;p=!0;d.title=k+t.replace(k,"");p=!1};f();new MutationObserver(f).observe(d.querySelector("title")||d.head,{childList:!0})})();</script>`;

      timer.end();
      return html.replace("</body>", `${titleInject}\n${widget}</body>`);
    },
  };
}
