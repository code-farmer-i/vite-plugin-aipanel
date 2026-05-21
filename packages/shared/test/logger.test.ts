import { describe, expect, it } from "vitest";
import {
  LogLevel,
  configureLogger,
  setVerbose,
  generateTraceId,
  formatBytes,
  formatDuration,
  PerformanceTimer,
  RequestContext,
  createLogger,
} from "../src/logger";

describe("LogLevel", () => {
  it("应该定义正确的日志级别", () => {
    expect(LogLevel.DEBUG).toBe(0);
    expect(LogLevel.INFO).toBe(1);
    expect(LogLevel.WARN).toBe(2);
    expect(LogLevel.ERROR).toBe(3);
    expect(LogLevel.NONE).toBe(4);
  });
});

describe("configureLogger / setVerbose", () => {
  it("configureLogger 应该接受部分配置", () => {
    expect(() => configureLogger({ showTimestamp: false, showCaller: false })).not.toThrow();
  });

  it("setVerbose(true) 应该启用调试模式", () => {
    expect(() => setVerbose(true)).not.toThrow();
  });

  it("setVerbose(false) 应该禁用调试模式", () => {
    expect(() => setVerbose(false)).not.toThrow();
  });
});

describe("generateTraceId", () => {
  it("应该生成格式正确的 trace id", () => {
    const traceId = generateTraceId();
    expect(traceId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("每次调用应该生成不同的 trace id", () => {
    const id1 = generateTraceId();
    const id2 = generateTraceId();
    expect(id1).not.toBe(id2);
  });
});

describe("formatBytes", () => {
  it("应该格式化 0 字节", () => {
    expect(formatBytes(0)).toBe("0B");
  });

  it("应该格式化字节为可读格式", () => {
    expect(formatBytes(500)).toBe("500B");
    expect(formatBytes(1024)).toBe("1KB");
    expect(formatBytes(1048576)).toBe("1MB");
    expect(formatBytes(1073741824)).toBe("1GB");
  });
});

describe("formatDuration", () => {
  it("应该格式化毫秒", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("应该格式化秒", () => {
    expect(formatDuration(1500)).toBe("1.50s");
  });

  it("应该格式化分钟", () => {
    expect(formatDuration(125000)).toMatch(/^\d+m \d+s$/);
  });
});

describe("PerformanceTimer", () => {
  it("应该创建 timer 并记录", () => {
    const timer = new PerformanceTimer("testOperation");
    expect(timer).toBeDefined();
    const duration = timer.end();
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("应该带上下文创建 timer", () => {
    const timer = new PerformanceTimer("testOperation", { key: "value" });
    const duration = timer.end();
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("checkpoint 应该记录中间点", () => {
    const timer = new PerformanceTimer("testOperation");
    const elapsed = timer.checkpoint("step1");
    expect(elapsed).toBeGreaterThanOrEqual(0);
    timer.end();
  });

  it("end 返回 duration 应该 >= 0", () => {
    const timer = new PerformanceTimer("quick");
    const d = timer.end();
    expect(d).toBeGreaterThanOrEqual(0);
  });
});

describe("RequestContext", () => {
  it("应该创建请求上下文并包含 traceId", () => {
    const ctx = new RequestContext("GET", "/api/test");
    expect(ctx.traceId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(ctx.method).toBe("GET");
    expect(ctx.path).toBe("/api/test");
  });

  it("checkpoint 应该记录中间点", () => {
    const ctx = new RequestContext("POST", "/api/data");
    ctx.checkpoint("fetching");
    ctx.checkpoint("processing");
    ctx.end(200);
  });

  it("end 应该接受状态码", () => {
    const ctx = new RequestContext("GET", "/api/ok");
    ctx.end(200);
  });

  it("error 应该被正确处理", () => {
    const ctx = new RequestContext("GET", "/api/error");
    ctx.error(new Error("test error"));
  });

  it("error 应该接受非 Error 类型", () => {
    const ctx = new RequestContext("GET", "/api/error");
    ctx.error("string error");
  });
});

describe("createLogger", () => {
  it("应该创建带模块名的 logger", () => {
    const myLogger = createLogger("TestModule");
    expect(myLogger).toBeDefined();
    expect(typeof myLogger.debug).toBe("function");
    expect(typeof myLogger.info).toBe("function");
    expect(typeof myLogger.warn).toBe("function");
    expect(typeof myLogger.error).toBe("function");
    expect(typeof myLogger.timer).toBe("function");
  });

  it("应该能创建 timer", () => {
    const myLogger = createLogger("TestModule");
    const timer = myLogger.timer("testOp");
    expect(timer).toBeInstanceOf(PerformanceTimer);
    timer.end();
  });

  it("各日志方法应该不抛出异常", () => {
    const myLogger = createLogger("TestModule");

    expect(() => myLogger.debug("debug message")).not.toThrow();
    expect(() => myLogger.info("info message")).not.toThrow();
    expect(() => myLogger.warn("warn message")).not.toThrow();
    expect(() => myLogger.error("error message")).not.toThrow();

    const ctx = { module: "TestModule", operation: "test" };
    expect(() => myLogger.debug("debug with context", ctx)).not.toThrow();
  });
});
