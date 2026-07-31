import {
  EXT_MSG,
  EXT_BROADCAST,
  START_API_PATH,
  createLogger,
} from "@vite-plugin-opencode-assistant/shared";

const log = createLogger("OpenCode BG");

/** 需要从 Content Script 转发到 Side Panel 的消息类型 */
const FORWARD_TYPES = new Set<string>([EXT_BROADCAST.PAGE_CONTEXT, EXT_BROADCAST.THEME_CHANGE]);

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 2000;

// ========== 工具 ==========

function isLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
  return /^(10\.\d{1,3}\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(hostname);
}

// ========== 状态 ==========
//
// 核心原则：服务是独立实体（由 serviceInstanceId 标识），不绑定到窗口或 Tab。
// Tab 只是"指向"某个服务 — 多个 Tab 可指向同一服务，也可不指向任何服务。

interface ServiceInfo {
  proxyPort: number;
  vitePort: string;
  projectRoot: string;
  serviceInstanceId: string;
  verbose?: boolean;
}

/** 所有已知的服务（serviceInstanceId → 服务信息），独立于 Tab/窗口 */
const services = new Map<string, ServiceInfo>();

/** tabId → 该 Tab 当前指向的 serviceInstanceId */
const tabService = new Map<number, string>();

/** windowId → 该窗口当前活跃的 tabId */
const activeTabs = new Map<number, number>();

/** 当前焦点窗口 */
let activeWindowId: number | undefined;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ========== 服务检测 ==========

async function fetchService(origin: string): Promise<ServiceInfo | null> {
  try {
    const res = await fetch(`${origin}${START_API_PATH}`);
    const data = await res.json();
    if (data.proxyPort && data.serviceInstanceId) {
      return {
        proxyPort: data.proxyPort,
        vitePort: data.vitePort || String(new URL(origin).port),
        projectRoot: data.projectRoot || "",
        serviceInstanceId: data.serviceInstanceId,
        verbose: data.verbose,
      };
    }
  } catch {
    // 无服务或网络错误
  }
  return null;
}

/** 轮询指定 Tab 上的服务端点 */
async function pollTab(tabId: number): Promise<ServiceInfo | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !isLocalHost(new URL(tab.url).hostname)) {
      return null;
    }
    return await fetchService(new URL(tab.url).origin);
  } catch {
    return null;
  }
}

/** 获取当前活跃窗口活跃 Tab 的服务信息 */
function getActiveService(): ServiceInfo | null {
  if (activeWindowId === undefined) return null;
  const tabId = activeTabs.get(activeWindowId);
  if (tabId === undefined) return null;
  const sid = tabService.get(tabId);
  return sid ? (services.get(sid) ?? null) : null;
}

/** 统计某个服务被多少个 Tab 引用 */
function countTabsForService(serviceInstanceId: string): number {
  let count = 0;
  for (const [, sid] of tabService) {
    if (sid === serviceInstanceId) count++;
  }
  return count;
}

// ========== 状态更新与广播 ==========

/**
 * 更新活跃 Tab 的服务映射。
 * 仅在以下情况广播消息：
 *  - 新服务出现（之前不知道这个 serviceInstanceId）→ SERVICE_APPEARED
 *  - 服务端口变更 → SERVICE_APPEARED
 *  - 服务从活跃 Tab 消失且无其他 Tab 引用 → SERVICE_GONE
 */
