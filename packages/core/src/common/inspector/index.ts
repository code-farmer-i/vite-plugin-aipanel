import type { InspectorAdapter } from "./types";
import { reactInspectorAdapter } from "./react";
import { vueInspectorAdapter } from "./vue";

export * from "./types";

/**
 * 已登记的框架适配器（单一来源）。
 * 已登记 Vue / React；新增框架在此追加实现，宿主侧无需改动；
 * 服务端注入的构建期插件与这里按同一 id 对齐。
 */
const adapters: readonly InspectorAdapter[] = [vueInspectorAdapter, reactInspectorAdapter];

/** 全部已登记适配器：用于静态元数据（忽略标记、源码位置解析） */
export function listInspectorAdapters(): readonly InspectorAdapter[] {
  return adapters;
}

/** 当前可用的适配器（对应框架的 inspector 运行时已注入页面）；无可用返回 null */
export function resolveInspectorAdapter(): InspectorAdapter | null {
  return adapters.find((adapter) => adapter.isAvailable()) ?? null;
}
