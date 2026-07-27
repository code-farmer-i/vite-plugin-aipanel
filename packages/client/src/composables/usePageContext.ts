import { onMounted, onUnmounted } from "vue";
import type {
  OpenCodeSelectedElement,
  ServiceStatus,
} from "@vite-plugin-opencode-assistant/shared";
import { CONTEXT_API_PATH } from "@vite-plugin-opencode-assistant/shared";

/**
 * 非扩展模式：监听当前页面的 URL/标题变化，发送上下文到服务端
 */
export function usePageContext(
  serviceStatus: { value: ServiceStatus },
  selectedElements: { value: OpenCodeSelectedElement[] },
  viteBaseUrl = "",
) {
  let currentPageUrl = "";
  let currentPageTitle = "";
  const basePath = (path: string) => (viteBaseUrl ? `${viteBaseUrl}${path}` : path);

  const sendContext = (url: string, title: string) => {
    fetch(basePath(CONTEXT_API_PATH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title,
        selectedElements: selectedElements.value,
      }),
    }).catch(() => {});
  };

  const updateContext = (force = false) => {
    if (serviceStatus.value === "idle") return;
    const newUrl = window.location.href;
    const newTitle = document.title;
    if (force || newUrl !== currentPageUrl || newTitle !== currentPageTitle) {
      currentPageUrl = newUrl;
      currentPageTitle = newTitle;
      sendContext(newUrl, newTitle);
    }
  };

  const scheduleContextUpdate = () => {
    requestAnimationFrame(() => updateContext());
  };

  let titleObserver: MutationObserver | null = null;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  onMounted(() => {
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
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", scheduleContextUpdate);
    window.removeEventListener("hashchange", scheduleContextUpdate);
    if (titleObserver) {
      titleObserver.disconnect();
    }
  });

  return { updateContext };
}
