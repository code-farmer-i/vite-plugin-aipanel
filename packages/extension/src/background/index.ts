/**
 * OpenCode Assistant - Background Service Worker
 *
 * 消息中转 + Tab 切换通知 + 图标点击 → Side Panel
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("[OpenCode Extension] 已安装");
});

/** 点击工具栏图标 → 打开 Side Panel */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

/** Tab 切换 → 通知 Side Panel 重新连接新 Tab 的服务 */
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const info = await chrome.tabs.sendMessage(tabId, { type: "GET_PORT_INFO" });
    chrome.runtime
      .sendMessage({
        type: "TAB_SWITCHED",
        portInfo: info || null,
        tabId,
      })
      .catch(() => {});
  } catch {
    chrome.runtime.sendMessage({ type: "TAB_SWITCHED", portInfo: null, tabId }).catch(() => {});
  }
});

/** 消息转发: PAGE_CONTEXT 从 content script → Side Panel */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PAGE_CONTEXT") {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});
