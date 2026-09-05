import type { HtmlTagDescriptor, Plugin, ViteDevServer } from "vite";
import type http from "http";
import crypto from "crypto";
import fs from "fs";
import Inspector from "unplugin-vue-inspector/vite";
import type { PageContext, PluginOptions, WebProvider } from "@aipanel/core";
import {
  CONTEXT_API_PATH,
  DEFAULT_PROXY_PORT,
  MCP_API_PATH,
  SESSION_ID_KEY,
  resolvePluginConfig,
  setVerbose,
} from "@aipanel/core";
import { createLogger, initProcessLogCapture } from "@aipanel/core/node";

import { setupMiddlewares, LOGS_API_PATH, VUE_DEVTOOLS_API_PATH } from "./endpoints/index";
import { injectWidget } from "./core/injector";
import { loadProvider, type ProviderId } from "./core/provider-loader";
import type { OpenCodeProviderOptions } from "@aipanel/provider-opencode";
import type { DeepSeekProviderOptions } from "@aipanel/provider-deepseek";
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
export type { DeepSeekProviderOptions } from "@aipanel/provider-deepseek";
export type { ProviderId };

/**
 * 编译期映射：provider id → providerOptions schema
 * 与 provider-loader 的运行时包名映射对应；未知 provider 回退为宽松对象。
 */
type ProviderOptionsSchema<ID extends ProviderId> = ID extends "default" | "opencode"
  ? OpenCodeProviderOptions
  : ID extends "deepseek"
    ? DeepSeekProviderOptions
    : Record<string, unknown>;

const DEVTOOLS_BRIDGE_IMPORTEE = "virtual:aipanel-vue-devtools-bridge";
const DEVTOOLS_BRIDGE_QUERY = "aipanel_vue_devtools_bridge";
const BRIDGE_SOURCE_PATH = resolveVueDevtoolsBridgePath();

/**
 * 纯净 MCP 模式专用的静默上下文上报脚本（无任何 UI 副作用）。
 * 复刻挂件（useContext）的上报协议：POST { url, title, sessionId } 到 /__aipanel_context__，
 * 让 chrome-devtools_current_page 等工具在无挂件/无扩展时也能感知当前浏览页面。
 * sessionId 取自 titleInject 写入的 sessionStorage._aipanel_pk，与后端定位逻辑配对。
 * 多标签场景：通过 visibilitychange 只在当前可见标签上报（force 覆盖去重），
 * 使 current_page 跟随用户实际浏览的标签，而不是最后加载的标签。
 */
