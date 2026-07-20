import { LOG_PREFIX } from "./constants";
import {
  LogLevel,
  type LogContext,
  getConfig,
  getTimestamp,
  formatContext,
  formatValue,
} from "./logger-core";

/**
 * 浏览器端 logger（使用 %c CSS 样式，无 ANSI 颜色码、无 process.pid）
 * DEBUG → console.debug, INFO → console.log, WARN → console.warn, ERROR → console.error
 */

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO ",
  [LogLevel.WARN]: "WARN ",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.NONE]: "NONE ",
};

// 浏览器 console 颜色（对齐 ANSI 标准 16 色终端）
const C = {
  dim: "color: #888",
  bright: "font-weight: bold",
  red: "color: #cd0000; font-weight: bold",
  green: "color: #00cd00",
  yellow: "color: #cdcd00",
  blue: "color: #0000cd",
  magenta: "color: #cd00cd",
  cyan: "color: #00cdcd",
  reset: "",
} as const;

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: C.cyan,
  [LogLevel.INFO]: C.green,
  [LogLevel.WARN]: C.yellow,
  [LogLevel.ERROR]: C.red,
  [LogLevel.NONE]: C.reset,
};

function log(level: LogLevel, message: string, context?: LogContext, ...args: unknown[]): void {
  if (level < getConfig().level) return;

  const segments: string[] = [];
  const styles: string[] = [];

  // 时间戳（dim）
  if (getConfig().showTimestamp) {
    segments.push("%c%s");
    styles.push(C.dim, getTimestamp());
  }

  // 级别（对应颜色）
  segments.push(`%c${LEVEL_NAMES[level]}`);
  styles.push(LEVEL_COLORS[level]);

  // 前缀（bright）
  segments.push(`%c${LOG_PREFIX}`);
  styles.push(C.bright);

  // 模块（magenta）
  const ctxStr = formatContext(context);
  if (ctxStr) {
    segments.push(`%c${ctxStr}`);
    styles.push(C.magenta);
  }

  // 消息
  const formattedArgs = args.length > 0 ? ` ${args.map((a) => formatValue(a)).join(" ")}` : "";
  segments.push(`%c${message}${formattedArgs}`);
  styles.push(C.reset);

  const output = segments.join(" ");

  // 错误信息单独处理
  if (context?.error) {
    const err = context.error;
    if (err instanceof Error) {
      if (level >= LogLevel.ERROR && getConfig().showTrace && err.stack) {
        console.error(output, ...styles, `\n${err.stack}`);
      } else {
        console.error(output, ...styles, `\n%cError: ${err.message}`, C.red);
      }
    } else {
      console.error(output, ...styles, `\n%cError: ${formatValue(err)}`, C.red);
    }
    return;
  }

  if (level >= LogLevel.ERROR) {
    console.error(output, ...styles);
  } else if (level === LogLevel.WARN) {
    console.warn(output, ...styles);
  } else if (level === LogLevel.DEBUG) {
    console.debug(output, ...styles);
  } else {
    console.log(output, ...styles);
  }
}

export const logger = {
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
    console.group(
      `%c${LOG_PREFIX}%c ${label}`,
      C.bright,
      context?.module ? `%c[${context.module}]%c ` : C.reset,
      ...(context?.module ? [C.magenta, C.reset] : []),
    );
  },

  groupEnd(): void {
    if (!getConfig().verbose) return;
    console.groupEnd();
  },
};

export function createLogger(module: string) {
  return {
    debug(message: string, context?: Omit<LogContext, "module">, ...args: unknown[]): void {
      logger.debug(message, { ...context, module }, ...args);
    },

    info(message: string, context?: Omit<LogContext, "module">, ...args: unknown[]): void {
      logger.info(message, { ...context, module }, ...args);
    },

    warn(message: string, context?: Omit<LogContext, "module">, ...args: unknown[]): void {
      logger.warn(message, { ...context, module }, ...args);
    },

    error(message: string, context?: Omit<LogContext, "module">, ...args: unknown[]): void {
      logger.error(message, { ...context, module }, ...args);
    },
  };
}
