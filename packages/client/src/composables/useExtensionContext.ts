import { onMounted, onUnmounted, ref } from "vue";
import type { AIPanelSelectedElement, ServiceStatus } from "@aipanel/core";
import { EXT_MSG, CONTEXT_API_PATH, createLogger } from "@aipanel/core";

/**
 * 扩展模式：通过 chrome.runtime 监听目标页面的 PAGE_CONTEXT 消息，
 * 按 serviceInstanceId + tabId 双重隔离，将目标页面 URL/标题发送到服务端。
 *
 * 多 Tab 场景：同一项目的多个 Tab 共享 serviceInstanceId，但 tabId 不同。
 * 通过维护 activeTabId 并仅接受当前活跃 Tab 的 PAGE_CONTEXT 来避免上下文串扰。
 */
export function useExtensionContext(
  serviceStatus: { value: ServiceStatus },
  selectedElements: { value: AIPanelSelectedElement[] },
  viteBaseUrl = "",
  serviceInstanceId = "",
) {
  let currentPageUrl = "";
  let currentPageTitle = "";

  /** 当前活跃的 Tab ID，仅接受来自此 Tab 的 PAGE_CONTEXT */
  let activeTabId: number | undefined;
  /** 当前活跃 Tab 在标签栏的位置索引 */
  let activeTabIndex: number | undefined;

  const extensionPageUrl = ref("");
  const extensionPageTitle = ref("");
  const extensionSessionId = ref("");
  const log = createLogger("ExtCtx");

  const basePath = (path: string) => (viteBaseUrl ? `${viteBaseUrl}${path}` : path);

  const sendContext = (url: string, title: string) => {
    log.debug(`POST 上下文: tabId=${activeTabId} url=${url} title=${title}`);
    fetch(basePath(CONTEXT_API_PATH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title,
        sessionId: extensionSessionId.value,
        active: true,
        ...(activeTabId !== undefined ? { tabId: activeTabId } : {}),
        ...(activeTabIndex !== undefined ? { tabIndex: activeTabIndex } : {}),
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
    windowId?: number;
    ctx?: { url: string; title: string; sessionId?: string };
  }) => {
    // 按 serviceInstanceId 过滤，仅处理来自当前服务实例的上下文消息
    if (msg.serviceInstanceId && msg.serviceInstanceId !== serviceInstanceId) return;

    // Tab 切换：更新 activeTabId
    if (msg.type === EXT_MSG.TAB_SWITCHED) {
      log.debug(`activeTabId: ${activeTabId} → ${msg.tabId} (windowId=${msg.windowId})`);
      activeTabId = msg.tabId;
      return;
    }

    // 页面上下文：只接受当前活跃 Tab 的消息，避免多 Tab 串扰
    if (msg.type === EXT_MSG.PAGE_CONTEXT && msg.ctx) {
      const accepted =
        activeTabId === undefined || msg.tabId === undefined || msg.tabId === activeTabId;
      if (activeTabId === undefined && msg.tabId !== undefined) {
        activeTabId = msg.tabId;
      }
      if (!accepted) return;
      extensionPageUrl.value = msg.ctx.url;
      extensionPageTitle.value = msg.ctx.title;
      extensionSessionId.value = msg.ctx.sessionId || "";
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
        activeTabIndex = tabs[0].index;
        log.debug(
          `onMounted activeTabId=${activeTabId} tabIndex=${activeTabIndex} url=${tabs[0].url}`,
        );
        // 主动请求 Content Script 上报当前页面上下文（弥补挂载前的丢失）
        chrome.tabs.sendMessage(tabs[0].id, { type: EXT_MSG.REQUEST_PAGE_CONTEXT }).catch(() => {});
      } else {
        log.debug(`onMounted 未查询到活跃 Tab, tabs=${JSON.stringify(tabs)}`);
      }
    } catch (e) {
      log.debug(`onMounted 查询 Tab 失败: ${e}`);
    }
  });

  onUnmounted(() => {
    chrome.runtime.onMessage.removeListener(handleMessage);
  });

  return { updateContext };
}
