/**
 * @fileoverview 进程日志捕获器
 * @description 拦截 console 方法并存储日志到内存缓冲区，供 agent 通过工具获取
 */

export interface ProcessLogEntry {
  /** 日志级别 */
  level: "log" | "info" | "warn" | "error" | "debug";
  /** 日志内容（已序列化为字符串） */
  message: string;
  /** 时间戳（ISO 格式） */
  timestamp: string;
  /** 来源标识 */
  source?: "console" | "provider-stdout" | "provider-stderr" | "vite";
}

export interface ProcessLogBufferOptions {
  /** 最大日志条数，默认 500 */
  maxSize?: number;
  /** 是否启用捕获，默认 true */
  enabled?: boolean;
}

const DEFAULT_MAX_SIZE = 500;

/**
 * 进程日志缓冲区
 */
class ProcessLogBuffer {
  private buffer: ProcessLogEntry[] = [];
  private maxSize: number;
  private enabled: boolean = true;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  } | null = null;

  constructor(options: ProcessLogBufferOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.enabled = options.enabled ?? true;
  }

  /**
   * 启动 console 拦截
   */
  intercept(): void {
    if (this.originalConsole) {
      return; // 已经拦截了
    }

    // 保存原始 console 方法
    this.originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    // 替换 console 方法
    console.log = this.createInterceptor("log", this.originalConsole.log);
    console.info = this.createInterceptor("info", this.originalConsole.info);
    console.warn = this.createInterceptor("warn", this.originalConsole.warn);
    console.error = this.createInterceptor("error", this.originalConsole.error);
    console.debug = this.createInterceptor("debug", this.originalConsole.debug);
  }

  /**
   * 停止拦截，恢复原始 console
   */
  restore(): void {
    if (!this.originalConsole) {
      return;
    }

    console.log = this.originalConsole.log;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.debug = this.originalConsole.debug;
    this.originalConsole = null;
  }

  /**
   * 创建拦截器函数
   */
  private createInterceptor(
    level: ProcessLogEntry["level"],
    original: typeof console.log,
  ): typeof console.log {
    return (...args: unknown[]): void => {
      // 先调用原始方法，确保正常输出
      original.apply(console, args);

      // 如果启用捕获，存储到缓冲区
      if (this.enabled) {
        this.addEntry({
          level,
          message: this.serializeArgs(args),
          timestamp: new Date().toISOString(),
          source: "console",
        });
      }
    };
  }

  /**
   * 序列化参数为字符串
   */
  private serializeArgs(args: unknown[]): string {
    return args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }
        if (typeof arg === "number" || typeof arg === "boolean") {
          return String(arg);
        }
        if (arg === null) {
          return "null";
        }
        if (arg === undefined) {
          return "undefined";
        }
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(" ");
  }

  /**
   * 添加日志条目
   */
  addEntry(entry: ProcessLogEntry): void {
    if (!this.enabled) {
      return;
    }

    // 如果超过最大大小，移除最早的条目
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }

    this.buffer.push(entry);
  }

  /**
   * 添加 Provider stdout 日志
   */
  addProviderStdout(message: string): void {
    this.addEntry({
      level: "info",
      message,
      timestamp: new Date().toISOString(),
      source: "provider-stdout",
    });
  }

  /**
   * 添加 Provider stderr 日志
   */
  addProviderStderr(message: string): void {
    this.addEntry({
      level: "error",
      message,
      timestamp: new Date().toISOString(),
      source: "provider-stderr",
    });
  }

  /**
   * 获取日志
   * @param options 过滤选项
   */
  getLogs(
    options: {
      level?: ProcessLogEntry["level"] | ProcessLogEntry["level"][];
      limit?: number;
      source?: ProcessLogEntry["source"];
      since?: string; // ISO 时间戳
    } = {},
  ): ProcessLogEntry[] {
    let logs = [...this.buffer];

    // 按级别过滤
    if (options.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      logs = logs.filter((log) => levels.includes(log.level));
    }

    // 按来源过滤
    if (options.source) {
      logs = logs.filter((log) => log.source === options.source);
    }

    // 按时间过滤
    if (options.since) {
      const sinceDate = new Date(options.since);
      logs = logs.filter((log) => new Date(log.timestamp) >= sinceDate);
    }

    // 限制数量（返回最新的）
    if (options.limit && options.limit > 0) {
      logs = logs.slice(-options.limit);
    }

    return logs;
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * 获取缓冲区大小
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * 启用/禁用捕获
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 获取是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// 全局单例
let globalBuffer: ProcessLogBuffer | null = null;

/**
 * 获取全局日志缓冲区
 */
export function getProcessLogBuffer(options?: ProcessLogBufferOptions): ProcessLogBuffer {
  if (!globalBuffer) {
    globalBuffer = new ProcessLogBuffer(options);
  }
  return globalBuffer;
}

/**
 * 初始化进程日志捕获
 */
export function initProcessLogCapture(options?: ProcessLogBufferOptions): ProcessLogBuffer {
  const buffer = getProcessLogBuffer(options);
  buffer.intercept();
  return buffer;
}

/**
 * 停止进程日志捕获
 */
export function stopProcessLogCapture(): void {
  if (globalBuffer) {
    globalBuffer.restore();
  }
}
