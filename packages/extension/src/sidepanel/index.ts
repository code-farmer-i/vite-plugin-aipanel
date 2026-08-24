import { EXT_MSG, createLogger, setVerbose } from "@aipanel/core";

const log = createLogger("AIPanel SP");

/**
 * AIPanel Assistant - Side Panel
 *
 * 服务检测由 Background Service Worker 轮询 /__aipanel_start__ 完成。
 * SP 通过 SERVICE_APPEARED / SERVICE_GONE / TAB_SWITCHED 消息驱动实例生命周期。
 * 多实例通过 overflow:hidden + 定位偏移切换，不销毁不 display:none。
 */
log.info("Side Panel 入口已加载");

import "@aipanel/client/styles.css";

interface ServiceInfo {
  proxyPort: number;
  vitePort: string;
  projectRoot: string;
  serviceInstanceId: string;
  verbose?: boolean;
}

/** 从 Background 获取当前 active tab 的服务信息（触发立即轮询） */
async function fetchServiceInfo(): Promise<ServiceInfo | null> {
  try {
    return await chrome.runtime.sendMessage({ type: "FORCE_POLL" });
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
  div.id = "aipanel-sidepanel-wrapper";
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
  noServiceEl.id = "aipanel-no-service-root";
  noServiceEl.style.cssText = "position:absolute;top:0;left:-10000px;width:100%;height:100%;";
  wrapperEl.appendChild(noServiceEl);

  const { createApp } = await import("vue");
  const { default: NoServicePrompt } = await import("./NoServicePrompt.vue");
  createApp(NoServicePrompt, { onRefresh: () => mountAppForActiveTab() }).mount(noServiceEl);
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
  const { default: App } = await import("@aipanel/client/App.vue");

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
  log.info(`新 App 实例已创建: ${info.serviceInstanceId} vite=${info.vitePort}`);
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
  log.info(`App 实例已销毁: ${serviceInstanceId}`);

  if (activeServiceId === serviceInstanceId) {
    showNoServiceOverlay();
  }
}

/** 为当前 active tab 挂载 App（从 Background 获取服务信息） */
async function mountAppForActiveTab(): Promise<boolean> {
  const info = await fetchServiceInfo();
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
    // 已有实例：更新端口信息，清除 zombie 标记
    existingInst.vitePort = info.vitePort;
    existingInst.proxyPort = info.proxyPort;
    existingInst.zombie = false;
    if (existingInst.zombieTimer) {
      clearTimeout(existingInst.zombieTimer);
      existingInst.zombieTimer = null;
    }
    showApp(info.serviceInstanceId);
    log.info(`复用已有实例: ${info.serviceInstanceId} vite=${info.vitePort}`);
  } else {
    log.info(`创建新实例: ${info.serviceInstanceId} vite=${info.vitePort}`);
    createAppInstance(info).then(() => {
      showApp(info.serviceInstanceId);
    });
  }
}

/** 处理服务下线 */
function handleServiceGone(serviceInstanceId: string) {
  const inst = appInstances.get(serviceInstanceId);
  log.info(`handleServiceGone: ${serviceInstanceId} hasInstance=${!!inst}`);
  if (!inst || inst.zombie) return;

  inst.zombie = true;
  inst.zombieTimer = setTimeout(() => {
    destroyAppInstance(serviceInstanceId);
  }, 30000);
  log.info(`服务下线: ${serviceInstanceId} (30s后销毁)`);

  if (activeServiceId === serviceInstanceId) {
    showNoServiceOverlay();
  }
}

/** 处理 Tab 切换 */
function handleTabSwitched(info: ServiceInfo | null) {
  log.info(`handleTabSwitched info=${info?.serviceInstanceId || "null"}`);
  if (!info) {
    log.info("显示无服务覆盖层");
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
    log.info(`Side Panel 窗口 ID: ${myWindowId}`);
  } catch {
    log.warn("无法获取当前窗口 ID，多窗口隔离将不可用");
  }

  await initContainers();
  mountAppForActiveTab();
})();

/** 监听消息 */
chrome.runtime.onMessage.addListener((msg) => {
  // 跨窗口过滤：只处理当前窗口的消息
  if (myWindowId !== undefined && msg.windowId !== undefined && msg.windowId !== myWindowId) {
    return;
  }

  switch (msg.type) {
    case EXT_MSG.TAB_SWITCHED:
      log.info(
        `激活: windowId=${msg.windowId} tabId=${msg.tabId} sid=${msg.portInfo?.serviceInstanceId}`,
      );
      // 仅在 myWindowId 未初始化时从消息中获取窗口 ID
      if (myWindowId === undefined && msg.windowId !== undefined) {
        myWindowId = msg.windowId;
      }
      handleTabSwitched(msg.portInfo || null);
      break;

    case EXT_MSG.SERVICE_APPEARED:
      if (msg.serviceInstanceId && msg.proxyPort && msg.vitePort) {
        log.info(`服务上线: sid=${msg.serviceInstanceId}`);
        handleServiceAppeared({
          serviceInstanceId: msg.serviceInstanceId,
          vitePort: msg.vitePort,
          proxyPort: msg.proxyPort,
          projectRoot: msg.projectRoot || "",
        });
      }
      break;

    case EXT_MSG.SERVICE_GONE:
      log.info(
        `收到 SERVICE_GONE: sid=${msg.serviceInstanceId} msgWindowId=${msg.windowId} myWindowId=${myWindowId}`,
      );
      if (msg.serviceInstanceId) {
        handleServiceGone(msg.serviceInstanceId);
      }
      break;
  }
});
