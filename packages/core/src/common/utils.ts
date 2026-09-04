/**
 * @fileoverview 通用工具函数
 */

/**
 * 取（或生成）元素的节点唯一 id：优先复用已赋值的 id，否则生成随机 id 并写回元素。
 * 同一引用在会话标记（`@节点[n<id>]`）与上下文注入里使用同一个 id；
 * 不同包（client / dsh-client / context 端点）共用此实现，保证 id 体系一致。
 * @param element - 携带可选 id 的元素对象（会被写回生成的 id）
 * @returns 该元素最终使用的节点 id
 */
export function ensureNodeId(element: { id?: string }): string {
  if (element.id) return element.id;
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  element.id = `n${random}`;
  return element.id;
}

/**
 * 截断字符串到指定长度
 * @param value - 要截断的字符串
 * @param maxLength - 最大长度
 * @returns 截断后的字符串，如果超出长度则添加省略号
 */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

/**
 * 延迟指定时间
 * @param ms - 毫秒数
 * @returns Promise
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 将字符串编码为 URL-safe Base64（与 Provider 兼容）
 * 替换 + 为 -, / 为 _, 去掉 =
 * @param str - 要编码的字符串
 * @returns URL-safe Base64 编码的字符串
 */
export function base64Encode(str: string): string {
  if (!str) {
    throw new Error("base64Encode: input string is required");
  }
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * 将 URL-safe Base64 解码为字符串
 * @param base64 - URL-safe Base64 编码的字符串
 * @returns 解码后的字符串
 */
export function base64Decode(base64: string): string {
  // 还原为标准 base64
  const standard = base64.replace(/-/g, "+").replace(/_/g, "/");
  const binString = atob(standard);
  const bytes = Uint8Array.from(binString, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * 从响应数据中提取文本内容
 * 支持多种常见响应格式
 */
export function extractTextFromResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  // 处理 { parts: [{ type: "text", text: "..." }] } 格式
  const obj = data as Record<string, unknown>;
  if (obj.parts && Array.isArray(obj.parts)) {
    const textParts = obj.parts
      .filter(
        (p: unknown) =>
          p && typeof p === "object" && (p as Record<string, unknown>).type === "text",
      )
      .map((p: unknown) => (p as Record<string, unknown>).text as string)
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join("");
  }

  // 处理 { text: "..." } 格式
  if (obj.text && typeof obj.text === "string") {
    return obj.text;
  }

  // 处理 { content: "..." } 格式
  if (obj.content && typeof obj.content === "string") {
    return obj.content;
  }

  // 处理 { message: "..." } 格式
  if (obj.message && typeof obj.message === "string") {
    return obj.message;
  }

  // 直接字符串
  if (typeof data === "string") {
    return data;
  }

  return null;
}
