import { EXT_MSG, WIDGET_MSG, createLogger } from "@vite-plugin-opencode-assistant/shared";

const log = createLogger("OpenCode CS");

/**
 * OpenCode Assistant - Content Script
 *
 * 页面上下文同步 + 选择模式消息中转。
 * 服务检测已迁移至 Background Service Worker（轮询 /__opencode_start__）。
 * UI 在 Side Panel 中渲染。
 */
const INIT_MARKER = "__OPENCODE_EXTENSION_INITIALIZED__";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = window as any;

if (win[INIT_MARKER]) {
  log.warn("Content Script 已初始化，跳过");
} else {
  win[INIT_MARKER] = true;
  log.info("Content Script 已启动", { url: location.href });

  // ========== 页面上下文同步 ==========

  /** 上报当前页面上下文（URL + 标题） */
  function reportPageContext() {
    chrome.runtime
      .sendMessage({
        type: EXT_MSG.PAGE_CONTEXT,
        ctx: {
          url: location.href,
          title: document.title,
          sessionId: sessionStorage.getItem("_opencode_pk") || undefined,
        },
      })
      .catch(() => {});
    log.info(`上报上下文: url=${location.href}`);
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

    reportPageContext();
  }

  // ========== Side Panel 消息处理 ==========

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Background 请求立即上报当前页面上下文
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
      chrome.runtime
        .sendMessage({
          ...event.data,
          pageUrl: event.data.pageUrl ?? location.href,
          pageTitle: event.data.pageTitle ?? document.title,
        })
        .catch(() => {});
    }
  });

  // 启动页面上下文监听
  watchPageContext();
}
