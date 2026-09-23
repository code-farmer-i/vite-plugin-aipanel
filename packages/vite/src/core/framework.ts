/**
 * 构建期框架检测：从 Vite 插件列表推断项目框架。
 * 依据官方插件命名约定（@vitejs/plugin-vue → "vite:vue*"，plugin-react / plugin-react-swc →
 * "vite:react*"），用于门控 Vue DevTools 桥注入与各框架 inspector 集成；
 * 标识复用 INSPECTOR_ADAPTER_IDS，与运行时适配器注册表对齐。
 */
import type { Plugin } from "vite";
import { INSPECTOR_ADAPTER_IDS } from "@aipanel/core";

export type ViteFramework = (typeof INSPECTOR_ADAPTER_IDS)[keyof typeof INSPECTOR_ADAPTER_IDS];

/**
 * 框架判定所需的配置形态：configResolved 拿到的是已解析配置（ResolvedConfig），
 * apply 阶段（Vite 解析插件列表时）拿到的是用户原始配置（UserConfig），两者都满足。
 */
export interface FrameworkDetectionConfig {
  readonly plugins?: readonly unknown[];
}

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
export function detectViteFramework(config: FrameworkDetectionConfig): ViteFramework | null {
  const names = collectPluginNames(config.plugins ?? []);
  if (names.some((name) => name.startsWith(VUE_PLUGIN_NAME_PREFIX))) {
    return INSPECTOR_ADAPTER_IDS.vue;
  }
  if (names.some((name) => name.startsWith(REACT_PLUGIN_NAME_PREFIX))) {
    return INSPECTOR_ADAPTER_IDS.react;
  }
  return null;
}

/**
 * 把构建期插件收窄到框架判定通过的项目，并保留插件原有的 apply 条件（如仅 dev server）。
 *
 * 只能在这一步拦截：Vite 解析插件列表时即调用 apply，此时拿到的是用户原始配置；
 * 一旦插件被注册，第三方注入插件（unplugin-vue-inspector 会在 index.html 注入依赖 vue
 * 的运行时）在 configResolved 阶段已撤销不了，React 等未安装 vue 的项目会直接报
 * `Failed to resolve import "vue"`。框架判定与 configResolved 侧共用 detectViteFramework。
 */
export function restrictPluginsToFramework(
  plugins: Plugin[],
  accepts: (framework: ViteFramework | null) => boolean,
): Plugin[] {
  return plugins.map((plugin) => {
    const inner = plugin.apply;
    return {
      ...plugin,
      apply: (config, env) => {
        if (!accepts(detectViteFramework(config))) return false;
        if (!inner) return true;
        return typeof inner === "function" ? inner(config, env) : inner === env.command;
      },
    };
  });
}
