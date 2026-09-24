/**
 * @fileoverview 通用工具函数
 */
import { DEFAULT_RETRIES, DEPENDENCY_DIR_NAME, RETRY_DELAY } from "./constants";

/**
 * 路径分隔符归一化（反斜杠 → 正斜杠）。
 * 浏览器侧没有 node:path，路径处理统一按字符串做；宿主的绝对路径在 Windows 上会带 `\`。
 * @param filePath - 原始路径
 * @returns 分隔符统一为正斜杠的路径
 */
export function normalizePathSeparators(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * 取路径的文件名（最后一段），兼容 `/` 与 `\` 分隔。
 * 挂件气泡/节点卡片（浏览器）与进程日志（node）共用，避免各处自写 split("/").pop()。
 * @param filePath - 原始路径
 * @returns 文件名；路径为空或以分隔符结尾时返回空串
 */
export function fileNameOf(filePath: string): string {
  const normalized = normalizePathSeparators(filePath);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/**
 * 路径是否位于依赖安装目录内（含 pnpm 的 `.pnpm/<pkg>@<ver>/node_modules/<pkg>` 真身）。
 * 按路径分段判定，避免误伤名字里含 node_modules 的项目目录。
 * @param filePath - 原始路径
 * @returns 为依赖内部文件时 true
 */
export function isDependencyPath(filePath: string): boolean {
  return normalizePathSeparators(filePath).split("/").includes(DEPENDENCY_DIR_NAME);
}

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
const NODE_MENTION_RE = /@节点\[(n[0-9a-z]+)\]/g;

/**
 * 生成节点提及标记 `@节点[n<id>]`（与 ensureNodeId 分配的 n<hex> id 体系一致）
 */
export function toNodeMention(id: string): string {
  return `@节点[${id}]`;
}

/**
 * 从文本中提取全部节点提及 id（去重、保序）
 */
export function parseNodeMentions(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(NODE_MENTION_RE)) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * 构造 iframe postMessage 信封：{ type, ...data }（AIPanel 挂件与 dsh-client 共用同一形状）
 */
export function widgetEnvelope(
  type: string,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  return { type, ...data };
}
/** 重试配置 */
export interface RetryOptions {
  /** 总尝试次数（默认 core DEFAULT_RETRIES） */
  attempts?: number;
  /** 失败后连续尝试间隔毫秒（默认 core RETRY_DELAY） */
  delayMs?: number;
  /** 每次失败、重试前回调（attempt 为 1-based） */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * 带线性重试的执行包裹：执行 fn 直到成功或尝试完毕；最后一次失败原样抛出。
 * 环境无关（仅使用 setTimeout），放于 common 供浏览器与 node 共用。
 */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_RETRIES;
  const delayMs = options.delayMs ?? RETRY_DELAY;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        options.onRetry?.(i + 1, e);
        if (delayMs > 0) await sleep(delayMs);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