const SILENT_CONTEXT_SCRIPT = `<script>
(function () {
  var API = "/__aipanel_context__";
  var last = "";
  function report(force) {
    if (document.visibilityState !== "visible") return;
    var url = location.href;
    var title = document.title;
    var key = url + "|" + title;
    if (!force && key === last) return;
    last = key;
    var sessionId = "";
    try { sessionId = sessionStorage.getItem("${SESSION_ID_KEY}") || ""; } catch (e) {}
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, title: title, sessionId: sessionId }),
    }).catch(function () {});
  }
  var push = history.pushState.bind(history);
  var replace = history.replaceState.bind(history);
  history.pushState = function () { push.apply(this, arguments); setTimeout(function () { report(false); }, 0); };
  history.replaceState = function () { replace.apply(this, arguments); setTimeout(function () { report(false); }, 0); };
  window.addEventListener("popstate", function () { report(false); });
  window.addEventListener("hashchange", function () { report(false); });
  document.addEventListener("visibilitychange", function () {
    // 切回本标签时强制上报：本页 url/title 未变，但服务端上下文可能已被其他标签覆盖
    if (document.visibilityState === "visible") report(true);
  });
  window.addEventListener("focus", function () {
    // 多窗口（分屏/多显示器）下所有标签页都 visible，visibilitychange 不触发；
    // 窗口获得焦点是"用户正在看这个页面"的最准确信号
    report(true);
  });
  try {
    new MutationObserver(function () { report(false); })
      .observe(document.head, { childList: true, subtree: true });
  } catch (e) {}
  report(false);
})();
</script>`;

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

      // 先注册中间件（SSE/会话/上下文/挂件等端点），保证即使 Provider 加载失败，
      // 客户端也能通过 SSE 收到 provider_not_installed 状态，挂件也能正常渲染
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
          get eventsToken() {
            return service.eventsToken;
          },
          pushProviderEvent(event) {
            service.pushProviderEvent(event);
          },
          getSessions: (activeSessionId?: string) => {
            if (!provider) return Promise.reject(new Error("Provider 未初始化"));
            return provider.listSessions(service.workspaceRoot!, activeSessionId);
          },
          createSession: () => {
            if (!provider) return Promise.reject(new Error("Provider 未初始化"));
            return provider.createSession(service.workspaceRoot!);
          },
          deleteSession: (id) => {
            if (!provider) return Promise.reject(new Error("Provider 未初始化"));
            return provider.deleteSession
              ? provider.deleteSession(id)
              : Promise.reject(new Error("当前 Provider 不支持删除会话"));
          },
          getCapabilities: () => provider?.capabilities ?? {},
          resolveWidgetPath,
          resolveWidgetStylePath,
          retryWarmupChromeMcp: () => service.retryWarmupChromeMcp(),
        },
        mcpProxy,
        config.logFiles,
      );

      // 纯净 MCP 模式：不加载 Web Provider，仅暴露 MCP 工具服务。
      // 否则动态加载 Provider（初始化动作由 Provider 包自身定义）。
      if (!config.mcpOnly) {
        try {
          provider = await loadProvider(config.provider, {
            hostname: config.hostname,
            chromeDevtoolsPort: config.chromeDevtoolsPort,
            getWebPort: () => actualWebPort,
            getProxyPort: () => actualProxyPort,
            options: config as unknown as Record<string, unknown>,
          });
        } catch (e) {
          // Provider 加载失败不拖垮 Vite dev server：记录失败状态，由客户端通过 SSE 展示错误
          log.error("加载 Web Provider 失败", {
            provider: config.provider,
            error: e instanceof Error ? e.message : String(e),
          });
          service.currentTask = {
            task: "provider_not_installed",
            data: { error: e instanceof Error ? e.message : String(e) },
          };
          // 中间件已注册，SSE 端点会把该状态推送给客户端；跳过后续服务启动流程
          timer.end("❌ Provider 加载失败");
          return;
        }
        provider.applyConfig?.({ theme: config.theme });
        service.setProvider(provider);
      }

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

          // Chrome MCP 预热：所有模式统一处理（warmupChromeMcp 关闭时跳过）。
          // 非 mcpOnly 模式 service.start 内还会再 verify 一次（幂等，主要用于
          // 向 UI 推送 chrome_mcp_failed 状态）；这里保证 mcpOnly 模式不遗漏预热，
          // 且预热失败不阻塞启动（Chrome 未开调试端口属正常）。
          if (config.warmupChromeMcp) {
            const warmup = await mcpProxy.verify();
            if (!warmup.ok) {
              log.debug("Chrome MCP warmup failed", { error: warmup.error });
            }
          }

          if (config.mcpOnly) {
            // 纯净 MCP 模式：仅暴露 MCP 端点，不启动 provider Web 进程/代理。
            return;
          }
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

      // Vue DevTools 桥接脚本 — 通过 tags 注入，Vite 会处理 @id/ 前缀内部的 import。
      // 纯净 MCP 模式也需注入：vue-devtools_* MCP 工具依赖 window.__aipanel_vue
      const tags: HtmlTagDescriptor[] = [
        {
          tag: "script",
          injectTo: "head-prepend",
          attrs: {
            type: "module",
            src: `/@id/${DEVTOOLS_BRIDGE_IMPORTEE}`,
          },
        },
      ];

      // sessionStorage 注入唯一标识（同 Tab 刷新不变，新 Tab 重生成）
      // 用 8 位随机字符，避免多 Tab 场景下标识碰撞；
      // 纯净 MCP 模式也需注入：current_page 定位依赖 _aipanel_pk
      const titleInject = `<script>
        (function () {
          var KEY = "${SESSION_ID_KEY}";
          if (!sessionStorage.getItem(KEY)) {
            sessionStorage.setItem(KEY, "[" + Math.random().toString(36).slice(2, 10) + "]");
          }
        })();
      </script>`;

      // 纯净 MCP 模式：不注入悬浮挂件气泡，HTML 保持干净；
      // 仍注入 titleInject（_aipanel_pk 标识）与静默上下文上报脚本，
      // 使 current_page 等工具能感知当前浏览页面
      if (config.mcpOnly) {
        timer.end("✓ mcp-only (skip widget bubble, keep vue-devtools bridge + context report)");
        return {
          html: html.replace("</body>", `${titleInject}\n${SILENT_CONTEXT_SCRIPT}</body>`),
          tags,
        };
      }

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

      timer.end();
      return {
        html: html.replace("</body>", `${titleInject}\n${widget}</body>`),
        tags,
      };
    },
  };
}
