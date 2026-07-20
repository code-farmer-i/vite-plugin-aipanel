import { LOG_PREFIX } from "./constants";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogContext {
  module?: string;
  operation?: string;
  traceId?: string;
  duration?: number;
  error?: Error | unknown;
  [key: string]: unknown;
}

export interface LoggerConfig {
  verbose: boolean;
  level: LogLevel;
  showTimestamp: boolean;
  showCaller: boolean;
  showTrace: boolean;
  indent: string;
}

export const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.NONE]: "NONE",
};

let traceCounter = 0;

let globalConfig: LoggerConfig = {
  verbose: false,
  level: LogLevel.INFO,
  showTimestamp: true,
  showCaller: true,
  showTrace: false,
  indent: "  ",
};

export function getConfig(): LoggerConfig {
  return globalConfig;
}

export function configureLogger(options: Partial<LoggerConfig>): void {
  globalConfig = { ...globalConfig, ...options };
}

export function setVerbose(verbose: boolean): void {
  globalConfig.verbose = verbose;
  globalConfig.level = verbose ? LogLevel.DEBUG : LogLevel.INFO;
}

export function getTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

export function formatValue(value: unknown, depth: number = 0): string {
  if (depth > 3) return "...";

  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return depth > 0 ? `"${value}"` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.length > 5) {
      const items = value.slice(0, 3).map((v) => formatValue(v, depth + 1));
      return `[${items.join(", ")}, ... ${value.length - 3} more items]`;
    }
    const items = value.map((v) => formatValue(v, depth + 1));
    return `[${items.join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    if (entries.length > 5) {
      const shown = entries.slice(0, 3).map(([k, v]) => `${k}: ${formatValue(v, depth + 1)}`);
      return `{${shown.join(", ")}, ... ${entries.length - 3} more keys}`;
    }
    const formatted = entries.map(([k, v]) => `${k}: ${formatValue(v, depth + 1)}`);
    return `{${formatted.join(", ")}}`;
  }
  return String(value);
}

export function formatContext(context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) return "";

  const parts: string[] = [];

  if (context.module) parts.push(`[${context.module}]`);
  if (context.operation) parts.push(`(${context.operation})`);
  if (context.traceId) parts.push(`trace:${context.traceId}`);
  if (context.duration !== undefined) parts.push(`${context.duration}ms`);

  const extraKeys = Object.keys(context).filter(
    (k) => !["module", "operation", "traceId", "duration", "error"].includes(k),
  );
  if (extraKeys.length > 0) {
    const extra: Record<string, unknown> = {};
    extraKeys.forEach((k) => (extra[k] = context[k]));
    parts.push(formatValue(extra));
  }

  return parts.join(" ");
}

export function generateTraceId(): string {
  traceCounter++;
  const timestamp = Date.now().toString(36);
  const counter = traceCounter.toString(36).padStart(4, "0");
  return `${timestamp}-${counter}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))}${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * 格式化日志消息
 */
export function formatLogMessage(
  level: LogLevel,
  message: string,
  context?: LogContext,
  ...args: unknown[]
): string {
  const parts: string[] = [];

  if (getConfig().showTimestamp) {
    parts.push(getTimestamp());
  }

  parts.push(LEVEL_NAMES[level].padEnd(5));
  parts.push(LOG_PREFIX);

  const contextStr = formatContext(context);
  if (contextStr) {
    parts.push(contextStr);
  }

  parts.push(message);

  const formattedArgs = args.map((a) => formatValue(a)).join(" ");
  if (formattedArgs) {
    parts.push(formattedArgs);
  }

  return parts.join(" ");
}
