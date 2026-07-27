import { EXT_MSG, createLogger, setVerbose } from "@vite-plugin-opencode-assistant/shared";

const log = createLogger("OpenCode SP");

/**
 * OpenCode Assistant - Side Panel
 *
 * 面板实例存活 = workspace 中 Vite 服务存活。
 * serviceInstanceId 作为唯一隔离键，通过 Content Script 健康检查驱动实例生命周期。
 * 多实例通过 overflow:hidden + 定位偏移切换，不销毁不 display:none，
 * 所有实例始终保持完整渲染和网络连接。
 */
log.debug("Side Panel 入口已加载");

import "@vite-plugin-opencode-assistant/client/styles.css";

interface ServiceInfo {
  proxyPort: number;
  vitePort: string;
  projectRoot: string;
  serviceInstanceId: string;
  verbose?: boolean;
}

/** 从 content script 获取服务信息 */
async function fetchServiceInfo(forceRefresh = false): Promise<ServiceInfo | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) return null;
    const info = await chrome.tabs.sendMessage(tabs[0].id, {
      type: EXT_MSG.GET_PORT_INFO,
      forceRefresh,
    });
    if (info && info.serviceInstanceId && info.proxyPort && info.vitePort) return info;
    return null;
  } catch {
    return null;
  }
}

// === DOM 容器 ===
interface AppInstance {
  rootEl: HTMLDivElement;
  vueApp: ReturnType<typeof import("vue").createApp>;
  serviceInstanceId: string;
  vitePort: string;
  proxyPort: number;
  zombie: boolean;
  zombieTimer: ReturnType<typeof setTimeout> | null;
}

/** serviceInstanceId → 已挂载的 App 实例 */
const appInstances = new Map<string, AppInstance>();
let wrapperEl: HTMLDivElement | null = null;
let noServiceEl: HTMLDivElement | null = null;
let activeServiceId: string | null = null;
/** 当前 sidepanel 所属的窗口 ID，用于跨窗口消息过滤 */
let myWindowId: number | undefined;

/** 创建 wrapper 容器（overflow:hidden 确保所有实例保持渲染） */
function createWrapper(): HTMLDivElement {
  const div = document.createElement("div");
  div.id = "opencode-sidepanel-wrapper";
  div.style.cssText = "width:100%;height:100%;overflow:hidden;position:relative;";
  return div;
}

/** 隐藏所有 App（移到屏幕外，但保持完整渲染） */
function hideAllApps() {
  appInstances.forEach((inst) => {
    if (inst.rootEl) inst.rootEl.style.left = "-10000px";
  });
}

/** 显示指定 serviceInstanceId 对应的 App */
function showApp(serviceInstanceId: string) {
  const inst = appInstances.get(serviceInstanceId);
  if (inst && inst.rootEl) {
    if (noServiceEl) noServiceEl.style.left = "-10000px";
    hideAllApps();
    inst.rootEl.style.left = "0";
    activeServiceId = serviceInstanceId;
  }
}

/** 显示无服务提示 */
function showNoServiceOverlay() {
  hideAllApps();
  if (noServiceEl) noServiceEl.style.left = "0";
  activeServiceId = null;
}

