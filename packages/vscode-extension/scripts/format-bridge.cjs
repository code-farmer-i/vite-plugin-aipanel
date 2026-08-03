#!/usr/bin/env node
/**
 * OpenCode VS Code 格式化桥接脚本
 *
 * VS Code 扩展可用时通过 HTTP API 格式化，不可用时直接返回（由 OpenCode 内置 prettier 兜底）。
 *
 * 用法: node format-bridge.cjs <filePath>
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node format-bridge.cjs <filePath>");
  process.exit(1);
}

const absPath = path.resolve(filePath);
const PORT = Number(process.env.OPENCODE_VSCODE_PORT) || 51939;

/** HTTP 健康检查 */
function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? port : null);
    });
    req.setTimeout(500, () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

/** 通过 HTTP API 格式化文件（VS Code 扩展方案） */
function formatViaExtension(port) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ filePath: absPath });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/format",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeout: 5000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString());
            if (result.error) {
              reject(new Error(result.error));
            } else {
              resolve(result);
            }
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  const port = await probeHealth(PORT);

  if (port) {
    try {
      await formatViaExtension(port);
      process.exit(0);
    } catch {
      // 扩展调用失败，由 OpenCode 内置 prettier 兜底
    }
  }

  // 不可用，原样返回
  const now = new Date();
  fs.utimesSync(absPath, now, now);
  process.exit(0);
}

main();
