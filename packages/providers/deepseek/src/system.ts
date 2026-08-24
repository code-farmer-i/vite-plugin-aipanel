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
    ["process", "where", "name=\"node.exe\"", "get", "processid,parentprocessid,commandline"],
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