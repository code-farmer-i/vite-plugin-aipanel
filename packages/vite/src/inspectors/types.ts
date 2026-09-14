import type { Plugin } from "vite";
import type { InspectorAdapterId } from "@aipanel/core";

/**
 * 框架侧 Inspector 集成：构建期注入「点击元素 → 打开源码」运行时。
 * 与客户端 @aipanel/core 的适配器按同一 id 对齐（INSPECTOR_ADAPTER_IDS）。
 */
export interface InspectorIntegration {
  readonly id: InspectorAdapterId;
  /** 该框架需要注入的构建期插件 */
  plugins(): Plugin[];
}
