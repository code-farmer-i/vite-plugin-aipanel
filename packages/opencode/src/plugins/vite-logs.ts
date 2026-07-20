/**
 * @fileoverview Vite 开发服务器日志工具插件
 * @description 为 OpenCode Agent 提供 get_vite_dev_logs 工具
 */

import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { createLogger } from "@vite-plugin-opencode-assistant/shared/node";

const log = createLogger("OpenCodePluginViteLogs");

/**
 * Vite 开发服务器日志工具插件
 *
 * 通过环境变量 OPENCODE_VITE_LOGS_API_URL 获取日志 API 地址
 * Agent 可以调用 get_vite_dev_logs 工具获取 Vite 开发服务器的进程日志
 */
export const ViteLogsPlugin: Plugin = async (): Promise<Hooks> => {
  log.info("ViteLogsPlugin loading...");

  const logsApiUrl = process.env.OPENCODE_VITE_LOGS_API_URL;
  log.debug("Vite Logs API URL:", { logsApiUrl });

  if (!logsApiUrl) {
    log.warn("OPENCODE_VITE_LOGS_API_URL is not set, vite logs plugin will not work");
    return {};
  }

  log.info("Plugin initialized successfully");

  // 定义 get_vite_dev_logs 工具
  const getViteDevLogsTool = tool({
    description: `获取 Vite 开发服务器的运行日志。

**何时使用此工具**：
- 用户报告"页面没更新"、"热更新不工作"、"HMR 失效"时
- 构建报错或编译失败，需要查看详细错误信息
- 页面白屏、样式丢失、模块加载失败等开发问题
- 用户提到"开发服务器有问题"、"vite 报错"
- 需要确认最近的文件变更是否被 Vite 正确处理

**日志内容**：
- Vite HMR 热更新日志（哪些文件被更新、更新状态）
- 构建编译日志（错误、警告、成功信息）
- OpenCode Web 进程输出
- 插件运行日志

日志保存在内存缓冲区（最近 500 条）。`,
    args: {
      level: tool.schema
        .string()
        .optional()
        .describe(
          "日志级别过滤：error(错误)、warn(警告)、info(信息)、debug(调试)、log(普通)。多个用逗号分隔，如 'error,warn'",
        ),
      limit: tool.schema
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(50)
        .describe("返回条数，默认 50，最大 200"),
      source: tool.schema
        .string()
        .optional()
        .describe("来源过滤：console(控制台)、opencode-stdout(服务输出)、opencode-stderr(服务错误)"),
    },
    async execute(args, context) {
      const { level, limit, source } = args;

      log.debug("get_vite_dev_logs called", {
        args,
        sessionID: context.sessionID,
        directory: context.directory,
      });

      try {
        // 构建请求 URL
        const url = new URL(logsApiUrl);
        if (level) url.searchParams.set("level", level);
        if (limit) url.searchParams.set("limit", String(limit));
        if (source) url.searchParams.set("source", source);

        log.debug("Fetching logs from", { url: url.toString() });

        // 发送请求
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: context.abort,
        });

        if (!response.ok) {
          const errorText = await response.text();
          log.error("Failed to fetch logs", { status: response.status, error: errorText });
          return `获取日志失败: HTTP ${response.status} - ${errorText}`;
        }

        const data = (await response.json()) as {
          logs: Array<{
            level: string;
            message: string;
            timestamp: string;
            source?: string;
          }>;
          meta: {
            total: number;
            returned: number;
            filters: Record<string, unknown>;
          };
        };

        log.debug("Logs fetched successfully", {
          count: data.logs.length,
          total: data.meta.total,
        });

        // 格式化输出
        if (data.logs.length === 0) {
          return `当前没有符合条件的日志（缓冲区共 ${data.meta.total} 条）。

建议：
- 不指定参数获取所有日志
- 使用 level=error,warn 获取错误和警告`;
        }

        // 格式化日志为易读格式
        const formattedLogs = data.logs
          .map((entry) => {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            const levelIcon =
              entry.level === "error" ? "❌"
              : entry.level === "warn" ? "⚠️"
              : entry.level === "info" ? "ℹ️"
              : "";
            return `${time} ${levelIcon} ${entry.message}`;
          })
          .join("\n");

        return `Vite 开发服务器日志（${data.meta.returned}/${data.meta.total} 条）：

${formattedLogs}`;
      } catch (error) {
        const err = error as Error;

        if (context.abort.aborted) {
          log.debug("Request aborted");
          return "请求已取消";
        }

        log.error("Error fetching vite logs", { error: err });
        return `获取日志时发生错误: ${err.message}`;
      }
    },
  });

  return {
    tool: {
      get_vite_dev_logs: getViteDevLogsTool,
    },
  };
};

export default ViteLogsPlugin;