function updateActiveTabService(tabId: number, windowId: number, info: ServiceInfo | null): void {
  const oldSid = tabService.get(tabId);

  if (info) {
    const known = services.get(info.serviceInstanceId);
    const isNewService = !known;
    const portChanged = known && known.vitePort !== info.vitePort;

    // 更新全局服务注册表
    services.set(info.serviceInstanceId, info);
    // 更新 Tab → 服务映射（会覆盖 tabId 之前指向的旧服务）
    tabService.set(tabId, info.serviceInstanceId);

    // 清理被此 Tab 替换掉的旧服务（如 Tab 导航到另一个 localhost 服务）
    if (oldSid && oldSid !== info.serviceInstanceId && countTabsForService(oldSid) === 0) {
      const oldInfo = services.get(oldSid);
      services.delete(oldSid);
      if (oldInfo) {
        chrome.runtime
          .sendMessage({ type: EXT_MSG.SERVICE_GONE, ...oldInfo, windowId })
          .catch(() => {});
        log.info(`服务下线（Tab 导航离开）: ${oldSid} tab=${tabId} win=${windowId}`);
      }
    }

    if (isNewService) {
      chrome.runtime
        .sendMessage({ type: EXT_MSG.SERVICE_APPEARED, ...info, windowId })
        .catch(() => {});
      log.info(
        `服务上线: ${info.serviceInstanceId} vite=${info.vitePort} tab=${tabId} win=${windowId}`,
      );
    } else if (portChanged) {
      chrome.runtime
        .sendMessage({ type: EXT_MSG.SERVICE_APPEARED, ...info, windowId })
        .catch(() => {});
      log.info(`服务端口变更: ${info.serviceInstanceId} vite=${info.vitePort}`);
    }
  } else {
    // 活跃 Tab 上无服务
    if (oldSid) {
      tabService.delete(tabId);

      // 检查该服务是否还被其他 Tab 引用
      if (countTabsForService(oldSid) === 0) {
        const oldInfo = services.get(oldSid);
        services.delete(oldSid);
        if (oldInfo) {
          chrome.runtime
            .sendMessage({ type: EXT_MSG.SERVICE_GONE, ...oldInfo, windowId })
            .catch(() => {});
          log.info(`服务下线: ${oldSid} tab=${tabId} win=${windowId}`);
        }
      }
    }
  }
}

// ========== 轮询 ==========

async function tick(): Promise<void> {
  if (activeWindowId === undefined) return;
  const tabId = activeTabs.get(activeWindowId);
  if (tabId === undefined) return;

  const info = await pollTab(tabId);
  updateActiveTabService(tabId, activeWindowId, info);
}

// ========== Tab 激活 ==========

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  activeWindowId = windowId;
  activeTabs.set(windowId, tabId);

  // 轮询新活跃 Tab
  const info = await pollTab(tabId);
  updateActiveTabService(tabId, windowId, info);

  // 通知 Side Panel
  chrome.runtime
    .sendMessage({
      type: EXT_MSG.TAB_SWITCHED,
      portInfo: getActiveService(),
      tabId,
      windowId,
    })
    .catch(() => {});

  chrome.tabs.sendMessage(tabId, { type: EXT_MSG.REQUEST_PAGE_CONTEXT }).catch(() => {});
});

// ========== 窗口焦点变化 ==========

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (windowId === activeWindowId) return;

  activeWindowId = windowId;

  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id) {
      activeTabs.set(windowId, tab.id);

      const info = await pollTab(tab.id);
      updateActiveTabService(tab.id, windowId, info);

      chrome.runtime
        .sendMessage({
          type: EXT_MSG.TAB_SWITCHED,
          portInfo: getActiveService(),
          tabId: tab.id,
          windowId,
        })
        .catch(() => {});

      chrome.tabs.sendMessage(tab.id, { type: EXT_MSG.REQUEST_PAGE_CONTEXT }).catch(() => {});
    }
  } catch {
    // ignore
  }
});

// ========== Tab URL 变更 ==========

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  // 只处理当前活跃窗口的活跃 Tab
  if (tab.windowId !== activeWindowId) return;
  if (tabId !== activeTabs.get(tab.windowId)) return;

  const newOrigin = new URL(changeInfo.url).origin;
  const oldSid = tabService.get(tabId);

  // 同 origin 路径切换 — 无需重新轮询
  if (oldSid) {
    const oldInfo = services.get(oldSid);
    const oldOrigin = oldInfo ? `http://127.0.0.1:${oldInfo.vitePort}` : null;
    if (oldOrigin && new URL(oldOrigin).origin === newOrigin) {
      return;
    }
  }

  log.info(`[onUpdated] URL 变更: ${changeInfo.url} tab=${tabId}`);

  const info = isLocalHost(new URL(changeInfo.url).hostname) ? await fetchService(newOrigin) : null;
  updateActiveTabService(tabId, tab.windowId, info);

  chrome.runtime
    .sendMessage({
      type: EXT_MSG.TAB_SWITCHED,
      portInfo: getActiveService(),
      tabId,
      windowId: tab.windowId,
    })
    .catch(() => {});
});

