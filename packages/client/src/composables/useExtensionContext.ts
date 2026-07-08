import { onMounted, onUnmounted, ref } from "vue";
import type {
  OpenCodeSelectedElement,
  ServiceStatus,
} from "@vite-plugin-opencode-assistant/shared";
import { EXT_MSG, CONTEXT_API_PATH } from "@vite-plugin-opencode-assistant/shared";

/**
 * 扩展模式：通过 chrome.runtime 监听目标页面的 PAGE_CONTEXT 消息，
 * 按 serviceInstanceId 隔离，将目标页面 URL/标题发送到服务端
 */
export function useExtensionContext(
  serviceStatus: { value: ServiceStatus },
  selectedElements: { value: OpenCodeSelectedElement[] },
  viteBaseUrl = "",
  serviceInstanceId = "",
) {
  let currentPageUrl = "";
  let currentPageTitle = "";

  const extensionPageUrl = ref("");
  const extensionPageTitle = ref("");

  const basePath = (path: string) => viteBaseUrl ? `${viteBaseUrl}${path}` : path;

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
    const newUrl = extensionPageUrl.value;
    const newTitle = extensionPageTitle.value;
    if (!newUrl && !newTitle) return;
    if (force || newUrl !== currentPageUrl || newTitle !== currentPageTitle) {
      currentPageUrl = newUrl;
      currentPageTitle = newTitle;
      sendContext(newUrl, newTitle);
    }
  };

  const handlePageContext = (msg: { type: string; serviceInstanceId?: string; ctx?: { url: string; title: string } }) => {
    // 按 serviceInstanceId 过滤，仅处理来自当前服务实例的上下文消息
    if (msg.serviceInstanceId && msg.serviceInstanceId !== serviceInstanceId) return;
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
