/// <reference types="chrome" />
/// <reference types="vite/client" />

declare module "@vite-plugin-opencode-assistant/client/App.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module "@vite-plugin-opencode-assistant/client/styles.css";
