import fs from "fs";
import http from "http";
import path from "path";
import type { ResultPromise } from "execa";
import { SERVER_CHECK_INTERVAL } from "@aipanel/core";
import { PerformanceTimer, createLogger } from "@aipanel/core/node";

const log = createLogger("Utils");

export function waitForServer(
  url: string,
  timeout = 10000,
  process?: ResultPromise,
): Promise<void> {
  const timer = new PerformanceTimer("waitForServer", { url, timeout });

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let attempts = 0;

    const check = (): void => {
      attempts++;
      log.debug(`Checking server availability (attempt ${attempts})`, { url });

      if (process?.exitCode !== null && process?.exitCode !== undefined) {
        timer.end(`❌ Process exited with code ${process.exitCode}`);
        reject(new Error(`Process exited with code ${process.exitCode}`));
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
        timer.end("❌ Timeout");
        reject(new Error(`Server not ready after ${timeout}ms (${attempts} attempts)`));
      }
    };

    check();
  });
}

export function findGitRoot(startDir: string, maxDepth = 10): string {
  const timer = log.timer("findGitRoot", { startDir, maxDepth });

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

  timer.end(`❌ No git root found after ${depth} levels, using start directory`);
  return startDir;
}
