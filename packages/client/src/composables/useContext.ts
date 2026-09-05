import { onMounted, onUnmounted, ref } from "vue";
import type { AIPanelSelectedElement, ServiceStatus } from "@aipanel/core";
import { CONTEXT_API_PATH, EXT_MSG, SESSION_ID_KEY } from "@aipanel/core";

export function useContext(
  serviceStatus: { value: ServiceStatus },
  selectedElements: { value: AIPanelSelectedElement[] },
  displayMode?: string,
) {
  let currentPageUrl = "";
  let currentPageTitle = "";

  // 扩展模式：使用目标页面通过 PAGE_CONTEXT 消息发来的 URL/标题
  const extensionPageUrl = ref("");
  const extensionPageTitle = ref("");
  const extensionSessionId = ref("");

  const getPageUrl = () =>
    displayMode === "extension" ? extensionPageUrl.value : window.location.href;
  const getPageTitle = () =>
    displayMode === "extension" ? extensionPageTitle.value : document.title;
  const getSessionId = () =>
    displayMode === "extension"
      ? extensionSessionId.value
      : sessionStorage.getItem(SESSION_ID_KEY) || "";

  const sendContext = (url: string, title: string) => {
    fetch(CONTEXT_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title,
        sessionId: getSessionId(),
        selectedElements: selectedElements.value,
      }),
    }).catch(() => {});
  };

  const updateContext = (force = false) => {
    if (serviceStatus.value === "idle") return;
    const newUrl = getPageUrl();
    const newTitle = getPageTitle();
    if (!newUrl && !newTitle) return; // 扩展模式下尚未收到 PAGE_CONTEXT
    if (force || newUrl !== currentPageUrl || newTitle !== currentPageTitle) {
      currentPageUrl = newUrl;
      currentPageTitle = newTitle;
      sendContext(newUrl, newTitle);
    }
  };

  const scheduleContextUpdate = () => {
    requestAnimationFrame(() => updateContext());
  };

  // 扩展模式：监听 PAGE_CONTEXT 消息获取目标页面 URL/标题
  const handleExtensionPageContext = (msg: {
    type: string;
    ctx?: { url: string; title: string; sessionId?: string };
  }) => {
    if (msg.type === EXT_MSG.PAGE_CONTEXT && msg.ctx) {
      extensionPageUrl.value = msg.ctx.url;
      extensionPageTitle.value = msg.ctx.title;
      extensionSessionId.value = msg.ctx.sessionId || "";
      updateContext(true);
    }
  };

  let titleObserver: MutationObserver | null = null;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  onMounted(() => {
    // 扩展模式下，通过 chrome.runtime 监听目标页面的上下文变化
    if (displayMode === "extension") {
      chrome.runtime.onMessage.addListener(handleExtensionPageContext);
      return;
    }

    // 非扩展模式：监听当前页面的 URL/标题变化
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      scheduleContextUpdate();
    };
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      scheduleContextUpdate();
    };
    window.addEventListener("popstate", scheduleContextUpdate);
    window.addEventListener("hashchange", scheduleContextUpdate);

    titleObserver = new MutationObserver(() => {
      if (document.title !== currentPageTitle) updateContext();
    });
    if (document.head) {
      titleObserver.observe(document.head, { childList: true, subtree: true });
    }
  });

  onUnmounted(() => {
    if (displayMode === "extension") {
      chrome.runtime.onMessage.removeListener(handleExtensionPageContext);
      return;
    }
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", scheduleContextUpdate);
    window.removeEventListener("hashchange", scheduleContextUpdate);
    if (titleObserver) {
      titleObserver.disconnect();
    }
  });

  return {
    updateContext,
  };
}
