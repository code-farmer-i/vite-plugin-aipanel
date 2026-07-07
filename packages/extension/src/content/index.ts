/**
 * OpenCode Assistant - Content Script
 *
 * 轻量：端口检测、页面上下文同步、选择模式消息中转。
 * UI 在 Side Panel 中渲染。
 */
const INIT_MARKER = "__OPENCODE_EXTENSION_INITIALIZED__";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = window as any;
if (win[INIT_MARKER]) throw new Error("Already initialized");
win[INIT_MARKER] = true;

console.log("[OpenCode CS] Content Script 已启动", location.href);

/** 从 /__opencode_start__ 获取 Vite 插件端口 */
async function getPortInfo() {
  try {
    const res = await fetch("/__opencode_start__");
    const data = await res.json();
    if (data.proxyPort) {
      console.log("[OpenCode CS] 检测到插件, proxy:%d, vite:%s", data.proxyPort, location.port);
      return { proxyPort: data.proxyPort, vitePort: location.port };
    }
    console.log("[OpenCode CS] /__opencode_start__ 响应无端口:", data);
    return null;
  } catch (e) {
    console.log("[OpenCode CS] /__opencode_start__ 请求失败:", e);
    return null;
  }
}

/** 监听页面 URL 和标题变化，通知 Side Panel */
function watchPageContext() {
  const report = () => {
    chrome.runtime
      .sendMessage({
        type: "PAGE_CONTEXT",
        ctx: { url: location.href, title: document.title },
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

/** 处理 Side Panel 的请求 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_PORT_INFO") {
    getPortInfo().then((info) => sendResponse(info));
    return true;
  }

  // 选择模式消息：转发到页面 selector
  if (msg.type === "SELECTION_START") {
    window.postMessage({ type: "OPENCODE_SELECTOR_START" }, "*");
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "SELECTION_STOP") {
    window.postMessage({ type: "OPENCODE_SELECTOR_STOP" }, "*");
    sendResponse({ success: true });
    return true;
  }

  return false;
});

// 监听页面 selector 的选择结果，转发到 Side Panel
// 注意：page (MAIN world) 通过 postMessage 通信时 event.source 不 === content script 的 window
window.addEventListener("message", (event) => {
  // 仅接受同源消息，防止恶意页面伪造消息
  if (event.origin !== location.origin) return;

  const type = event.data?.type;
  if (
    type === "OPENCODE_ELEMENT_SELECTED" ||
    type === "OPENCODE_SELECTION_CANCELLED" ||
    type === "OPENCODE_SELECTOR_START" ||
    type === "OPENCODE_SELECTOR_STOP"
  ) {
    // 附加当前页面 URL 和标题，确保 Side Panel 拿到的是用户页面的 URL 而非扩展自身 URL
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
