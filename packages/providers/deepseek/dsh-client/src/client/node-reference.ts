/**
 * 节点 chip 的引用载荷：解析与序列化（纯函数，便于单测）。
 *
 * chip 的 `ref` 是本插件 source 自有的不透明字符串（选中元素 JSON）：
 *  - 插入时由 `elementContextRef` 序列化进 chip；
 *  - 提交时由 codec.serialize 还原成会话文本里的 `@节点[id]` 标记；
 *  - 点击时由 openReference 还原成元素（发送后的 chip 只剩标记，则按节点 id 反查）。
 * 三处共用这里的实现，避免各写一份解析/拼接。
 */
import { ensureNodeId, toNodeMention, type AIPanelSelectedElement } from "@aipanel/core";

/**
 * 解析 chip 的不透明引用载荷。
 * @param ref - `ReferenceInsert.ref`（选中元素 JSON）
 * @returns 元素对象；不是本 source 的形态（非法 JSON / 非对象）时返回 null
 */
export function parseElementRef(ref: string): AIPanelSelectedElement | null {
  try {
    const element = JSON.parse(ref) as AIPanelSelectedElement;
    return element && typeof element === "object" ? element : null;
  } catch {
    return null;
  }
}

/**
 * 把 chip 引用序列化成会话文本里的节点标记（`@节点[n<id>]`）。
 * 完整元素上下文不在这里——host 端按 id 从核心层 context 端点反查注入。
 * 无法解析出元素时退回 `@<ref>`，不丢引用。
 *
 * @param ref - chip 的 `ref`
 * @returns 会话文本
 */
export function serializeElementRef(ref: string): string {
  const element = parseElementRef(ref);
  if (!element) return `@${ref}`;
  return toNodeMention(ensureNodeId(element));
}