/** 初始化 DOM 容器（仅一次） */
async function initContainers() {
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style>`,
  );

  wrapperEl = createWrapper();
  document.body.appendChild(wrapperEl);

  noServiceEl = document.createElement("div");
  noServiceEl.id = "opencode-no-service-root";
  noServiceEl.style.cssText = "position:absolute;top:0;left:-10000px;width:100%;height:100%;";
  wrapperEl.appendChild(noServiceEl);

  const { createApp } = await import("vue");
  const { default: NoServicePrompt } = await import("./NoServicePrompt.vue");
  createApp(NoServicePrompt, { onRefresh: () => mountAppForActiveTab(true) }).mount(noServiceEl);
}

/** 为指定服务创建并挂载新的 Vue App */
async function createAppInstance(info: ServiceInfo): Promise<AppInstance> {
  // 立即占位，防止并发 SERVICE_APPEARED 重复创建
  const placeholder: AppInstance = {
    rootEl: null!,
    vueApp: null!,
    serviceInstanceId: info.serviceInstanceId,
    vitePort: info.vitePort,
    proxyPort: info.proxyPort,
    zombie: false,
    zombieTimer: null,
  };
  appInstances.set(info.serviceInstanceId, placeholder);

  const { createApp } = await import("vue");
  const { default: App } = await import("@vite-plugin-opencode-assistant/client/App.vue");

  const rootEl = document.createElement("div");
  rootEl.style.cssText = "position:absolute;top:0;left:-10000px;width:100%;height:100%;";
  wrapperEl!.appendChild(rootEl);

  const config = {
    proxyPort: info.proxyPort,
    proxyHost: "127.0.0.1",
    vitePort: info.vitePort,
    serviceInstanceId: info.serviceInstanceId,
    projectRoot: info.projectRoot,
    theme: "auto",
    hotkey: "",
    displayMode: "extension",
    open: true,
    verbose: info.verbose,
    myWindowId,
  };

  if (info.verbose) {
    setVerbose(true);
  }

  const app = createApp(App, { config });
  app.mount(rootEl);

  const inst: AppInstance = {
    rootEl,
    vueApp: app,
    serviceInstanceId: info.serviceInstanceId,
    vitePort: info.vitePort,
    proxyPort: info.proxyPort,
    zombie: false,
    zombieTimer: null,
  };
  appInstances.set(info.serviceInstanceId, inst);
  log.debug(`新 App 实例已创建: ${info.serviceInstanceId} vite=${info.vitePort}`);
  return inst;
}

/** 销毁指定 App 实例 */
function destroyAppInstance(serviceInstanceId: string) {
  const inst = appInstances.get(serviceInstanceId);
  if (!inst || !inst.rootEl) return;

  if (inst.zombieTimer) {
    clearTimeout(inst.zombieTimer);
    inst.zombieTimer = null;
  }

  inst.vueApp.unmount();
  inst.rootEl.remove();

  appInstances.delete(serviceInstanceId);
  log.debug(`App 实例已销毁: ${serviceInstanceId}`);

  if (activeServiceId === serviceInstanceId) {
    showNoServiceOverlay();
  }
}

/** 为当前 active tab 挂载 App */
async function mountAppForActiveTab(forceRefresh = false): Promise<boolean> {
  if (forceRefresh) {
    // 主动注入 content script，确保其已加载到页面中（无需刷新页面）
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId) {
      await chrome.scripting
        .executeScript({
          target: { tabId },
          files: ["content.js"],
        })
        .catch(() => {
          // content script 可能已注入（INIT_MARKER 守卫会跳过），忽略错误
        });
    }
  }

  const info = await fetchServiceInfo(forceRefresh);
  if (!info) {
    showNoServiceOverlay();
    return false;
  }

  handleServiceAppeared(info);
  return true;
}

/** 处理服务上线 */
function handleServiceAppeared(info: ServiceInfo) {
  const existingInst = appInstances.get(info.serviceInstanceId);

  if (existingInst) {
    // 已有实例：更新端口信息（可能重启后换了端口），清除 zombie 标记
    existingInst.vitePort = info.vitePort;
    existingInst.proxyPort = info.proxyPort;
    existingInst.zombie = false;
    if (existingInst.zombieTimer) {
      clearTimeout(existingInst.zombieTimer);
      existingInst.zombieTimer = null;
    }
    // 只显示 App 如果当前 active tab 仍能检测到该服务
    showAppIfActiveTabMatches(info.serviceInstanceId);
    log.debug(`复用已有实例: ${info.serviceInstanceId} vite=${info.vitePort}`);
  } else {
    log.debug(`创建新实例: ${info.serviceInstanceId} vite=${info.vitePort}`);
    createAppInstance(info).then(() => {
      showAppIfActiveTabMatches(info.serviceInstanceId);
    });
  }
}

/** 仅在当前 active tab 匹配指定服务时才显示 App，否则保持 NoServicePrompt */
function showAppIfActiveTabMatches(serviceInstanceId: string) {
  fetchServiceInfo().then((currentInfo) => {
    if (currentInfo && currentInfo.serviceInstanceId === serviceInstanceId) {
      showApp(serviceInstanceId);
    }
  });
}

/** 处理服务下线 */
function handleServiceGone(serviceInstanceId: string) {
  const inst = appInstances.get(serviceInstanceId);
  if (!inst || inst.zombie) return;

  inst.zombie = true;
  inst.zombieTimer = setTimeout(() => {
    destroyAppInstance(serviceInstanceId);
  }, 30000);
  log.debug(`服务下线: ${serviceInstanceId} (30s后销毁)`);

  if (activeServiceId === serviceInstanceId) {
    showNoServiceOverlay();
  }
}

/** 处理 Tab 切换 */
function handleTabSwitched(info: ServiceInfo | null) {
  if (!info) {
    showNoServiceOverlay();
    return;
  }

  handleServiceAppeared(info);
}

// === 初始化 ===
(async () => {
  // 获取当前 sidepanel 所属窗口 ID，用于过滤跨窗口消息
  try {
    const currentWin = await chrome.windows.getCurrent();
    myWindowId = currentWin.id;
    log.debug(`Side Panel 窗口 ID: ${myWindowId}`);
  } catch {
    log.warn("无法获取当前窗口 ID，多窗口隔离将不可用");
  }

  await initContainers();
  mountAppForActiveTab();
})();

/** 监听消息 */
chrome.runtime.onMessage.addListener((msg) => {
  if (
    msg.type !== EXT_MSG.TAB_SWITCHED &&
    myWindowId !== undefined &&
    msg.windowId !== undefined &&
    msg.windowId !== myWindowId
  ) {
    return;
  }

  switch (msg.type) {
    case EXT_MSG.TAB_SWITCHED:
      log.debug(
        `[SP] 激活: windowId=${msg.windowId} tabId=${msg.tabId} sid=${msg.portInfo?.serviceInstanceId}`,
      );
      if (msg.windowId !== undefined) {
        myWindowId = msg.windowId;
      }
      handleTabSwitched(msg.portInfo || null);
      break;

    case EXT_MSG.SERVICE_APPEARED:
      if (msg.serviceInstanceId && msg.proxyPort && msg.vitePort) {
        log.debug(`[SP] 服务上线: sid=${msg.serviceInstanceId}`);
        handleServiceAppeared({
          serviceInstanceId: msg.serviceInstanceId,
          vitePort: msg.vitePort,
          proxyPort: msg.proxyPort,
          projectRoot: msg.projectRoot || "",
        });
      }
      break;

    case EXT_MSG.SERVICE_GONE:
      if (msg.serviceInstanceId) {
        log.debug(`服务下线: ${msg.serviceInstanceId}`);
        handleServiceGone(msg.serviceInstanceId);
      }
      break;
  }
});
