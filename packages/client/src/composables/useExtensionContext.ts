import { onMounted, onUnmounted, ref } from "vue";
import type {
  OpenCodeSelectedElement,
  ServiceStatus,
} from "@vite-plugin-opencode-assistant/shared";
import { EXT_MSG, CONTEXT_API_PATH } from "@vite-plugin-opencode-assistant/shared";

/**
 * 扩展模式：通过 chrome.runtime 监听目标页面的 PAGE_CONTEXT 消息，
 * 将目标页面 URL/标题发送到服务端
 */
export function useExtensionContext(
  serviceStatus: { value: ServiceStatus },
  selectedElements: { value: OpenCodeSelectedElement[] },
) {
  let currentPageUrl = "";
  let currentPageTitle = "";

  const extensionPageUrl = ref("");
  const extensionPageTitle = ref("");

  const sendContext = (url: string, title: string) => {
    fetch(CONTEXT_API_PATH, {
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
    const newUrl = extensionPageUrl.value;
    const newTitle = extensionPageTitle.value;
    if (!newUrl && !newTitle) return; // 尚未收到 PAGE_CONTEXT 消息
    if (force || newUrl !== currentPageUrl || newTitle !== currentPageTitle) {
      currentPageUrl = newUrl;
      currentPageTitle = newTitle;
      sendContext(newUrl, newTitle);
    }
  };

  const handlePageContext = (msg: { type: string; ctx?: { url: string; title: string } }) => {
    if (msg.type === EXT_MSG.PAGE_CONTEXT && msg.ctx) {
      extensionPageUrl.value = msg.ctx.url;
      extensionPageTitle.value = msg.ctx.title;
      updateContext(true);
    }
  };

  onMounted(() => {
    chrome.runtime.onMessage.addListener(handlePageContext);
  });

  onUnmounted(() => {
    chrome.runtime.onMessage.removeListener(handlePageContext);
  });

  return { updateContext };
}
