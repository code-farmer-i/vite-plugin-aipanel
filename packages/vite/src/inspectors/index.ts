import type { Plugin } from "vite";
import { reactInspectorIntegration } from "./react";
import { vueInspectorIntegration } from "./vue";
import type { InspectorIntegration } from "./types";

/**
 * 已登记的框架 Inspector 集成（单一来源）。
 * 已登记 Vue / React；新增框架在此追加：客户端在 @aipanel/core 的注册表登记同 id 适配器。
 */
const integrations: readonly InspectorIntegration[] = [
  vueInspectorIntegration,
  reactInspectorIntegration,
];

/** 汇总各框架集成需要注入的构建期插件 */
export function createInspectorPlugins(): Plugin[] {
  return integrations.flatMap((integration) => integration.plugins());
}
