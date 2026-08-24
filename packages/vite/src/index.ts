import type { Plugin, ViteDevServer } from "vite";
import type http from "http";
import crypto from "crypto";
import fs from "fs";
import Inspector from "unplugin-vue-inspector/vite";
import type { PageContext, PluginOptions, WebProvider } from "@aipanel/core";
import {
  CONTEXT_API_PATH,
  DEFAULT_PROXY_PORT,
  MCP_API_PATH,
  resolvePluginConfig,
  setVerbose,
} from "@aipanel/core";
import { createLogger, initProcessLogCapture } from "@aipanel/core/node";

import { setupMiddlewares, LOGS_API_PATH, VUE_DEVTOOLS_API_PATH } from "./endpoints/index";
import { injectWidget } from "./core/injector";
import { loadProvider, type ProviderId } from "./core/provider-loader";
import type { OpenCodeProviderOptions } from "@aipanel/provider-opencode";
import { AIPanelService } from "./core/service";
import { McpProxy } from "./core/mcp-proxy";
import {
  resolveWidgetPath,
  resolveWidgetStylePath,
  resolveVueDevtoolsBridgePath,
} from "./utils/paths";
import { findGitRoot } from "./utils/system";

export type { PluginOptions } from "@aipanel/core";
export type { OpenCodeProviderOptions } from "@aipanel/provider-opencode";
export type { ProviderId };

/**
 * 编译期映射：provider id → providerOptions schema
 * 与 provider-loader 的运行时包名映射对应；未知 provider 回退为宽松对象。
 */
type ProviderOptionsSchema<ID extends ProviderId> = ID extends "default" | "opencode"
  ? OpenCodeProviderOptions
  : Record<string, unknown>;

const DEVTOOLS_BRIDGE_IMPORTEE = "virtual:aipanel-vue-devtools-bridge";
const DEVTOOLS_BRIDGE_QUERY = "aipanel_vue_devtools_bridge";
const BRIDGE_SOURCE_PATH = resolveVueDevtoolsBridgePath();

/**
 * AIPanel Vite 插件
 * provider 字段收窄为已登记的 ProviderId 联合类型（拼写错误在编译期报错）；
 * providerOptions 的类型根据 options.provider 自动推断（未配置时默认 "default" → opencode）。
 */
export default function aipanelPlugin<const P extends ProviderId = "default">(
  options: Omit<PluginOptions<ProviderOptionsSchema<P>>, "provider"> & { provider?: P } = {},
): Plugin[] {
  const plugins: Plugin[] = [];

  plugins.push(
    ...Inspector({
      enabled: false,
      toggleButtonVisibility: "never",
      toggleComboKey: false,
    }),
  );

  plugins.push(createAIPanelPlugin(options));

  return plugins;
}

function createAIPanelPlugin(options: PluginOptions = {}): Plugin {
  const config = resolvePluginConfig(options);

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

  let provider: WebProvider | null = null;
  const service = new AIPanelService(
    config,
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
    name: "vite-plugin-aipanel",
    apply(_viteConfig, env) {
      if (!config.enabled) return false;

      return env.command === "serve" && process.env.NODE_ENV !== "test";
    },

    async configureServer(server: ViteDevServer) {
      const timer = log.timer("configureServer");

      projectRoot = server.config.root;

      let viteOrigin = "";

      // 动态加载 Provider（用户指定哪个就加载哪个），初始化动作由 Provider 包自身定义
      try {
        provider = await loadProvider(config.provider, {
          hostname: config.hostname,
          chromeDevtoolsPort: config.chromeDevtoolsPort,
          getWebPort: () => actualWebPort,
          getProxyPort: () => actualProxyPort,
          options: config as unknown as Record<string, unknown>,
        });
      } catch (e) {
        // Provider 加载失败不拖垮 Vite dev server：记录失败状态，由客户端展示错误
        log.error("加载 Web Provider 失败", {
          provider: config.provider,
          error: e instanceof Error ? e.message : String(e),
        });
        service.currentTask = {
          task: "provider_not_installed",
          data: { error: e instanceof Error ? e.message : String(e) },
        };
        return;
      }
      provider.applyConfig?.({ theme: config.theme });
      service.setProvider(provider);

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
          getSessions: () => provider!.listSessions(service.workspaceRoot!),
          createSession: () => provider!.createSession(service.workspaceRoot!),
          deleteSession: (id) =>
            provider!.deleteSession
              ? provider!.deleteSession(id)
              : Promise.reject(new Error("当前 Provider 不支持删除会话")),
          resolveWidgetPath,
          resolveWidgetStylePath,
          retryWarmupChromeMcp: () => service.retryWarmupChromeMcp(),
        },
        mcpProxy,
        config.logFiles,
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
        const mcpApiUrl = `http://${viteHost}:${vitePort}${MCP_API_PATH}`;

        log.debug("Vite server ready", {
          vitePort,
          viteHost,
          viteOrigin,
          contextApiUrl,
          logsApiUrl,
          vueDevtoolsApiUrl,
          mcpApiUrl,
        });

        log.info(`MCP endpoint: ${mcpApiUrl}`);

        try {
          // MCP 先就绪（用本地包，秒启动），warmup 依赖它
          await mcpProxy.start();
          await service.start(
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
      // 用 8 位随机字符，避免多 Tab 场景下标识碰撞
      const titleInject = `<script>
        (function () {
          var KEY = "_aipanel_pk";
          if (!sessionStorage.getItem(KEY)) {
            sessionStorage.setItem(KEY, "[" + Math.random().toString(36).slice(2, 10) + "]");
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
