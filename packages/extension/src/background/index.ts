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

// ========== 按窗口追踪的服务状态 ==========

interface ServiceInfo {
  proxyPort: number;
  vitePort: string;
  projectRoot: string;
  serviceInstanceId: string;
  verbose?: boolean;
}

/** windowId → 该窗口的轮询目标 */
const targets = new Map<number, { origin: string }>();
/** windowId → 该窗口当前检测到的服务 */
const services = new Map<number, ServiceInfo>();
/** 当前焦点窗口 */
let activeWindowId: number | undefined;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ========== 轮询 ==========

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

/** 只轮询焦点窗口的 target */
async function tick() {
  if (activeWindowId === undefined) return;

  const target = targets.get(activeWindowId);
  const info = target ? await fetchService(target.origin) : null;
  updateServiceState(info, activeWindowId);
}

// ========== 状态更新（按窗口隔离） ==========

function updateServiceState(info: ServiceInfo | null, windowId: number) {
  const oldService = services.get(windowId);

  if (info) {
    const isNew = !oldService || info.serviceInstanceId !== oldService.serviceInstanceId;
    const portChanged =
      oldService &&
      info.serviceInstanceId === oldService.serviceInstanceId &&
      info.vitePort !== oldService.vitePort;

    if (isNew) {
      if (oldService) {
        chrome.runtime
          .sendMessage({ type: EXT_MSG.SERVICE_GONE, ...oldService, windowId })
          .catch(() => {});
      }
      services.set(windowId, info);
      chrome.runtime
        .sendMessage({ type: EXT_MSG.SERVICE_APPEARED, ...info, windowId })
        .catch(() => {});
      log.debug(`服务上线: ${info.serviceInstanceId} vite=${info.vitePort} win=${windowId}`);
    } else if (portChanged) {
      services.set(windowId, info);
      chrome.runtime
        .sendMessage({ type: EXT_MSG.SERVICE_APPEARED, ...info, windowId })
        .catch(() => {});
      log.debug(`服务端口变更: ${info.serviceInstanceId} vite=${info.vitePort}`);
    }
  } else if (oldService) {
    services.delete(windowId);
    chrome.runtime
      .sendMessage({ type: EXT_MSG.SERVICE_GONE, ...oldService, windowId })
      .catch(() => {});
    log.debug(`服务下线: ${oldService.serviceInstanceId} win=${windowId}`);
  }
}

// ========== 切换轮询目标 ==========

/** 根据 tab 信息更新该窗口的轮询目标 */
async function setWindowTarget(windowId: number, tabId?: number): Promise<void> {
  if (tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && isLocalHost(new URL(tab.url).hostname)) {
        targets.set(windowId, { origin: new URL(tab.url).origin });
        return;
      }
    } catch {
      // tab 不存在
    }
  }
  // tabId 未提供或非 localhost → 尝试找该窗口第一个 localhost 标签页
  try {
    const tabs = await chrome.tabs.query({ active: true, windowId });
    const localTab = tabs.find((t) => t.url && isLocalHost(new URL(t.url).hostname));
    if (localTab && localTab.url) {
      targets.set(windowId, { origin: new URL(localTab.url).origin });
      return;
    }
  } catch {
    // ignore
  }
  targets.delete(windowId);
}

// ========== Tab / 窗口切换 ==========

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  activeWindowId = windowId;
  await setWindowTarget(windowId, tabId);
  await tick();

  chrome.runtime
    .sendMessage({
      type: EXT_MSG.TAB_SWITCHED,
      portInfo: services.get(windowId) || null,
      tabId,
      windowId,
    })
    .catch(() => {});

  chrome.tabs.sendMessage(tabId, { type: EXT_MSG.REQUEST_PAGE_CONTEXT }).catch(() => {});
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (windowId === activeWindowId) return;

  activeWindowId = windowId;
  await setWindowTarget(windowId);
  await tick();

  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id) {
      chrome.runtime
        .sendMessage({
          type: EXT_MSG.TAB_SWITCHED,
          portInfo: services.get(windowId) || null,
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
      sendResponse((activeWindowId !== undefined ? services.get(activeWindowId) : null) || null);
    });
    return true;
  }

  return false;
});

// ========== 启动 ==========

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(tick, POLL_INTERVAL);
  log.debug("轮询已启动");
}

(async () => {
  const [win] = await chrome.windows.getAll({ windowTypes: ["normal"] });
  if (win?.id) {
    activeWindowId = win.id;
    await setWindowTarget(win.id);
  }
  await tick();
  startPolling();
})();
