/**
 * @fileoverview Node.js 专用工具函数（仅服务端可用）
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  CHROME_DEVTOOLS_PORT,
  CHROME_DEVTOOLS_CHECK_TIMEOUT,
  SERVER_CHECK_INTERVAL,
} from "../common/constants";
import { PerformanceTimer, createLogger } from "./node-logger";

const log = createLogger("NodeUtils");

/**
 * 创建一个锚定到指定目录（默认 process.cwd()）的 require。
 * 跨 ESM/CJS 安全，避免依赖 __dirname / import.meta.url（CJS 打包时会与 Node 内置变量冲突或被置空）。
 */
export function createPackageRequire(baseDir: string = process.cwd()) {
  return createRequire(path.join(baseDir, "package.json"));
}

/**
 * 解析 npm 包根目录（跨 ESM/CJS 安全）。
 * @param packageName - 包名，例如 "vite-plugin-aipanel"
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
/**
 * 可等待的进程接口（ResultPromise 等匹配就够）
 */
export interface WaitableProcess {
  exitCode: number | null | undefined;
}

/**
 * 轮询等待服务准备就绪（HTTP 状态码 < 500 即当作 ready）；超时或进程退出时 reject
 * @param url - 检查的服务 URL
 * @param timeout - 超时毫秒数
 * @param proc - 可选进程，提前退出时直接失败
 */
export function waitForServer(url: string, timeout = 10000, proc?: WaitableProcess): Promise<void> {
  const timer = new PerformanceTimer("waitForServer", { url, timeout });

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let attempts = 0;

    const check = (): void => {
      attempts++;
      log.debug(`Checking server availability (attempt ${attempts})`, { url });

      if (proc?.exitCode !== null && proc?.exitCode !== undefined) {
        timer.end(`✖ Process exited with code ${proc.exitCode}`);
        reject(new Error(`Process exited with code ${proc.exitCode}`));
        return;
      }

      const req = http.get(url, (res) => {
        if (res.statusCode && res.statusCode < 500) {
          timer.end(`✓ Server ready after ${attempts} attempts`);
          resolve();
        } else {
          log.debug(`Server returned status ${res.statusCode}, retrying...`);
          retryOrReject();
        }
      });

      req.on("error", (err) => {
        log.debug(`Server check failed: ${err.message}`);
        retryOrReject();
      });
    };

    const retryOrReject = (): void => {
      const elapsed = Date.now() - startTime;
      if (elapsed < timeout) {
        setTimeout(check, SERVER_CHECK_INTERVAL);
      } else {
        timer.end("✖ Timeout");
        reject(new Error(`Server not ready after ${timeout}ms (${attempts} attempts)`));
      }
    };

    check();
  });
}

/**
 * 从指定目录往上查找 .git 根目录（找不到时返回起始目录）
 */
export function findGitRoot(startDir: string, maxDepth = 10): string {
  const timer = new PerformanceTimer("findGitRoot", { startDir, maxDepth });

  let currentDir = startDir;
  let depth = 0;

  while (depth < maxDepth) {
    const gitDir = path.join(currentDir, ".git");

    try {
      if (fs.existsSync(gitDir)) {
        timer.end(`✓ Found git root at depth ${depth}: ${currentDir}`);
        return currentDir;
      }
    } catch (err) {
      log.debug(`Error checking .git directory at ${currentDir}`, {
        error: (err as Error).message,
      });
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      log.debug("Reached filesystem root");
      break;
    }
    currentDir = parentDir;
    depth++;
  }

  timer.end(`✖ No git root found after ${depth} levels, using start directory`);
  return startDir;
}

/**
 * 检查某 CLI 是否安装（运行 <bin> --version，退出码 0 即存在）
 */
export async function checkCliInstalled(bin: string): Promise<boolean> {
  const timer = new PerformanceTimer(`checkCliInstalled:${bin}`);
  return new Promise((resolve) => {
    const proc = spawn(bin, ["--version"], { stdio: "ignore", shell: true });
    proc.on("close", (code) => {
      const installed = code === 0;
      timer.end(installed ? `✓ ${bin} is installed` : `✖ ${bin} not found`);
      resolve(installed);
    });
    proc.on("error", (err) => {
      log.debug(`Failed to check ${bin} installation`, { error: err.message });
      timer.end("✖ Check failed");
      resolve(false);
    });
  });
}

/**
 * 获取某 CLI 版本号（<bin> --version，退出码 0 时取 stdout 首段，stdout 为空回退 stderr；败路返回 null）
 * stderr 回退：部分 CLI（如个别平台的 dsh）把版本打在 stderr，仅读 stdout 会误判为“未解析出版本”。
 */
export function getCliVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["--version"], { stdio: "pipe", shell: true });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      resolve(stdout.trim() || stderr.trim() || null);
    });
    proc.on("error", () => resolve(null));
  });
}

/** 孤儿进程清理配置（提供商的 check/kill 统一实现） */
export interface KillOrphanCliOptions {
  /** 进程命令行/参数中需匹配的子串（如 opencode / dsh） */
  match: string;
  /** Windows wmic 按名称查询的进程名（如 opencode.exe / node.exe） */
  winName: string;
  /** 超时毫秒（默认 5000） */
  timeout?: number;
  /** 运行名（仅用于日志，默认等于 match） */
  label?: string;
}

