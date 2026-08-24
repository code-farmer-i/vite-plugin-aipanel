import { createApp } from "vue";
import { CONFIG_DATA_ATTR, WIDGET_MSG, createLogger, setVerbose } from "@aipanel/core";
import type { WidgetOptions } from "@aipanel/core";

const log = createLogger("AIPanel");
import App from "./App.vue";
import "./styles.css";

let config: Partial<WidgetOptions> = {};
const scriptTag = document.querySelector(`script[${CONFIG_DATA_ATTR}]`);
if (scriptTag) {
  const configBase64 = scriptTag.getAttribute(CONFIG_DATA_ATTR);
  if (configBase64) {
    try {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(configBase64), (c) => c.charCodeAt(0)),
      );
      config = JSON.parse(decoded);
      if (config.verbose) {
        setVerbose(true);
      }
    } catch (e) {
      log.error("Failed to parse config:", { error: e });
    }
  }
}

const INIT_MARKER = "__AIPANEL_INITIALIZED__";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(window as any)[INIT_MARKER]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[INIT_MARKER] = true;

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // 通过 postMessage 向 Content Script 发送服务信息，避免 HTTP 轮询污染 Network 面板
  if (config.serviceInstanceId && config.proxyPort) {
    const serviceInfo = {
      type: WIDGET_MSG.SERVICE_INFO,
      proxyPort: config.proxyPort,
      vitePort: location.port,
      webPort: config.webPort,
      projectRoot: config.projectRoot || "",
      serviceInstanceId: config.serviceInstanceId,
      verbose: config.verbose,
    };

    // queueMicrotask 确保 Content Script 的消息监听器先注册
    queueMicrotask(() => {
      window.postMessage(serviceInfo, location.origin);
    });

    // 定期心跳，确保 Content Script 能检测服务存活状态
    heartbeatTimer = setInterval(() => {
      window.postMessage(serviceInfo, location.origin);
    }, 5000);
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(App, { config });
  app.mount(container);

  // 添加清理函数到 window，便于热更新或测试时清理
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__AIPANEL_CLEANUP__ = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    app.unmount();
    container.remove();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[INIT_MARKER] = false;
  };
}
