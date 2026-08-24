/**
 * Provider 运行环境检查与进程管理（CLI 安装/版本/孤儿进程清理）
 */
import { spawn } from "child_process";
import { PerformanceTimer, createLogger } from "@aipanel/core/node";

const log = createLogger("OpenCodeSystem");

export async function checkOpenCodeInstalled(): Promise<boolean> {
  const timer = log.timer("checkOpenCodeInstalled");

  return new Promise((resolve) => {
    log.debug("Checking if OpenCode is installed...");

    const proc = spawn("opencode", ["--version"], { stdio: "ignore", shell: true });

    proc.on("close", (code) => {
      const installed = code === 0;
      timer.end(installed ? "✓ OpenCode is installed" : "❌ OpenCode not found");
      resolve(installed);
    });

    proc.on("error", (err) => {
      log.debug("Failed to check OpenCode installation", { error: err.message });
      timer.end("❌ Check failed");
      resolve(false);
    });
  });
}

export function getOpenCodeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("opencode", ["--version"], { stdio: "pipe", shell: true });
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

export async function killOrphanOpenCodeProcesses(): Promise<number> {
  const timer = log.timer("killOrphanOpenCodeProcesses");

  log.debug("Looking for orphan OpenCode processes (PPID=1)");

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
    ["process", "where", 'name="opencode.exe"', "get", "processid,parentprocessid"],
    { stdio: "pipe" },
  );

  let output = "";

  proc.stdout?.on("data", (data) => {
    output += data.toString();
  });

  proc.on("close", () => {
    const lines = output.split("\n").filter((line) => line.trim());
    const pidsToKill: string[] = [];

    lines.forEach((line) => {
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
          if (code === 0) {
            killedCount++;
            log.debug(`Killed orphan process ${pid}`);
          }

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

  const proc = spawn("ps", ["-e", "-o", "pid,ppid,comm"], { stdio: "pipe" });
  let output = "";

  proc.stdout?.on("data", (data) => {
    output += data.toString();
  });

  proc.on("close", () => {
    const lines = output.split("\n");
    const pidsToKill: string[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.includes("opencode")) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          const pid = parts[0];
          const ppid = parts[1];
          const comm = parts.slice(2).join(" ");

          if (ppid === "1" && comm.includes("opencode")) {
            pidsToKill.push(pid);
          }
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
