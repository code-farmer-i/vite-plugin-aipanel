import type { Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { LogFileConfig } from "@vite-plugin-opencode-assistant/shared";
import {
  setVerbose,
  createLogger,
  readLogFileTail,
} from "@vite-plugin-opencode-assistant/shared/node";
import type { FileLogEntry } from "@vite-plugin-opencode-assistant/shared/node";

// 子进程通过环境变量接收 verbose 配置
if (process.env.OPENCODE_VERBOSE === "1") {
  setVerbose(true);
}

const log = createLogger("ServiceLogsPlugin");

export default {
  id: "vite-plugin-opencode-assistant/service-logs",
  async server(): Promise<Hooks> {
    log.debug("ServiceLogsPlugin loading...");

    const logFilesJson = process.env.OPENCODE_LOG_FILES_JSON;
    log.debug("Log files JSON from env:", { logFilesJson: logFilesJson ? "set" : "not set" });

    if (!logFilesJson) {
      log.debug("OPENCODE_LOG_FILES_JSON is not set, service logs plugin will not register tools");
      return {};
    }

    let logFiles: LogFileConfig[];
    try {
      logFiles = JSON.parse(logFilesJson) as LogFileConfig[];
      log.debug("Parsed log files config", { count: logFiles.length });
    } catch (e) {
      log.error("Failed to parse OPENCODE_LOG_FILES_JSON", { error: e });
      return {};
    }

    if (!logFiles || logFiles.length === 0) {
      log.debug("No log files configured, plugin will not register any tools");
      return {};
    }

    const tools: Record<string, ReturnType<typeof tool>> = {};

    for (const logFileConfig of logFiles) {
      const toolName = `get_${logFileConfig.name}_logs`;

      const description = `获取 ${logFileConfig.name} 的日志。

**何时使用此工具**：
${logFileConfig.description}

**日志内容**：
- 来自日志文件 ${logFileConfig.path} 的实时日志
- 默认返回最近 200 行日志`;

      const getLogsTool = tool({
        description,
        args: {
          level: tool.schema
            .string()
            .optional()
            .describe(
              "日志级别过滤：error(错误)、warn(警告)、info(信息)。多个用逗号分隔，如 'error,warn'",
            ),
          limit: tool.schema
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .default(50)
            .describe("返回条数，默认 50，最大 200"),
        },
        async execute(args, context) {
          const { level, limit } = args;

          log.debug(`${toolName} called`, {
            args,
            sessionID: context.sessionID,
            directory: context.directory,
          });

          const requestedLimit = limit ?? 50;

          const entries = await readLogFileTail({
            name: logFileConfig.name,
            filePath: logFileConfig.path,
            projectRoot: context.directory,
            lines: Math.max(requestedLimit * 3, 500),
            level: level
              ? (level.split(",").map((l) => l.trim()) as ("info" | "warn" | "error")[])
              : undefined,
            limit: requestedLimit,
          });

          if (entries.length === 0) {
            return `当前没有符合条件的日志。

建议：
- 不指定参数获取所有日志
- 使用 level=error,warn 获取错误和警告`;
          }

          const formattedLogs = entries
            .map((entry: FileLogEntry) => {
              const levelIcon =
                entry.level === "error" ? "❌" : entry.level === "warn" ? "⚠️" : "ℹ️";
              return `${levelIcon} ${entry.message}`;
            })
            .join("\n");

          return `${logFileConfig.name} 日志（${entries.length} 条）：

${formattedLogs}`;
        },
      });

      tools[toolName] = getLogsTool;
      log.debug(`Registered tool: ${toolName}`);
    }

    log.debug(`Plugin initialized with ${Object.keys(tools).length} log tools`);

    return {
      tool: tools,
    };
  },
};
