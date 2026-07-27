import { EXT_MSG, EXT_BROADCAST, createLogger } from "@vite-plugin-opencode-assistant/shared";

const log = createLogger("OpenCode BG");
const BROADCAST_TYPES = new Set<string>(Object.values(EXT_BROADCAST));

/**
 * OpenCode Assistant - Background Service Worker
 *
 * 消息中转 + Tab 切换通知 + 图标点击 → Side Panel
 */

/** 记录有服务的 windowId 集合，只响应这些窗口内的 Tab 切换 */
const serviceWindowIds = new Set<number>();

chrome.runtime.onInstalled.addListener(() => {
  log.info("已安装");
});

/** 点击工具栏图标 → 打开 Side Panel */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

/** Tab 切换 → 通知 Side Panel 重新连接新 Tab 的服务 + 请求新 Tab 上报页面上下文 */
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  log.debug(
    `onActivated: tabId=${tabId} windowId=${windowId} serviceWindowIds=[${[...serviceWindowIds]}]`,
  );
  // 只响应服务所在窗口的 Tab 切换，忽略其他窗口（DevTools/CDP 等）
  if (serviceWindowIds.size > 0 && !serviceWindowIds.has(windowId)) return;

  try {
    const info = await chrome.tabs.sendMessage(tabId, { type: EXT_MSG.GET_PORT_INFO });
    chrome.runtime
      .sendMessage({
        type: EXT_MSG.TAB_SWITCHED,
        portInfo: info || null,
        tabId,
        windowId,
      })
      .catch(() => {});
    // 请求新激活的 Tab 立即上报当前页面上下文，避免使用过期数据
    chrome.tabs.sendMessage(tabId, { type: EXT_MSG.REQUEST_PAGE_CONTEXT }).catch(() => {});
  } catch {
    chrome.runtime
      .sendMessage({ type: EXT_MSG.TAB_SWITCHED, portInfo: null, tabId, windowId })
      .catch(() => {});
  }
});

/** 消息转发到 Side Panel（EXT_BROADCAST 中的类型自动转发，并附加 sender tabId 用于多 Tab 隔离） */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content Script 查询自身 windowId（sender.tab.windowId 即该 CS 所在窗口）
  if (msg.type === EXT_MSG.CS_QUERY_WINDOW) {
    sendResponse({ windowId: sender.tab?.windowId });
    return true;
  }

  if (BROADCAST_TYPES.has(msg.type)) {
    // 附加 tabId 和 windowId 以便 Side Panel 区分来自哪个窗口的消息
    // 优先使用 sender.tab 的 windowId，若不存在则保留 msg 中已有的（如 extension page 主动发送的）
    const forwarded = {
      ...msg,
      tabId: sender.tab?.id ?? msg.tabId,
      windowId: sender.tab?.windowId ?? msg.windowId,
    };
    log.debug(`转发消息: type=${msg.type} tabId=${forwarded.tabId} windowId=${forwarded.windowId}`);
    chrome.runtime.sendMessage(forwarded).catch(() => {});
  }

  // 记录/移除服务所在的 windowId
  if (msg.type === EXT_MSG.SERVICE_APPEARED && sender.tab?.windowId != null) {
    serviceWindowIds.add(sender.tab.windowId);
  }
  if (msg.type === EXT_MSG.SERVICE_GONE && sender.tab?.windowId != null) {
    serviceWindowIds.delete(sender.tab.windowId);
  }

  return false;
});
