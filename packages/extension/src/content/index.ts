import { EXT_MSG, WIDGET_MSG, START_API_PATH } from "@vite-plugin-opencode-assistant/shared";

/**
 * OpenCode Assistant - Content Script
 *
 * 健康检查 + 页面上下文同步 + 选择模式消息中转。
 * UI 在 Side Panel 中渲染。
 */
const INIT_MARKER = "__OPENCODE_EXTENSION_INITIALIZED__";
const HEALTH_CHECK_INTERVAL = 3000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = window as any;

// 防御性检查：MV3 中 content script 不应重复注入到同一页面
if (win[INIT_MARKER]) {
  console.warn("[OpenCode CS] Content Script 已初始化，跳过");
} else {
  win[INIT_MARKER] = true;

  console.log("[OpenCode CS] Content Script 已启动", location.href);

  /** 缓存的 Vite 服务信息 */
  let cachedInfo: {
    proxyPort: number;
    vitePort: string;
    projectRoot: string;
    serviceInstanceId: string;
  } | null = null;

  /** 从 /__opencode_start__ 获取 Vite 插件信息 */
  async function getServiceInfo(): Promise<typeof cachedInfo> {
    try {
      const res = await fetch(START_API_PATH);
      const data = await res.json();
      if (data.proxyPort && data.serviceInstanceId) {
        return {
          proxyPort: data.proxyPort,
          vitePort: location.port,
          projectRoot: data.projectRoot || "",
          serviceInstanceId: data.serviceInstanceId,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ========== 健康检查 ==========

  /** 检测服务状态变化，通知 Side Panel */
  async function healthCheck() {
    const info = await getServiceInfo();

    const wasAlive = cachedInfo !== null;
    const isAlive = info !== null;
    const serviceChanged = info && cachedInfo && info.serviceInstanceId !== cachedInfo.serviceInstanceId;

    // 新服务上线
    if (isAlive && (!wasAlive || serviceChanged)) {
      if (wasAlive && serviceChanged) {
        // 端口被不同服务复用：先通知旧服务下线
        chrome.runtime.sendMessage({
          type: EXT_MSG.SERVICE_GONE,
          serviceInstanceId: cachedInfo!.serviceInstanceId,
        }).catch(() => {});
      }
      cachedInfo = info;
      chrome.runtime.sendMessage({
        type: EXT_MSG.SERVICE_APPEARED,
        ...info,
      }).catch(() => {});
      console.log("[OpenCode CS] 服务上线: %s vite=%s", info.serviceInstanceId, info.vitePort);
    }
    // 服务下线
    else if (!isAlive && wasAlive) {
      chrome.runtime.sendMessage({
        type: EXT_MSG.SERVICE_GONE,
        serviceInstanceId: cachedInfo!.serviceInstanceId,
      }).catch(() => {});
      console.log("[OpenCode CS] 服务下线: %s", cachedInfo!.serviceInstanceId);
      cachedInfo = null;
    }
    // 纯端口变化（同 serviceInstanceId，可能 Vite 重启后换了端口）
    else if (isAlive && wasAlive && !serviceChanged && info.vitePort !== cachedInfo!.vitePort) {
      cachedInfo = info;
      // 端口变化通过 SERVICE_APPEARED 通知 Side Panel 更新连接信息
      chrome.runtime.sendMessage({
        type: EXT_MSG.SERVICE_APPEARED,
        ...info,
      }).catch(() => {});
    }
  }

  // 启动健康检查
  healthCheck();
  setInterval(healthCheck, HEALTH_CHECK_INTERVAL);

  // ========== 页面上下文同步 ==========

  function watchPageContext() {
    const report = () => {
      if (!cachedInfo) return; // 无服务时不发送
      chrome.runtime
        .sendMessage({
          type: EXT_MSG.PAGE_CONTEXT,
          ctx: { url: location.href, title: document.title },
          serviceInstanceId: cachedInfo.serviceInstanceId,
        })
        .catch(() => {});
    };

    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      origPush(...args);
      report();
    };
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplace(...args);
      report();
    };
    window.addEventListener("popstate", report);
    window.addEventListener("hashchange", report);

    let lastTitle = document.title;
    new MutationObserver(() => {
      if (document.title !== lastTitle) {
        lastTitle = document.title;
        report();
      }
    }).observe(document.querySelector("title") || document.head, { childList: true });

    report();
  }

  // ========== Side Panel 消息处理 ==========

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === EXT_MSG.GET_PORT_INFO) {
      // 同步获取缓存信息（用于 Tab 切换时的快速响应）
      sendResponse(cachedInfo);
      return true;
    }

    // 选择模式消息：转发到页面 selector
    if (msg.type === EXT_MSG.SELECTION_START) {
      window.postMessage({ type: WIDGET_MSG.SELECTOR_START }, "*");
      sendResponse({ success: true });
      return true;
    }

    if (msg.type === EXT_MSG.SELECTION_STOP) {
      window.postMessage({ type: WIDGET_MSG.SELECTOR_STOP }, "*");
      sendResponse({ success: true });
      return true;
    }

    return false;
  });

  // ========== 页面选择结果转发 ==========

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;

    const type = event.data?.type;
    if (
      type === WIDGET_MSG.ELEMENT_SELECTED ||
      type === WIDGET_MSG.SELECTION_CANCELLED ||
      type === WIDGET_MSG.SELECTOR_START ||
      type === WIDGET_MSG.SELECTOR_STOP
    ) {
      // 附加当前页面 URL、标题和 serviceInstanceId，确保按服务实例隔离
      chrome.runtime
        .sendMessage({
          ...event.data,
          pageUrl: event.data.pageUrl ?? location.href,
          pageTitle: event.data.pageTitle ?? document.title,
          serviceInstanceId: cachedInfo?.serviceInstanceId,
        })
        .catch(() => {});
    }
  });

  // 启动页面上下文监听
  watchPageContext();
}
