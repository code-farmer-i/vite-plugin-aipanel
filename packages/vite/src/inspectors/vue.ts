import Inspector from "unplugin-vue-inspector/vite";
import { INSPECTOR_ADAPTER_IDS } from "@aipanel/core";
import { restrictPluginsToFramework } from "../core/framework";
import type { InspectorIntegration } from "./types";

/**
 * Vue 集成：注入 unplugin-vue-inspector 运行时。
 * 常驻但默认不启用（enabled: false），由挂件进入选择模式时开启；
 * 同时隐藏其自带的切换按钮与快捷键，避免与挂件交互冲突。
 *
 * 只对 Vue 项目注册：该插件会向 index.html 注入依赖 vue 的运行时，注册到未安装 vue 的
 * 项目（React 等）会让浏览器直接报 Failed to resolve import "vue"。
 */
export const vueInspectorIntegration: InspectorIntegration = {
  id: INSPECTOR_ADAPTER_IDS.vue,
  plugins: () =>
    restrictPluginsToFramework(
      Inspector({
        enabled: false,
        toggleButtonVisibility: "never",
        toggleComboKey: false,
      }),
      (framework) => framework === INSPECTOR_ADAPTER_IDS.vue,
    ),
};
