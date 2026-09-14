import Inspector from "unplugin-vue-inspector/vite";
import { INSPECTOR_ADAPTER_IDS } from "@aipanel/core";
import type { InspectorIntegration } from "./types";

/**
 * Vue 集成：注入 unplugin-vue-inspector 运行时。
 * 常驻但默认不启用（enabled: false），由挂件进入选择模式时开启；
 * 同时隐藏其自带的切换按钮与快捷键，避免与挂件交互冲突。
 */
export const vueInspectorIntegration: InspectorIntegration = {
  id: INSPECTOR_ADAPTER_IDS.vue,
  plugins: () =>
    Inspector({
      enabled: false,
      toggleButtonVisibility: "never",
      toggleComboKey: false,
    }),
};
