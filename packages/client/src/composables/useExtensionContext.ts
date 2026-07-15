import { onMounted, onUnmounted, ref } from "vue";
import type {
  OpenCodeSelectedElement,
  ServiceStatus,
} from "@vite-plugin-opencode-assistant/shared";
import { EXT_MSG, CONTEXT_API_PATH } from "@vite-plugin-opencode-assistant/shared";

/**
 * 扩展模式：通过 chrome.runtime 监听目标页面的 PAGE_CONTEXT 消息，
 * 按 serviceInstanceId + tabId 双重隔离，将目标页面 URL/标题发送到服务端。
 *
 * 多 Tab 场景：同一项目的多个 Tab 共享 serviceInstanceId，但 tabId 不同。
 * 通过维护 activeTabId 并仅接受当前活跃 Tab 的 PAGE_CONTEXT 来避免上下文串扰。
 */
export function useExtensionContext(
  serviceStatus: { value: ServiceStatus },
  selectedElements: { value: OpenCodeSelectedElement[] },
  viteBaseUrl = "",
  serviceInstanceId = "",
) {
  let currentPageUrl = "";
  let currentPageTitle = "";

  /** 当前活跃的 Tab ID，仅接受来自此 Tab 的 PAGE_CONTEXT */
  let activeTabId: number | undefined;

  const extensionPageUrl = ref("");
  const extensionPageTitle = ref("");

  const basePath = (path: string) => (viteBaseUrl ? `${viteBaseUrl}${path}` : path);

  const sendContext = (url: string, title: string) => {
    fetch(basePath(CONTEXT_API_PATH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title,
        tabId: activeTabId,
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

  const handleMessage = (msg: {
    type: string;
    serviceInstanceId?: string;
    tabId?: number;
    ctx?: { url: string; title: string };
  }) => {
    // 按 serviceInstanceId 过滤，仅处理来自当前服务实例的上下文消息
    if (msg.serviceInstanceId && msg.serviceInstanceId !== serviceInstanceId) return;

    // Tab 切换：更新 activeTabId
    if (msg.type === EXT_MSG.TAB_SWITCHED) {
      activeTabId = msg.tabId;
      return;
    }

    // 页面上下文：只接受当前活跃 Tab 的消息，避免多 Tab 串扰
    if (msg.type === EXT_MSG.PAGE_CONTEXT && msg.ctx) {
      if (activeTabId !== undefined && msg.tabId !== undefined && msg.tabId !== activeTabId) return;
      extensionPageUrl.value = msg.ctx.url;
      extensionPageTitle.value = msg.ctx.title;
      updateContext(true);
    }
  };

  onMounted(async () => {
    chrome.runtime.onMessage.addListener(handleMessage);
    // 初始化 activeTabId：Side Panel 刚加载时不会有 TAB_SWITCHED 消息，
    // 需要主动查询当前活跃 Tab，避免初始阶段接受非活跃 Tab 的上下文
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id !== undefined) {
        activeTabId = tabs[0].id;
      }
    } catch {
      /* 忽略查询失败 */
    }
  });

  onUnmounted(() => {
    chrome.runtime.onMessage.removeListener(handleMessage);
  });

  return { updateContext };
}
