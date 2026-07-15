import { EXT_MSG, WIDGET_MSG } from "@vite-plugin-opencode-assistant/shared";

/**
 * OpenCode Assistant - Content Script
 *
 * 通过 postMessage 接收服务信息 + 页面上下文同步 + 选择模式消息中转。
 * UI 在 Side Panel 中渲染。
 */
const INIT_MARKER = "__OPENCODE_EXTENSION_INITIALIZED__";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = window as any;

// 防御性检查：MV3 中 content script 不应重复注入到同一页面
if (win[INIT_MARKER]) {
  console.warn("[OpenCode CS] Content Script 已初始化，跳过");
} else {
  win[INIT_MARKER] = true;

  console.debug("[OpenCode CS] Content Script 已启动", location.href);

  /** 缓存的 Vite 服务信息 */
  interface ServiceInfo {
    proxyPort: number;
    vitePort: string;
    projectRoot: string;
    serviceInstanceId: string;
  }

  let cachedInfo: ServiceInfo | null = null;

  /** 心跳超时定时器 */
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  const HEARTBEAT_TIMEOUT = 12000; // 12 秒无心跳视为服务下线

  /** 处理服务信息（postMessage 或 DOM 检测） */
  function handleServiceInfo(info: ServiceInfo) {
    const wasAlive = cachedInfo !== null;
    const serviceChanged = cachedInfo && info.serviceInstanceId !== cachedInfo.serviceInstanceId;

    // 新服务上线
    if (!wasAlive || serviceChanged) {
      if (wasAlive && serviceChanged) {
        chrome.runtime
          .sendMessage({
            type: EXT_MSG.SERVICE_GONE,
            serviceInstanceId: cachedInfo!.serviceInstanceId,
          })
          .catch(() => {});
      }
      cachedInfo = info;
      chrome.runtime
        .sendMessage({
          type: EXT_MSG.SERVICE_APPEARED,
          ...info,
        })
        .catch(() => {});
      console.debug("[OpenCode CS] 服务上线: %s vite=%s", info.serviceInstanceId, info.vitePort);
    }
    // 纯端口变化（同 serviceInstanceId）
    else if (wasAlive && !serviceChanged && info.vitePort !== cachedInfo!.vitePort) {
      cachedInfo = info;
      chrome.runtime
        .sendMessage({
          type: EXT_MSG.SERVICE_APPEARED,
          ...info,
        })
        .catch(() => {});
    }

    // 重置心跳超时
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      if (cachedInfo) {
        chrome.runtime
          .sendMessage({
            type: EXT_MSG.SERVICE_GONE,
            serviceInstanceId: cachedInfo.serviceInstanceId,
          })
          .catch(() => {});
        console.debug("[OpenCode CS] 服务下线（心跳超时）: %s", cachedInfo.serviceInstanceId);
        cachedInfo = null;
      }
      heartbeatTimer = null;
    }, HEARTBEAT_TIMEOUT);
  }

  // ========== 通过 postMessage 接收服务信息（替代 HTTP 轮询） ==========

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type !== WIDGET_MSG.SERVICE_INFO) return;
    const data = event.data;
    if (data.proxyPort && data.serviceInstanceId) {
      handleServiceInfo({
        proxyPort: data.proxyPort,
        vitePort: data.vitePort || location.port,
        projectRoot: data.projectRoot || "",
        serviceInstanceId: data.serviceInstanceId,
      });
    }
  });

  // ========== 页面上下文同步 ==========

  /** 上报当前页面上下文（URL + 标题） */
  function reportPageContext() {
    if (!cachedInfo) return; // 无服务时不发送
    chrome.runtime
      .sendMessage({
        type: EXT_MSG.PAGE_CONTEXT,
        ctx: { url: location.href, title: document.title },
        serviceInstanceId: cachedInfo.serviceInstanceId,
      })
      .catch(() => {});
  }

  function watchPageContext() {
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      origPush(...args);
      reportPageContext();
    };
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplace(...args);
      reportPageContext();
    };
    window.addEventListener("popstate", reportPageContext);
    window.addEventListener("hashchange", reportPageContext);

    let lastTitle = document.title;
    new MutationObserver(() => {
      if (document.title !== lastTitle) {
        lastTitle = document.title;
        reportPageContext();
      }
    }).observe(document.querySelector("title") || document.head, { childList: true });

    reportPageContext();
  }

  // ========== Side Panel 消息处理 ==========

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === EXT_MSG.GET_PORT_INFO) {
      // 同步获取缓存信息（用于 Tab 切换时的快速响应）
      sendResponse(cachedInfo);
      return true;
    }

    // Tab 切换后 Background 请求立即上报当前页面上下文
    if (msg.type === EXT_MSG.REQUEST_PAGE_CONTEXT) {
      reportPageContext();
      sendResponse({ success: true });
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
