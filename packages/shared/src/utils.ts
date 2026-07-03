/**
 * @fileoverview 通用工具函数
 */

import net from "net";
import { CHROME_DEVTOOLS_PORT, CHROME_DEVTOOLS_CHECK_TIMEOUT } from "./constants";

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
 * 将字符串编码为 Base64
 * @param str - 要编码的字符串
 * @returns Base64 编码的字符串
 */
export function base64Encode(str: string): string {
  if (!str) {
    throw new Error("base64Encode: input string is required");
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str).toString("base64");
  }
  // 浏览器环境
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

/**
 * 将 Base64 解码为字符串
 * @param base64 - Base64 编码的字符串
 * @returns 解码后的字符串
 */
export function base64Decode(base64: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  // 浏览器环境
  const binString = atob(base64);
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
      .filter((p: unknown) => p && typeof p === "object" && (p as Record<string, unknown>).type === "text")
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

/**
 * 检查 Chrome DevTools 是否可用
 * @param timeout - 超时时间（毫秒），默认 2000ms
 * @returns Chrome DevTools 是否可用
 */
export async function checkChromeDevToolsAvailable(
  port = CHROME_DEVTOOLS_PORT,
  timeout = CHROME_DEVTOOLS_CHECK_TIMEOUT
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeout);

    socket.connect(port, "localhost", () => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