// ========== Tab 关闭 ==========

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const oldSid = tabService.get(tabId);
  tabService.delete(tabId);

  // 更新活跃 Tab 记录
  if (activeTabs.get(removeInfo.windowId) === tabId) {
    activeTabs.delete(removeInfo.windowId);
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId: removeInfo.windowId });
      if (tab?.id) {
        activeTabs.set(removeInfo.windowId, tab.id);

        const info = await pollTab(tab.id);
        updateActiveTabService(tab.id, removeInfo.windowId, info);
      }
    } catch {
      // ignore
    }
  }

  // 被关闭 Tab 上的服务若无其他 Tab 引用，广播下线
  if (oldSid && countTabsForService(oldSid) === 0) {
    const oldInfo = services.get(oldSid);
    services.delete(oldSid);
    if (oldInfo) {
      chrome.runtime
        .sendMessage({ type: EXT_MSG.SERVICE_GONE, ...oldInfo, windowId: removeInfo.windowId })
        .catch(() => {});
      log.info(`服务下线（Tab 关闭）: ${oldSid} tab=${tabId}`);
    }
  }

  // 通知 Side Panel
  if (removeInfo.windowId === activeWindowId) {
    chrome.runtime
      .sendMessage({
        type: EXT_MSG.TAB_SWITCHED,
        portInfo: getActiveService(),
        tabId,
        windowId: removeInfo.windowId,
      })
      .catch(() => {});
  }
});

// ========== 窗口关闭 ==========

chrome.windows.onRemoved.addListener(async (windowId) => {
  activeTabs.delete(windowId);

  if (windowId !== activeWindowId) return;

  // 切换到另一个活着的窗口
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const nextWin = windows.find((w) => w.id !== windowId && w.id !== undefined);
    if (nextWin?.id) {
      activeWindowId = nextWin.id;
      try {
        const [tab] = await chrome.tabs.query({ active: true, windowId: nextWin.id });
        if (tab?.id) {
          activeTabs.set(nextWin.id, tab.id);

          const info = await pollTab(tab.id);
          updateActiveTabService(tab.id, nextWin.id, info);

          chrome.runtime
            .sendMessage({
              type: EXT_MSG.TAB_SWITCHED,
              portInfo: getActiveService(),
              tabId: tab.id,
              windowId: nextWin.id,
            })
            .catch(() => {});
        }
      } catch {
        // ignore
      }
      return;
    }
  } catch {
    // ignore
  }

  activeWindowId = undefined;
});

// ========== 生命周期 ==========

chrome.runtime.onInstalled.addListener(() => {
  log.info("已安装");
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

// ========== 消息处理 ==========

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (FORWARD_TYPES.has(msg.type)) {
    const forwarded = {
      ...msg,
      tabId: sender.tab?.id ?? msg.tabId,
      windowId: sender.tab?.windowId ?? msg.windowId,
    };
    chrome.runtime.sendMessage(forwarded).catch(() => {});
    return false;
  }

  if (msg.type === "FORCE_POLL") {
    tick().then(() => {
      sendResponse(getActiveService());
    });
    return true;
  }

  return false;
});

// ========== 启动 ==========

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(tick, POLL_INTERVAL);
  log.info("轮询已启动");
}

(async () => {
  const [win] = await chrome.windows.getAll({ windowTypes: ["normal"] });
  if (win?.id) {
    activeWindowId = win.id;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (tab?.id) {
        activeTabs.set(win.id, tab.id);
        const info = await pollTab(tab.id);
        updateActiveTabService(tab.id, win.id, info);
      }
    } catch {
      // ignore
    }
  }
  await tick();
  startPolling();
})();
