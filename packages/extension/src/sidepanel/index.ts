import { EXT_MSG } from "@vite-plugin-opencode-assistant/shared";

/**
 * OpenCode Assistant - Side Panel
 *
 * 获取 Vite 插件端口 → 挂载原始 App.vue
 * 多 Vite 服务独立创建 Vue 实例，通过 overflow:hidden + 定位偏移切换，不销毁不 display:none，
 * 所有实例始终保持完整渲染和网络连接
 * 不再依赖全局 monkey-patch，每个实例通过配置的 vitePort 构建绝对 URL
 */
console.log("[OpenCode SP] Side Panel 入口已加载");

import "@vite-plugin-opencode-assistant/client/styles.css";

/** 从 content script 获取端口 */
async function fetchPort(): Promise<{ proxyPort: number; vitePort: string } | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) return null;
    const info = await chrome.tabs.sendMessage(tabs[0].id, { type: EXT_MSG.GET_PORT_INFO });
    console.log("[OpenCode SP] 端口信息:", info);
    if (info && info.proxyPort && info.vitePort) return info;
    return null;
  } catch {
    return null;
  }
}

// === DOM 容器 ===
interface AppInstance {
  rootEl: HTMLDivElement;
  vitePort: string;
}

/** vitePort → 已挂载的 App 实例 */
const appInstances = new Map<string, AppInstance>();
let wrapperEl: HTMLDivElement | null = null;
let noServiceEl: HTMLDivElement | null = null;
let activeVitePort: string | null = null;

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

/** 显示指定 vitePort 对应的 App */
function showApp(vitePort: string) {
  const inst = appInstances.get(vitePort);
  if (inst) {
    if (noServiceEl) noServiceEl.style.left = "-10000px";
    hideAllApps();
    inst.rootEl.style.left = "0";
    activeVitePort = vitePort;
  }
}

/** 显示无服务提示 */
function showNoServiceOverlay() {
  hideAllApps();
  if (noServiceEl) noServiceEl.style.left = "0";
  activeVitePort = null;
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

  // 挂载无服务提示 Vue 组件
  const { createApp } = await import("vue");
  const { default: NoServicePrompt } = await import("./NoServicePrompt.vue");
  createApp(NoServicePrompt, { onRefresh: () => mountAppForActiveTab() }).mount(noServiceEl);
}

/** 为指定端口创建并挂载新的 Vue App */
async function createAppInstance(vitePort: string, proxyPort: number): Promise<AppInstance> {
  const { createApp } = await import("vue");
  const { default: App } = await import("@vite-plugin-opencode-assistant/client/App.vue");

  const rootEl = document.createElement("div");
  rootEl.style.cssText = "position:absolute;top:0;left:-10000px;width:100%;height:100%;";
  wrapperEl!.appendChild(rootEl);

  const config = {
    proxyPort,
    proxyHost: "127.0.0.1",
    vitePort, // App 内部用此构建绝对 URL，不再依赖全局 monkey-patch
    theme: "auto",
    hotkey: "",
    displayMode: "extension",
    open: true,
  };

  const app = createApp(App, { config });
  app.mount(rootEl);

  const inst: AppInstance = { rootEl, vitePort };
  appInstances.set(vitePort, inst);
  console.log("[OpenCode SP] 新 App 实例已创建: vite=%s proxy=%d", vitePort, proxyPort);
  return inst;
}

/** 为当前 active tab 挂载 App */
async function mountAppForActiveTab(): Promise<boolean> {
  const info = await fetchPort();
  if (!info) {
    showNoServiceOverlay();
    return false;
  }

  if (appInstances.has(info.vitePort)) {
    showApp(info.vitePort);
    console.log("[OpenCode SP] 复用已有实例: vite=%s", info.vitePort);
  } else {
    await createAppInstance(info.vitePort, info.proxyPort);
    showApp(info.vitePort);
  }
  return true;
}

/** 处理服务切换 */
function handleServiceSwitch(newVitePort: string, newProxyPort: number) {
  if (activeVitePort === newVitePort) return;

  if (appInstances.has(newVitePort)) {
    showApp(newVitePort);
    console.log("[OpenCode SP] Tab 切换 → 已有服务: vite=%s", newVitePort);
  } else {
    createAppInstance(newVitePort, newProxyPort).then(() => {
      showApp(newVitePort);
    });
    console.log("[OpenCode SP] Tab 切换 → 新服务: vite=%s", newVitePort);
  }
}

// === 初始化 ===
(async () => {
  await initContainers();
  mountAppForActiveTab();
})();

/** 监听 Tab 切换 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === EXT_MSG.TAB_SWITCHED) {
    console.log("[OpenCode SP] Tab 切换:", msg.portInfo);
    if (msg.portInfo && msg.portInfo.proxyPort && msg.portInfo.vitePort) {
      handleServiceSwitch(msg.portInfo.vitePort, msg.portInfo.proxyPort);
    } else {
      showNoServiceOverlay();
    }
  }
});
