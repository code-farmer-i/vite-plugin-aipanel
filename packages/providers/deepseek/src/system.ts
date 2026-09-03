/**
 * Provider 运行环境检查与进程管理（CLI 安装/版本/孤儿进程清理）
 */
import { spawn } from "child_process";
import { PerformanceTimer, createLogger } from "@aipanel/core/node";

const log = createLogger("DeepSeekSystem");

export async function checkDeepSeekInstalled(): Promise<boolean> {
  const timer = log.timer("checkDeepSeekInstalled");

  return new Promise((resolve) => {
    log.debug("Checking if dsh is installed...");

    const proc = spawn("dsh", ["--version"], { stdio: "ignore", shell: true });

    proc.on("close", (code) => {
      const installed = code === 0;
      timer.end(installed ? "✓ dsh is installed" : "❌ dsh not found");
      resolve(installed);
    });

    proc.on("error", (err) => {
      log.debug("Failed to check dsh installation", { error: err.message });
      timer.end("❌ Check failed");
      resolve(false);
    });
  });
}

/** 本 provider 要求的 dsh 最低版本（0.1.2 起：browser-session 认证 + {args} Remote RPC + remote.mux，协议不向下兼容） */
export const MIN_DSH_VERSION = "0.1.2-rc.1";

/**
 * 解析 dsh --version 输出（如 "0.1.2-rc.1"，容忍 v 前缀与尾部换行）。
 * @returns {major,minor,patch,pre}；无法解析时返回 null。
 */
function parseDshVersion(
  version: string,
): { major: number; minor: number; patch: number; pre: string | undefined } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4],
  };
}

/**
 * 判定 version 是否 >= minimum（semver 风格，含 pre-release 比较：0.1.2 > 0.1.2-rc.1）。
 * @returns true/false；任一版本无法解析时返回 null（调用方按"无法确认"放行）。
 */
export function isDeepSeekVersionAtLeast(
  version: string,
  minimum = MIN_DSH_VERSION,
): boolean | null {
  const a = parseDshVersion(version);
  const b = parseDshVersion(minimum);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] > b[key];
  }
  // 核心版本相同：无 pre-release > 有 pre-release
  if (a.pre === undefined && b.pre === undefined) return true;
  if (a.pre === undefined) return true;
  if (b.pre === undefined) return false;
  // pre-release 逐段比较（数值段按数字、否则按字符串）
  const pa = a.pre.split(".");
  const pb = b.pre.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return true; // a 更短：a < b
    if (y === undefined) return false;
    const xn = /^\d+$/.test(x) ? Number(x) : NaN;
    const yn = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(xn) && !Number.isNaN(yn)) {
      if (xn !== yn) return xn > yn;
    } else if (x !== y) {
      return x > y;
    }
  }
  return true;
}

export function getDeepSeekVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("dsh", ["--version"], { stdio: "pipe", shell: true });
    let output = "";

    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        resolve(null);
      }
    });

    proc.on("error", () => {
      resolve(null);
    });
  });
}

const KILL_ORPHAN_TIMEOUT = 5000;

export async function killOrphanDeepSeekProcesses(): Promise<number> {
  const timer = log.timer("killOrphanDeepSeekProcesses");

  log.debug("Looking for orphan dsh processes (PPID=1)");

  return new Promise((resolve) => {
    let settled = false;
    const done = (count: number) => {
      if (settled) return;
      settled = true;
      resolve(count);
    };

    const timeout = setTimeout(() => {
      log.warn("Kill orphan processes timed out, skipping");
      timer.end("⚠ Timeout, skipped");
      done(0);
    }, KILL_ORPHAN_TIMEOUT);

    const wrappedResolve = (count: number) => {
      clearTimeout(timeout);
      done(count);
    };

    if (process.platform === "win32") {
      killOrphanProcessesOnWindows(wrappedResolve, timer);
    } else {
      killOrphanProcessesOnUnix(wrappedResolve, timer);
    }
  });
}

function killOrphanProcessesOnWindows(
  resolve: (value: number) => void,
  timer: PerformanceTimer,
): void {
  log.debug("Using Windows method to find orphan processes");

  const proc = spawn(
    "wmic",
    ["process", "where", 'name="node.exe"', "get", "processid,parentprocessid,commandline"],
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
      if (!line.includes("dsh")) return;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const ppid = parts[0];
        const pid = parts[1];
        if (ppid === "1" && pid && !isNaN(Number(pid))) {
          pidsToKill.push(pid);
        }
      }
    });

    if (pidsToKill.length > 0) {
      log.debug(`Found ${pidsToKill.length} orphan processes`, { pids: pidsToKill });

      let killedCount = 0;
      let completedCount = 0;

      pidsToKill.forEach((pid) => {
        const killProc = spawn("taskkill", ["/F", "/PID", pid], { stdio: "ignore" });
        killProc.on("close", (code) => {
          completedCount++;
          if (code === 0) killedCount++;

          if (completedCount === pidsToKill.length) {
            timer.end(`✓ Killed ${killedCount} orphan processes`);
            resolve(killedCount);
          }
        });
      });
    } else {
      log.debug("No orphan processes found");
      timer.end("No orphan processes found");
      resolve(0);
    }
  });

  proc.on("error", (err) => {
    log.debug("Failed to find orphan processes", { error: err.message });
    timer.end("❌ Failed to find orphan processes");
    resolve(0);
  });
}

function killOrphanProcessesOnUnix(
  resolve: (value: number) => void,
  timer: PerformanceTimer,
): void {
  log.debug("Using Unix method to find orphan processes");

  const proc = spawn("ps", ["-e", "-o", "pid,ppid,args"], { stdio: "pipe" });
  let output = "";

  proc.stdout?.on("data", (data) => {
    output += data.toString();
  });

  proc.on("close", () => {
    const lines = output.split("\n");
    const pidsToKill: string[] = [];

    lines.forEach((line) => {
      if (!line.includes("dsh")) return;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const pid = parts[0];
        const ppid = parts[1];
        if (ppid === "1") {
          pidsToKill.push(pid);
        }
      }
    });

    if (pidsToKill.length > 0) {
      log.debug(`Found ${pidsToKill.length} orphan processes`, { pids: pidsToKill });

      const killProc = spawn("kill", ["-9", ...pidsToKill], { stdio: "ignore" });
      killProc.on("close", (code) => {
        const killedCount = code === 0 ? pidsToKill.length : 0;
        timer.end(
          killedCount > 0
            ? `✓ Killed ${killedCount} orphan processes`
            : "❌ Failed to kill processes",
        );
        resolve(killedCount);
      });

      killProc.on("error", () => {
        timer.end("❌ Failed to kill processes");
        resolve(0);
      });
    } else {
      log.debug("No orphan processes found");
      timer.end("No orphan processes found");
      resolve(0);
    }
  });

  proc.on("error", (err) => {
    log.debug("Failed to find orphan processes", { error: err.message });
    timer.end("❌ Failed to find orphan processes");
    resolve(0);
  });
}
