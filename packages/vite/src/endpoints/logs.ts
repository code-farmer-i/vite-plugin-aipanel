/**
 * @fileoverview 进程日志端点
 * @description 提供 HTTP API 获取 Vite 进程日志缓冲区内容
 */

import type { ViteDevServer } from "vite";
import { getProcessLogBuffer, type ProcessLogEntry } from "@vite-plugin-opencode-assistant/shared/node";
import {
  RequestContext,
  createLogger,
} from "@vite-plugin-opencode-assistant/shared/node";
import { LOGS_API_PATH } from "@vite-plugin-opencode-assistant/shared";

const log = createLogger("Endpoints:Logs");

/**
 * 设置日志端点
 */
export function setupLogsEndpoint(server: ViteDevServer) {
  server.middlewares.use(LOGS_API_PATH, async (req, res) => {
    const reqCtx = new RequestContext(req.method || "GET", LOGS_API_PATH);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      reqCtx.end(200);
      return;
    }

    const buffer = getProcessLogBuffer();

    // GET - 获取日志
    if (req.method === "GET") {
      try {
        // 解析查询参数
        const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
        const levelParam = url.searchParams.get("level");
        const limitParam = url.searchParams.get("limit");
        const sourceParam = url.searchParams.get("source");
        const sinceParam = url.searchParams.get("since");

        // 构建过滤选项
        const options: {
          level?: ProcessLogEntry["level"] | ProcessLogEntry["level"][];
          limit?: number;
          source?: ProcessLogEntry["source"];
          since?: string;
        } = {};

        if (levelParam) {
          // 支持多个级别，用逗号分隔
          const levels = levelParam.split(",").map((l) => l.trim() as ProcessLogEntry["level"]);
          options.level = levels.length === 1 ? levels[0] : levels;
        }

        if (limitParam) {
          const limit = parseInt(limitParam, 10);
          if (limit > 0 && limit <= 1000) {
            options.limit = limit;
          }
        }

        if (sourceParam) {
          options.source = sourceParam as ProcessLogEntry["source"];
        }

        if (sinceParam) {
          options.since = sinceParam;
        }

        const logs = buffer.getLogs(options);

        log.debug("Logs requested", {
          params: { level: levelParam, limit: limitParam, source: sourceParam, since: sinceParam },
          resultCount: logs.length,
          bufferSize: buffer.size(),
        });

        res.writeHead(200);
        res.end(
          JSON.stringify({
            logs,
            meta: {
              total: buffer.size(),
              returned: logs.length,
              filters: options,
            },
          }),
        );
        reqCtx.end(200);
      } catch (e) {
        log.error("Failed to get logs", { error: e });
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Internal server error" }));
        reqCtx.error(e);
      }
      return;
    }

    // DELETE - 清空日志缓冲区
    if (req.method === "DELETE") {
      buffer.clear();
      log.info("Log buffer cleared");

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: "Log buffer cleared" }));
      reqCtx.end(200);
      return;
    }

    res.writeHead(405);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    reqCtx.end(405);
  });
}
