/**
 * @fileoverview Node.js 专用工具函数（仅服务端可用）
 */

import { createRequire } from "node:module";
import path from "node:path";
import { CHROME_DEVTOOLS_PORT, CHROME_DEVTOOLS_CHECK_TIMEOUT } from "./constants";

/**
 * 创建一个锚定到指定目录（默认 process.cwd()）的 require。
 * 跨 ESM/CJS 安全，避免依赖 __dirname / import.meta.url（CJS 打包时会与 Node 内置变量冲突或被置空）。
 */
export function createPackageRequire(baseDir: string = process.cwd()) {
  return createRequire(path.join(baseDir, "package.json"));
}

/**
 * 解析 npm 包根目录（跨 ESM/CJS 安全）。
 * @param packageName - 包名，例如 "vite-plugin-opencode-assistant"
 * @param baseDir - 解析基准目录，默认当前工作目录
 */
export function resolvePackageDir(packageName: string, baseDir: string = process.cwd()): string {
  const require = createPackageRequire(baseDir);
  const entryPath = require.resolve(packageName);
  return path.dirname(path.dirname(entryPath));
}

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

/**
 * 检查指定端口是否可用
 */
export async function isPortAvailable(port: number, hostname?: string): Promise<boolean> {
  const net = await import("net");
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, hostname);
  });
}

/**
 * 从 startPort 开始寻找可用端口
 */
export async function findAvailablePort(
  startPort: number,
  hostname?: string,
  maxTries = 100,
): Promise<number> {
  for (let port = startPort; port < startPort + maxTries; port++) {
    if (await isPortAvailable(port, hostname)) return port;
  }
  throw new Error(`No available port in range ${startPort}-${startPort + maxTries}`);
}
