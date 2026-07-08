import { EXT_MSG } from "@vite-plugin-opencode-assistant/shared";

/**
 * OpenCode Assistant - Side Panel
 *
 * 面板实例存活 = workspace 中 Vite 服务存活。
 * serviceInstanceId 作为唯一隔离键，通过 Content Script 健康检查驱动实例生命周期。
 * 多实例通过 overflow:hidden + 定位偏移切换，不销毁不 display:none，
 * 所有实例始终保持完整渲染和网络连接。
 */
console.log("[OpenCode SP] Side Panel 入口已加载");

import "@vite-plugin-opencode-assistant/client/styles.css";

interface ServiceInfo {
  proxyPort: number;
  vitePort: string;
  projectRoot: string;
  serviceInstanceId: string;
}

/** 从 content script 获取服务信息 */
async function fetchServiceInfo(): Promise<ServiceInfo | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) return null;
    const info = await chrome.tabs.sendMessage(tabs[0].id, { type: EXT_MSG.GET_PORT_INFO });
    if (info && info.serviceInstanceId && info.proxyPort && info.vitePort) return info;
    return null;
  } catch {
    return null;
  }
}

// === DOM 容器 ===
interface AppInstance {
  rootEl: HTMLDivElement;
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
    inst.rootEl.style.left = "-10000px";
  });
}

/** 显示指定 serviceInstanceId 对应的 App */
function showApp(serviceInstanceId: string) {
  const inst = appInstances.get(serviceInstanceId);
  if (inst) {
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

/** 选择下一个可用实例展示 */
function showNextAvailable() {
  for (const inst of appInstances.values()) {
    if (!inst.zombie) {
      showApp(inst.serviceInstanceId);
      return;
    }
  }
  showNoServiceOverlay();
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
  createApp(NoServicePrompt, { onRefresh: () => mountAppForActiveTab() }).mount(noServiceEl);
}

/** 为指定服务创建并挂载新的 Vue App */
async function createAppInstance(info: ServiceInfo): Promise<AppInstance> {
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
  };

  const app = createApp(App, { config });
  app.mount(rootEl);

  const inst: AppInstance = {
    rootEl,
    serviceInstanceId: info.serviceInstanceId,
    vitePort: info.vitePort,
    proxyPort: info.proxyPort,
    zombie: false,
    zombieTimer: null,
  };
  appInstances.set(info.serviceInstanceId, inst);
  console.log("[OpenCode SP] 新 App 实例已创建: %s vite=%s", info.serviceInstanceId, info.vitePort);
  return inst;
}

/** 销毁指定 App 实例 */
function destroyAppInstance(serviceInstanceId: string) {
  const inst = appInstances.get(serviceInstanceId);
  if (!inst) return;

  if (inst.zombieTimer) {
    clearTimeout(inst.zombieTimer);
    inst.zombieTimer = null;
  }

  // 卸载 Vue App
  inst.rootEl.innerHTML = "";
  inst.rootEl.remove();

  appInstances.delete(serviceInstanceId);
  console.log("[OpenCode SP] App 实例已销毁: %s", serviceInstanceId);

  // 如果销毁的是当前显示的实例，切换到下一个
  if (activeServiceId === serviceInstanceId) {
    showNextAvailable();
  }
}

/** 为当前 active tab 挂载 App */
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
    // 已有实例：更新端口信息（可能重启后换了端口），清除 zombie 标记
    existingInst.vitePort = info.vitePort;
    existingInst.proxyPort = info.proxyPort;
    existingInst.zombie = false;
    if (existingInst.zombieTimer) {
      clearTimeout(existingInst.zombieTimer);
      existingInst.zombieTimer = null;
    }
    showApp(info.serviceInstanceId);
    console.log("[OpenCode SP] 复用已有实例: %s vite=%s", info.serviceInstanceId, info.vitePort);
  } else {
    createAppInstance(info).then(() => {
      showApp(info.serviceInstanceId);
    });
  }
}

/** 处理服务下线 */
function handleServiceGone(serviceInstanceId: string) {
  const inst = appInstances.get(serviceInstanceId);
  if (!inst || inst.zombie) return;

  inst.zombie = true;
  inst.zombieTimer = setTimeout(() => {
    destroyAppInstance(serviceInstanceId);
  }, 3000);
  console.log("[OpenCode SP] 服务下线标记 zombie: %s (3s后销毁)", serviceInstanceId);

  // 如果当前显示的就是这个实例，切换到下一个可用
  if (activeServiceId === serviceInstanceId) {
    showNextAvailable();
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
  await initContainers();
  mountAppForActiveTab();
})();

/** 监听消息 */
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case EXT_MSG.TAB_SWITCHED:
      console.log("[OpenCode SP] Tab 切换:", msg.portInfo);
      handleTabSwitched(msg.portInfo || null);
      break;

    case EXT_MSG.SERVICE_APPEARED:
      if (msg.serviceInstanceId && msg.proxyPort && msg.vitePort) {
        console.log("[OpenCode SP] 服务上线: %s", msg.serviceInstanceId);
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
        console.log("[OpenCode SP] 服务下线: %s", msg.serviceInstanceId);
        handleServiceGone(msg.serviceInstanceId);
      }
      break;
  }
});
