/**
 * @fileoverview Node.js 专用工具函数（仅服务端可用）
 */

import { CHROME_DEVTOOLS_PORT, CHROME_DEVTOOLS_CHECK_TIMEOUT } from "./constants";

/**
 * 检查 Chrome DevTools 是否可用
 * @param timeout - 超时时间（毫秒），默认 2000ms
 * @returns Chrome DevTools 是否可用
 */
export async function checkChromeDevToolsAvailable(
  port = CHROME_DEVTOOLS_PORT,
  timeout = CHROME_DEVTOOLS_CHECK_TIMEOUT,
): Promise<boolean> {
  const net = await import("net");
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
