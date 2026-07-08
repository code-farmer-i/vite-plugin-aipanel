import { EXT_MSG } from "@vite-plugin-opencode-assistant/shared";

/**
 * OpenCode Assistant - Side Panel
 *
 * 获取 Vite 插件端口 → monkey-patch fetch/EventSource → 挂载原始 App.vue
 * Tab 切换时通过显示/隐藏而非销毁重建，保持 iframe 状态
 */
console.log("[OpenCode SP] Side Panel 入口已加载");

import "@vite-plugin-opencode-assistant/client/styles.css";

const ports = { proxyPort: 0, vitePort: "" };

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

// === Monkey-patch: /__opencode_* → Vite server (webPort) ===
const _fetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  let url =
    typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
  if (ports.vitePort && url.startsWith("/__opencode")) {
    url = `http://127.0.0.1:${ports.vitePort}${url}`;
  }
  return _fetch(url, init);
};

const _ES = window.EventSource;
window.EventSource = class extends _ES {
  constructor(url: string | URL, config?: EventSourceInit) {
    const u = typeof url === "string" ? url : url.toString();
    if (ports.vitePort && u.startsWith("/__opencode")) {
      super(`http://127.0.0.1:${ports.vitePort}${u}`, config);
    } else {
      super(url, config);
    }
  }
} as typeof EventSource;

// === DOM 容器 ===
let appMounted = false;
let lastVitePort = "";
let noServiceEl: HTMLDivElement | null = null;
let appRootEl: HTMLDivElement | null = null;
let vueApp: ReturnType<(typeof import("vue"))["createApp"]> | null = null;

/** 创建无服务提示容器（Vue 组件将在 init 中异步挂载） */
function createNoServiceContainer(): HTMLDivElement {
  const div = document.createElement("div");
  div.id = "opencode-no-service-root";
  div.style.cssText = "display:none;width:100%;height:100%;";
  return div;
}

/** 显示/隐藏：服务页面 */
function showApp() {
  if (noServiceEl) noServiceEl.style.display = "none";
  if (appRootEl) appRootEl.style.display = "";
}

/** 显示/隐藏：无服务提示 */
function showNoServiceOverlay() {
  if (appRootEl) appRootEl.style.display = "none";
  if (noServiceEl) noServiceEl.style.display = "";
}

/** 初始化 DOM 容器（仅一次） */
async function initContainers() {
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style>`,
  );

  noServiceEl = createNoServiceContainer();
  document.body.appendChild(noServiceEl);

  // 挂载无服务提示 Vue 组件
  const { createApp } = await import("vue");
  const { default: NoServicePrompt } = await import("./NoServicePrompt.vue");
  createApp(NoServicePrompt, { onRefresh: mountApp }).mount(noServiceEl);

  appRootEl = document.createElement("div");
  appRootEl.id = "opencode-sidepanel-root";
  appRootEl.style.cssText = "display:none;width:100%;height:100%;";
  document.body.appendChild(appRootEl);
}

/** 创建 Vue 应用（仅首次），返回 true 表示成功检测到服务 */
async function mountApp(): Promise<boolean> {
  if (appMounted) return true;

  const info = await fetchPort();
  if (!info) {
    showNoServiceOverlay();
    return false;
  }
  ports.proxyPort = info.proxyPort;
  ports.vitePort = info.vitePort;
  lastVitePort = info.vitePort;

  console.log("[OpenCode SP] 端口已获取: vite=%s proxy=%d", ports.vitePort, ports.proxyPort);

  const { createApp } = await import("vue");
  const { default: App } = await import("@vite-plugin-opencode-assistant/client/App.vue");

  const config = {
    proxyPort: ports.proxyPort,
    proxyHost: "127.0.0.1",
    theme: "auto",
    hotkey: "",
    displayMode: "extension",
    open: true,
  };

  const app = createApp(App, { config });
  app.mount(appRootEl!);
  vueApp = app;
  showApp();
  appMounted = true;
  console.log("[OpenCode SP] App 已挂载");
  return true;
}

/** 根据端口是否变化决定重载 App 还是仅显示 */
function handleServiceSwitch(newVitePort: string, newProxyPort: number) {
  const portChanged = lastVitePort !== newVitePort;
  lastVitePort = newVitePort;
  ports.proxyPort = newProxyPort;
  ports.vitePort = newVitePort;

  if (portChanged && appMounted) {
    // 不同 Vite 服务 → 先正确卸载旧 Vue app，再重建
    vueApp?.unmount();
    vueApp = null;
    const oldApp = appRootEl;
    if (oldApp) {
      oldApp.style.display = "none";
    }
    appMounted = false;
    mountApp();
  } else {
    // 同一服务或首次 → 直接显示
    showApp();
  }
}

// === 初始化 ===
(async () => {
  await initContainers();
  mountApp();
})();

/** 监听 Tab 切换 → 显示/隐藏 */
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
