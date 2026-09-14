/**
 * 构建期框架检测：从已解析的 Vite 插件列表推断项目框架。
 * 依据官方插件命名约定（@vitejs/plugin-vue → "vite:vue*"，plugin-react / plugin-react-swc →
 * "vite:react*"），用于门控 Vue DevTools 桥注入与各框架 inspector 集成；
 * 标识复用 INSPECTOR_ADAPTER_IDS，与运行时适配器注册表对齐。
 */
import type { Plugin, ResolvedConfig } from "vite";
import { INSPECTOR_ADAPTER_IDS } from "@aipanel/core";

export type ViteFramework = (typeof INSPECTOR_ADAPTER_IDS)[keyof typeof INSPECTOR_ADAPTER_IDS];

const VUE_PLUGIN_NAME_PREFIX = "vite:vue";
const REACT_PLUGIN_NAME_PREFIX = "vite:react";

/** 展平插件嵌套数组并收集名称（ResolvedConfig.plugins 已展平，此处防御性处理） */
function collectPluginNames(plugins: readonly unknown[], names: string[] = []): string[] {
  for (const plugin of plugins) {
    if (Array.isArray(plugin)) {
      collectPluginNames(plugin, names);
    } else if (plugin && typeof plugin === "object") {
      const name = (plugin as Plugin).name;
      if (typeof name === "string") names.push(name);
    }
  }
  return names;
}

/**
 * 检测项目框架：vue / react 同时存在时以 vue 优先（与运行时适配器解析顺序一致）；
 * 无法识别（solid、svelte、纯原生等）返回 null，调用方按保守策略处理。
 */
export function detectViteFramework(config: ResolvedConfig): ViteFramework | null {
  const names = collectPluginNames(config.plugins ?? []);
  if (names.some((name) => name.startsWith(VUE_PLUGIN_NAME_PREFIX))) {
    return INSPECTOR_ADAPTER_IDS.vue;
  }
  if (names.some((name) => name.startsWith(REACT_PLUGIN_NAME_PREFIX))) {
    return INSPECTOR_ADAPTER_IDS.react;
  }
  return null;
}
