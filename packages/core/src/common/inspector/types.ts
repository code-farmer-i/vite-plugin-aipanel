/// <reference lib="dom" />
import type { InspectorAdapterId } from "../constants";

/** 元素对应的源码位置（跨框架统一形态；未解析到的字段为 null） */
export interface InspectorSourceLocation {
  file: string | null;
  line: number | null;
  column: number | null;
}

/**
 * 元素点击处理器。
 * 返回 true 表示宿主已接管：适配器抑制底层 inspector 的默认行为（如打开编辑器）。
 */
export type InspectorElementClickHandler = (element: Element | null, event: MouseEvent) => boolean;

/**
 * 框架侧「点击元素 → 源码位置」适配器契约。
 * 宿主（挂件 / 扩展）只依赖此接口，不感知 Vue、React 等框架差异。
 */
export interface InspectorAdapter {
  readonly id: InspectorAdapterId;
  /** 用户可见名称（提示文案用） */
  readonly label: string;
  /** 运行时是否可用（对应框架的 inspector 已注入页面） */
  isAvailable(): boolean;
  /** 适配器自身覆盖层的选择器：宿主需忽略，不参与选择 */
  readonly ignoreSelectors: readonly string[];
  /** 适配器自带的忽略标记属性：宿主需忽略，不参与选择 */
  readonly ignoreAttributes: readonly string[];
  /** 元素 → 源码位置；解析不到返回 null */
  resolveSourceLocation(element: Element): InspectorSourceLocation | null;
  /** 注册元素点击处理器（幂等：同一底层 inspector 只安装一次） */
  onElementClick(handler: InspectorElementClickHandler): void;
  /** 同步底层 inspector 的启用状态 */
  setEnabled(enabled: boolean): void;
}

/** 解析 "文件:行:列" 形式的源码坐标（各框架适配器共用的标记格式） */
export function parseSourceLocation(value: string): InspectorSourceLocation | null {
  const match = /^(.+):([\d]+):([\d]+)$/.exec(value);
  if (!match) return null;
  return {
    file: match[1],
    line: Number.parseInt(match[2], 10),
    column: Number.parseInt(match[3], 10),
  };
}