/**
 * 清理被 reparent 到 init（PPID=1）的孤儿进程（win: wmic+taskkill；unix: ps+kill）
 * @returns 被成功结束的进程数
 */
export function killOrphanCliProcesses(
  bin: string,
  options: KillOrphanCliOptions,
): Promise<number> {
  const label = options.label ?? bin;
  const timeoutMs = options.timeout ?? 5000;
  const timer = new PerformanceTimer(`killOrphanCliProcesses:${label}`);
  log.debug(`Looking for orphan ${label} processes (PPID=1)`);

  return new Promise((resolve) => {
    let settled = false;
    const done = (count: number) => {
      if (!settled) {
        settled = true;
        resolve(count);
      }
    };
    const timeout = setTimeout(() => {
      log.warn(`Kill orphan ${label} processes timed out, skipping`);
      timer.end("⚠ Timeout, skipped");
      done(0);
    }, timeoutMs);
    const wrappedResolve = (count: number) => {
      clearTimeout(timeout);
      done(count);
    };

    if (process.platform === "win32") {
      killOrphansOnWindows(wrappedResolve, options, label, timer);
    } else {
      killOrphansOnUnix(wrappedResolve, options, label, timer);
    }
  });
}

function killOrphansOnWindows(
  resolve: (value: number) => void,
  options: KillOrphanCliOptions,
  label: string,
  timer: PerformanceTimer,
): void {
  log.debug(`Using Windows method to find orphan ${label} processes`);
  const proc = spawn(
    "wmic",
    [
      "process",
      "where",
      `name="${options.winName}"`,
      "get",
      "processid,parentprocessid,commandline",
    ],
    { stdio: "pipe" },
  );
  let output = "";
  proc.stdout?.on("data", (data) => {
    output += data.toString();
  });
  proc.on("close", () => {
    const pidsToKill: string[] = [];
    output.split("\n").forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line.includes(options.match)) return;
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const ppid = parts[0];
        const pid = parts[1];
        if (ppid === "1" && pid && !Number.isNaN(Number(pid))) pidsToKill.push(pid);
      }
    });
    finishOrphanKillWindows(pidsToKill, resolve, label, timer);
  });
  proc.on("error", (err) => {
    log.debug(`Failed to find orphan ${label} processes`, { error: err.message });
    timer.end("✖ Failed to find orphan processes");
    resolve(0);
  });
}

function finishOrphanKillWindows(
  pidsToKill: string[],
  resolve: (value: number) => void,
  label: string,
  timer: PerformanceTimer,
): void {
  if (pidsToKill.length === 0) {
    log.debug("No orphan processes found");
    timer.end("No orphan processes found");
    resolve(0);
    return;
  }
  log.debug(`Found ${pidsToKill.length} orphan processes`, { pids: pidsToKill });
  let killedCount = 0;
  let completedCount = 0;
  pidsToKill.forEach((pid) => {
    const killProc = spawn("taskkill", ["/F", "/PID", pid], { stdio: "ignore" });
    killProc.on("close", (code) => {
      completedCount++;
      if (code === 0) killedCount++;
      if (completedCount === pidsToKill.length) {
        timer.end(`✓ Killed ${killedCount} orphan ${label} processes`);
        resolve(killedCount);
      }
    });
  });
}

function killOrphansOnUnix(
  resolve: (value: number) => void,
  options: KillOrphanCliOptions,
  label: string,
  timer: PerformanceTimer,
): void {
  log.debug(`Using Unix method to find orphan ${label} processes`);
  const proc = spawn("ps", ["-e", "-o", "pid,ppid,args"], { stdio: "pipe" });
  let output = "";
  proc.stdout?.on("data", (data) => {
    output += data.toString();
  });
  proc.on("close", () => {
    const pidsToKill: string[] = [];
    output.split("\n").forEach((line) => {
      if (!line.includes(options.match)) return;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const pid = parts[0];
        const ppid = parts[1];
        if (ppid === "1" && pid && !Number.isNaN(Number(pid))) pidsToKill.push(pid);
      }
    });
    if (pidsToKill.length === 0) {
      log.debug("No orphan processes found");
      timer.end("No orphan processes found");
      resolve(0);
      return;
    }
    log.debug(`Found ${pidsToKill.length} orphan processes`, { pids: pidsToKill });
    const killProc = spawn("kill", ["-9", ...pidsToKill], { stdio: "ignore" });
    killProc.on("close", (code) => {
      const killedCount = code === 0 ? pidsToKill.length : 0;
      timer.end(
        killedCount > 0
          ? `✓ Killed ${killedCount} orphan ${label} processes`
          : "✖ Failed to kill processes",
      );
      resolve(killedCount);
    });
    killProc.on("error", () => {
      timer.end("✖ Failed to kill processes");
      resolve(0);
    });
  });
  proc.on("error", (err) => {
    log.debug(`Failed to find orphan ${label} processes`, { error: err.message });
    timer.end("✖ Failed to find orphan processes");
    resolve(0);
  });
}
