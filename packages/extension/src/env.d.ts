/// <reference types="chrome" />
/// <reference types="vite/client" />

declare module "@aipanel/client/App.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module "@aipanel/client/styles.css";
