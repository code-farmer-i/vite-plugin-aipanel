import {
  EXT_MSG,
  WIDGET_MSG,
  START_API_PATH,
  createLogger,
} from "@vite-plugin-opencode-assistant/shared";

const log = createLogger("OpenCode CS");

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
  log.warn("Content Script 已初始化，跳过");
} else {
  win[INIT_MARKER] = true;

  log.debug("Content Script 已启动", { url: location.href });

  /** 缓存的 Vite 服务信息 */
  interface ServiceInfo {
    proxyPort: number;
    vitePort: string;
    projectRoot: string;
    serviceInstanceId: string;
    verbose?: boolean;
  }

  let cachedInfo: ServiceInfo | null = null;
  /** 当前窗口 ID（从 background 转发的消息中缓存，用于跨窗口消息过滤） */
  let myWindowId: number | undefined;
  /** 当前 Tab 的唯一标识，追加到页面标题末尾使 list_pages 中同 URL Tab 可区分 */
  const PAGE_KEY = `${Math.random().toString(36).slice(2, 7)}`;
  const PAGE_KEY_SUFFIX = ` [${PAGE_KEY}]`;

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
      log.debug(`服务上线: ${info.serviceInstanceId} vite=${info.vitePort}`);
      // 新服务上线时主动上报当前页面上下文
      reportPageContext();
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
        // 心跳超时后先通过 HTTP 确认服务是否真的下线
        // postMessage 在后台 tab 会被浏览器降频，不能仅凭心跳判断
        fetch(START_API_PATH)
          .then((res) => res.json())
          .then((data) => {
            if (data.proxyPort && data.serviceInstanceId) {
              // 服务仍存活，只是 postMessage 被降频了，刷新缓存
              const info: ServiceInfo = {
                proxyPort: data.proxyPort,
                vitePort: location.port,
                projectRoot: data.projectRoot || "",
                serviceInstanceId: data.serviceInstanceId,
              };
              handleServiceInfo(info);
            } else {
              reportServiceGone();
            }
          })
          .catch(() => reportServiceGone());
      }
      heartbeatTimer = null;
    }, HEARTBEAT_TIMEOUT);
  }

  function reportServiceGone() {
    if (!cachedInfo) return;
    chrome.runtime
      .sendMessage({
        type: EXT_MSG.SERVICE_GONE,
        serviceInstanceId: cachedInfo.serviceInstanceId,
      })
      .catch(() => {});
    log.debug(`服务下线（心跳超时）: ${cachedInfo.serviceInstanceId}`);
    cachedInfo = null;
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
        verbose: data.verbose,
      });
    }
  });

  // ========== 页面上下文同步 ==========

  /** 在页面标题末尾追加唯一标识，使同 URL Tab 在 list_pages 中可区分 */
  let patchingTitle = false;
  function ensurePageKey() {
    if (!cachedInfo || patchingTitle) return;
    const raw = document.title.replace(PAGE_KEY_SUFFIX, "");
    if (!document.title.endsWith(PAGE_KEY_SUFFIX)) {
      patchingTitle = true;
      document.title = raw + PAGE_KEY_SUFFIX;
      patchingTitle = false;
    }
  }

  /** 上报当前页面上下文（URL + 标题） */
  function reportPageContext() {
    if (!cachedInfo) return;
    ensurePageKey();
    chrome.runtime
      .sendMessage({
        type: EXT_MSG.PAGE_CONTEXT,
        ctx: { url: location.href, title: document.title },
        serviceInstanceId: cachedInfo.serviceInstanceId,
      })
      .catch(() => {});
    log.debug(`上报上下文: url=${location.href} serviceInstanceId=${cachedInfo.serviceInstanceId}`);
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
        ensurePageKey();
        reportPageContext();
      }
    }).observe(document.querySelector("title") || document.head, { childList: true });

    reportPageContext();
  }

  // ========== Side Panel 消息处理 ==========

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === EXT_MSG.GET_PORT_INFO) {
      if (cachedInfo && !msg.forceRefresh) {
        // 有心跳缓存且非强制刷新 → 直接返回
        sendResponse(cachedInfo);
      } else {
        // 无缓存或强制刷新 → 真实请求检测服务（按需，非轮询）
        fetch(START_API_PATH)
          .then((res) => res.json())
          .then((data) => {
            if (data.proxyPort && data.serviceInstanceId) {
              const info: ServiceInfo = {
                proxyPort: data.proxyPort,
                vitePort: location.port,
                projectRoot: data.projectRoot || "",
                serviceInstanceId: data.serviceInstanceId,
              };
              // 真正的服务响应 → 更新缓存
              handleServiceInfo(info);
              sendResponse(info);
            } else {
              sendResponse(null);
            }
          })
          .catch(() => sendResponse(null));
      }
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

    // 服务下线 → 清除缓存，确保下次 GET_PORT_INFO 走真实检测
    // 按 windowId 过滤，防止跨窗口 SSE 断连误清除当前窗口的缓存
    if (msg.type === EXT_MSG.SERVICE_GONE) {
      if (msg.windowId !== undefined && myWindowId !== undefined && msg.windowId !== myWindowId) {
        return false; // 来自其他窗口，忽略
      }
      if (cachedInfo && msg.serviceInstanceId === cachedInfo.serviceInstanceId) {
        log.debug(`服务下线，清除缓存: ${cachedInfo.serviceInstanceId}`);
        cachedInfo = null;
        if (heartbeatTimer) {
          clearTimeout(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
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

  // 查询自身窗口 ID（用于跨窗口 SERVICE_GONE 过滤）
  chrome.runtime.sendMessage({ type: EXT_MSG.CS_QUERY_WINDOW }, (response) => {
    if (response?.windowId) {
      myWindowId = response.windowId;
      log.debug(`窗口 ID: ${myWindowId}`);
    }
  });

  // 启动页面上下文监听
  watchPageContext();
}
