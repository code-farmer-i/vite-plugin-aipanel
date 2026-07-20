import { LOG_PREFIX } from "./constants";
import {
  LogLevel,
  type LogContext,
  getConfig,
  formatContext,
  formatValue,
  generateTraceId as _generateTraceId,
} from "./logger-core";

// ============== Node 环境样式增强 ==============

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: COLORS.cyan,
  [LogLevel.INFO]: COLORS.green,
  [LogLevel.WARN]: COLORS.yellow,
  [LogLevel.ERROR]: COLORS.red,
  [LogLevel.NONE]: COLORS.reset,
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.NONE]: "NONE",
};

function getTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function getCallerInfo(depth: number = 3): string {
  const stack = new Error().stack;
  if (!stack) return "";

  const lines = stack.split("\n");
  const targetLine = lines[depth];
  if (!targetLine) return "";

  const match = targetLine.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
  if (!match) return "";

  const [, funcName, filePath, line] = match;
  const fileName = filePath.split("/").pop() || filePath;
  const func = funcName || "<anonymous>";
  return `${fileName}:${line} ${func}`;
}

function log(level: LogLevel, message: string, context?: LogContext, ...args: unknown[]): void {
  if (level < getConfig().level) return;

  const parts: string[] = [];

  parts.push(`${COLORS.dim}[${process.pid}]${COLORS.reset}`);

  if (getConfig().showTimestamp) {
    parts.push(`${COLORS.dim}${getTimestamp()}${COLORS.reset}`);
  }

  const levelColor = LEVEL_COLORS[level];
  const levelName = LEVEL_NAMES[level].padEnd(5);
  parts.push(`${levelColor}${levelName}${COLORS.reset}`);

  parts.push(`${COLORS.bright}${LOG_PREFIX}${COLORS.reset}`);

  const contextStr = formatContext(context);
  if (contextStr) {
    parts.push(`${COLORS.magenta}${contextStr}${COLORS.reset}`);
  }

  parts.push(message);

  if (getConfig().showCaller && level >= LogLevel.WARN) {
    const caller = getCallerInfo(4);
    if (caller) {
      parts.push(`${COLORS.dim}(${caller})${COLORS.reset}`);
    }
  }

  const formattedArgs = args.map((a) => formatValue(a)).join(" ");
  if (formattedArgs) {
    parts.push(formattedArgs);
  }

  if (context?.error) {
    const err = context.error;
    if (err instanceof Error) {
      parts.push(`${COLORS.red}Error: ${err.message}${COLORS.reset}`);
      if (level >= LogLevel.ERROR && getConfig().showTrace && err.stack) {
        console.error(`${COLORS.dim}${err.stack}${COLORS.reset}`);
      }
    } else {
      parts.push(`${COLORS.red}Error: ${formatValue(err)}${COLORS.reset}`);
    }
  }

  const output = parts.join(" ");

  if (level >= LogLevel.ERROR) {
    console.error(output);
  } else if (level === LogLevel.WARN) {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const nodeLogger = {
  debug(message: string, context?: LogContext, ...args: unknown[]): void {
    log(LogLevel.DEBUG, message, context, ...args);
  },

  info(message: string, context?: LogContext, ...args: unknown[]): void {
    log(LogLevel.INFO, message, context, ...args);
  },

  warn(message: string, context?: LogContext, ...args: unknown[]): void {
    log(LogLevel.WARN, message, context, ...args);
  },

  error(message: string, context?: LogContext, ...args: unknown[]): void {
    log(LogLevel.ERROR, message, context, ...args);
  },

  group(label: string, context?: LogContext): void {
    if (!getConfig().verbose) return;
    const contextStr = formatContext(context);
    console.log(
      `${COLORS.dim}[${process.pid}]${COLORS.reset} ${COLORS.bright}${LOG_PREFIX}${COLORS.reset} ${COLORS.blue}▼${COLORS.reset} ${label}${contextStr ? ` ${contextStr}` : ""}`,
    );
  },

  groupEnd(): void {
    if (!getConfig().verbose) return;
  },
};

export function createNodeLogger(module: string) {
  return {
    debug(message: string, context?: Omit<LogContext, "module">, ...args: unknown[]): void {
      nodeLogger.debug(message, { ...context, module }, ...args);
    },

    info(message: string, context?: Omit<LogContext, "module">, ...args: unknown[]): void {
      nodeLogger.info(message, { ...context, module }, ...args);
    },

    warn(message: string, context?: Omit<LogContext, "module">, ...args: unknown[]): void {
      nodeLogger.warn(message, { ...context, module }, ...args);
    },

    error(message: string, context?: Omit<LogContext, "module">, ...args: unknown[]): void {
      nodeLogger.error(message, { ...context, module }, ...args);
    },

    timer(operation: string, context?: Omit<LogContext, "module">): PerformanceTimer {
      return new PerformanceTimer(operation, { ...context, module });
    },
  };
}

// ============== Node 专用工具类 ==============

export class PerformanceTimer {
  private startTime: number;
  private context: LogContext;
  private operation: string;

  constructor(operation: string, context?: LogContext) {
    this.operation = operation;
    this.context = context || {};
    this.startTime = performance.now();

    nodeLogger.debug(`⏱️  Starting: ${operation}`, this.context);
  }

  end(message?: string): number {
    const duration = Math.round(performance.now() - this.startTime);
    const msg = message || `✓ Completed: ${this.operation}`;
    nodeLogger.debug(msg, { ...this.context, duration });
    return duration;
  }

  checkpoint(label: string): number {
    const elapsed = Math.round(performance.now() - this.startTime);
    nodeLogger.debug(`  ↳ ${label}`, { ...this.context, duration: elapsed });
    return elapsed;
  }
}

export class RequestContext {
  traceId: string;
  method: string;
  path: string;
  startTime: number;
  private checkpoints: Array<{ time: number; label: string }> = [];

  constructor(method: string, path: string) {
    this.traceId = _generateTraceId();
    this.method = method;
    this.path = path;
    this.startTime = performance.now();

    nodeLogger.debug(`→ ${method} ${path}`, { traceId: this.traceId, module: "HTTP" });
  }

  checkpoint(label: string): void {
    const elapsed = Math.round(performance.now() - this.startTime);
    this.checkpoints.push({ time: elapsed, label });
    nodeLogger.debug(`  → ${label}`, { traceId: this.traceId, duration: elapsed });
  }

  end(statusCode: number): void {
    const duration = Math.round(performance.now() - this.startTime);
    const statusColor = statusCode < 400 ? COLORS.green : COLORS.red;
    nodeLogger.debug(`← ${this.method} ${this.path} ${statusColor}${statusCode}${COLORS.reset}`, {
      traceId: this.traceId,
      duration,
      checkpoints: this.checkpoints.length,
    });
  }

  error(error: Error | unknown): void {
    const duration = Math.round(performance.now() - this.startTime);
    nodeLogger.error(`✗ ${this.method} ${this.path}`, {
      traceId: this.traceId,
      duration,
      error,
    });
  }
}

export function logMethod(
  target: unknown,
  propertyKey: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  const originalMethod = descriptor.value;
  const className = (target as { constructor: { name: string } }).constructor.name;

  descriptor.value = async function (...args: unknown[]) {
    const timer = new PerformanceTimer(`${className}.${propertyKey}`);
    try {
      const result = await originalMethod.apply(this, args);
      timer.end();
      return result;
    } catch (error) {
      timer.end("❌ Failed");
      throw error;
    }
  };

  return descriptor;
}

// ============== 以标准名称导出 Node 增强版 ==============
// server 端从 @vite-plugin-opencode-assistant/shared/node 导入即可获得 Node 版本
export { nodeLogger as logger };
export { createNodeLogger as createLogger };
