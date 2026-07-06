/**
 * OpenCode Assistant - Side Panel
 *
 * 获取 Vite 插件端口 → monkey-patch fetch/EventSource → 挂载原始 App.vue
 * Tab 切换时通过显示/隐藏而非销毁重建，保持 iframe 状态
 */
console.log("[OpenCode SP] Side Panel 入口已加载");

const ports = { proxyPort: 0, vitePort: "" };

/** 从 content script 获取端口 */
async function fetchPort(): Promise<{ proxyPort: number; vitePort: string } | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) return null;
    const info = await chrome.tabs.sendMessage(tabs[0].id, { type: "GET_PORT_INFO" });
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

/** 创建无服务提示 DOM（只创建一次） */
function createNoServiceEl(): HTMLDivElement {
  const div = document.createElement("div");
  div.id = "opencode-no-service-root";
  div.innerHTML = `
    <style>
      .opencode-no-service {
        --ns-bg: #f8f9fa;
        --ns-card-bg: #fff;
        --ns-card-shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06);
        --ns-title: #1a1a1a;
        --ns-text: #4b5563;
        --ns-sub: #6b7280;
        --ns-hint: #9ca3af;
        --ns-code-bg: #e5e7eb;
        --ns-code: #3b82f6;
        --ns-border: #e5e7eb;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 32px 24px;
        text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--ns-bg);
        color-scheme: light dark;
      }
      @media (prefers-color-scheme: dark) {
        .opencode-no-service {
          --ns-bg: #1a1a1a;
          --ns-card-bg: #252525;
          --ns-card-shadow: 0 1px 3px rgba(0,0,0,.3);
          --ns-title: #f3f4f6;
          --ns-text: #d1d5db;
          --ns-sub: #9ca3af;
          --ns-hint: #6b7280;
          --ns-code-bg: #333;
          --ns-code: #60a5fa;
          --ns-border: #333;
        }
      }
      .opencode-no-service-icon {
        margin-bottom: 24px;
        opacity: .6;
        animation: opencode-ns-float 3s ease-in-out infinite;
      }
      @keyframes opencode-ns-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      .opencode-no-service-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--ns-title);
        margin: 0 0 8px;
        letter-spacing: -.01em;
      }
      .opencode-no-service-desc {
        font-size: 14px;
        color: var(--ns-sub);
        margin: 0 0 28px;
        line-height: 1.5;
      }
      .opencode-no-service-card {
        background: var(--ns-card-bg);
        border: 1px solid var(--ns-border);
        border-radius: 10px;
        padding: 18px 28px;
        box-shadow: var(--ns-card-shadow);
        max-width: 360px;
      }
      .opencode-no-service-card p {
        font-size: 13px;
        color: var(--ns-text);
        margin: 0 0 8px;
        line-height: 1.6;
      }
      .opencode-no-service-card p:last-child { margin-bottom: 0; }
      .opencode-no-service-card code {
        background: var(--ns-code-bg);
        color: var(--ns-code);
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
      }
      .opencode-no-service-hint {
        font-size: 13px;
        color: var(--ns-hint);
        margin: 0;
      }
    </style>
    <div class="opencode-no-service">
      <div class="opencode-no-service-icon">
        <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="64" height="64">
          <defs><linearGradient id="ns-g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#667eea"/><stop offset="100%" style="stop-color:#764ba2"/></linearGradient></defs>
          <path d="M512 981.33H85.34c-15.85 0-30.38-8.77-37.77-22.81a42.624 42.624 0 0 1 2.6-44.02L135 791.08C75.25 710.5 42.67 612.6 42.67 512 42.67 253.21 253.21 42.67 512 42.67S981.34 253.21 981.34 512 770.8 981.33 512 981.33zM166.44 896H512c211.73 0 384-172.27 384-384S723.73 128 512 128 128 300.27 128 512c0 91.29 32.83 179.9 92.46 249.46 12.58 14.69 13.73 36 2.77 51.94L166.44 896z" fill="url(#ns-g)"/>
          <path d="M384 448m-64 0a64 64 0 1 0 128 0 64 64 0 1 0 -128 0Z" fill="url(#ns-g)"/>
          <path d="M640 448m-64 0a64 64 0 1 0 128 0 64 64 0 1 0 -128 0Z" fill="url(#ns-g)"/>
        </svg>
      </div>
      <h2 class="opencode-no-service-title">OpenCode Assistant</h2>
      <p class="opencode-no-service-desc">当前页面未检测到 OpenCode 助手服务</p>
      <div class="opencode-no-service-card">
        <p>请打开使用 <code>vite-plugin-opencode-assistant</code> 的 localhost 页面</p>
        <p class="opencode-no-service-hint">例如：<code>http://localhost:5173</code></p>
      </div>
    </div>`;
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
function initContainers() {
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style>`,
  );

  noServiceEl = createNoServiceEl();
  document.body.appendChild(noServiceEl);

  appRootEl = document.createElement("div");
  appRootEl.id = "opencode-sidepanel-root";
  appRootEl.style.cssText = "display:none;width:100%;height:100%;";
  document.body.appendChild(appRootEl);
}

/** 创建 Vue 应用（仅首次） */
async function mountApp() {
  if (appMounted) return;

  const info = await fetchPort();
  if (!info) {
    showNoServiceOverlay();
    return;
  }
  ports.proxyPort = info.proxyPort;
  ports.vitePort = info.vitePort;

  console.log("[OpenCode SP] 端口已获取: vite=%s proxy=%d", ports.vitePort, ports.proxyPort);

  const { createApp } = await import("vue");
  const { default: App } = await import("@opencode-client/App.vue");

  const config = {
    proxyPort: ports.proxyPort,
    proxyHost: "127.0.0.1",
    theme: "auto",
    hotkey: "",
    displayMode: "extension",
    open: true,
  };

  createApp(App, { config }).mount(appRootEl!);
  showApp();
  appMounted = true;
  console.log("[OpenCode SP] App 已挂载");
}

/** 根据端口是否变化决定重载 App 还是仅显示 */
function handleServiceSwitch(newVitePort: string, newProxyPort: number) {
  const portChanged = lastVitePort !== newVitePort;
  lastVitePort = newVitePort;
  ports.proxyPort = newProxyPort;
  ports.vitePort = newVitePort;

  if (portChanged && appMounted) {
    // 不同 Vite 服务 → 销毁重建 App
    const oldApp = appRootEl;
    if (oldApp) {
      oldApp.innerHTML = "";
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
initContainers();
mountApp();

/** 监听 Tab 切换 → 显示/隐藏 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TAB_SWITCHED") {
    console.log("[OpenCode SP] Tab 切换:", msg.portInfo);
    if (msg.portInfo && msg.portInfo.proxyPort && msg.portInfo.vitePort) {
      handleServiceSwitch(msg.portInfo.vitePort, msg.portInfo.proxyPort);
    } else {
      showNoServiceOverlay();
    }
  }
});
