import type { Plugin, ViteDevServer } from "vite";
import type http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Inspector from "unplugin-vue-inspector/vite";
import type { OpenCodeOptions, PageContext } from "@vite-plugin-opencode-assistant/shared";
import {
  CONTEXT_API_PATH,
  DEFAULT_CONFIG,
  DEFAULT_PROXY_PORT,
  setVerbose,
} from "@vite-plugin-opencode-assistant/shared";
import { createLogger, initProcessLogCapture } from "@vite-plugin-opencode-assistant/shared/node";

import { setupMiddlewares, LOGS_API_PATH, VUE_DEVTOOLS_API_PATH } from "./endpoints/index";
import { injectWidget } from "./core/injector";
import { OpenCodeAPI } from "./core/api";
import { OpenCodeService } from "./core/service";
import { McpProxy } from "./core/mcp-proxy";
import { resolveWidgetPath, resolveWidgetStylePath } from "./utils/paths";
import { findGitRoot } from "./utils/system";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEVTOOLS_BRIDGE_IMPORTEE = "virtual:opencode-vue-devtools-bridge";
const DEVTOOLS_BRIDGE_QUERY = "opencode_vue_devtools_bridge";
const BRIDGE_SOURCE_PATH = (() => {
  const base = path.resolve(__dirname, "client/vue-devtools-bridge");
  for (const ext of [".ts", ".mjs", ".cjs", ".js"]) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return base + ".ts"; // fallback
})();

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
  let vueDevtoolsApiUrl = "";
  const pageContext: PageContext = { url: "", title: "" };
  /** 非扩展模式使用 "default" 作为 key */
  const DEFAULT_TAB = "default";
  const pageContexts = new Map<string, PageContext>([[DEFAULT_TAB, pageContext]]);
  let activeTabId = DEFAULT_TAB;
  const serviceInstanceId = crypto.randomUUID();

  const sseClients: Set<http.ServerResponse> = new Set();

  const mcpProxy = new McpProxy({ idleTimeout: 5 * 60 * 1000 });

  const api = new OpenCodeAPI(
    config.hostname,
    () => actualWebPort,
    () => actualProxyPort,
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
  // 提前设置 workspaceRoot，避免 widget 过早调用 getSessions 时拿到 null
  service.workspaceRoot = findGitRoot(process.cwd());

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

      setupMiddlewares(
        server,
        {
          get webUrl() {
            return actualWebPort ? `http://${config.hostname}:${actualWebPort}` : null;
          },
          get sseClients() {
            return sseClients;
          },
          getPageContext() {
            return (
              pageContexts.get(activeTabId) ||
              pageContexts.get(DEFAULT_TAB) || { url: "", title: "" }
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
          retryWarmupChromeMcp: () => service.retryWarmupChromeMcp(),
        },
        mcpProxy,
      );

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
        vueDevtoolsApiUrl = `http://${viteHost}:${vitePort}${VUE_DEVTOOLS_API_PATH}`;

        log.debug("Vite server ready", {
          vitePort,
          viteHost,
          viteOrigin,
          contextApiUrl,
          logsApiUrl,
          vueDevtoolsApiUrl,
        });

        try {
          // MCP 先就绪（用本地包，秒启动），warmup 依赖它
          await mcpProxy.start();
          await service.start(
            mcpProxy.accessToken,
            vitePort,
            [viteOrigin],
            contextApiUrl,
            logsApiUrl,
            viteOrigin,
            mcpProxy,
            vueDevtoolsApiUrl,
          );
        } catch (e) {
          log.error("Failed to start services", { error: e });
        }
      });

      server.httpServer?.on("close", () => {
        log.debug("HTTP server closing");
        service.stop();
        mcpProxy.stop();
      });

      const cleanup = async () => {
        log.debug("Process cleanup triggered");
        mcpProxy.stop();
        await service.stop();
        process.exit(0);
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      timer.end("✓ Server configured");
    },

    resolveId(id) {
      if (id === DEVTOOLS_BRIDGE_IMPORTEE) {
        return `${BRIDGE_SOURCE_PATH}?${DEVTOOLS_BRIDGE_QUERY}`;
      }
      return undefined;
    },

    load(id) {
      const [filePath, query] = id.split("?", 2);
      if (query === DEVTOOLS_BRIDGE_QUERY) {
        return fs.readFileSync(filePath, "utf-8");
      }
      return undefined;
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

      // Vue DevTools 桥接脚本 — 通过 tags 注入，Vite 会处理 @id/ 前缀内部的 import

      // sessionStorage 注入唯一标识（同 Tab 刷新不变，新 Tab 重生成）
      const titleInject = `<script>
        (function () {
          var KEY = "_opencode_pk";
          if (!sessionStorage.getItem(KEY)) {
            sessionStorage.setItem(KEY, "[" + Math.random().toString(36).slice(2, 5) + "]");
          }
        })();
      </script>`;

      timer.end();
      return {
        html: html.replace("</body>", `${titleInject}\n${widget}</body>`),
        tags: [
          {
            tag: "script",
            injectTo: "head-prepend",
            attrs: {
              type: "module",
              src: `/@id/${DEVTOOLS_BRIDGE_IMPORTEE}`,
            },
          },
        ],
      };
    },
  };
}
