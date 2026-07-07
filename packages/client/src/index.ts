import { createApp } from "vue";
import { CONFIG_DATA_ATTR } from "@vite-plugin-opencode-assistant/shared";
import type { WidgetOptions } from "@vite-plugin-opencode-assistant/shared";
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
    } catch (e) {
      console.error("[OpenCode] Failed to parse config:", e);
    }
  }
}

const INIT_MARKER = "__OPENCODE_INITIALIZED__";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(window as any)[INIT_MARKER]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[INIT_MARKER] = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(App, { config });
  app.mount(container);

  // 添加清理函数到 window，便于热更新或测试时清理
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__OPENCODE_CLEANUP__ = () => {
    app.unmount();
    container.remove();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[INIT_MARKER] = false;
  };
}
