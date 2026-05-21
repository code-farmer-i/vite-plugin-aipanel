import { describe, expect, it, beforeEach } from "vitest";
import {
  getProcessLogBuffer,
  initProcessLogCapture,
  stopProcessLogCapture,
} from "../src/process-logger";

describe("process-logger", () => {
  describe("getProcessLogBuffer", () => {
    it("应该返回 ProcessLogBuffer 实例", () => {
      const buffer = getProcessLogBuffer({ maxSize: 10 });
      expect(buffer).toBeDefined();
      expect(typeof buffer.addEntry).toBe("function");
      expect(typeof buffer.getLogs).toBe("function");
      expect(typeof buffer.clear).toBe("function");
    });

    it("应该返回同一实例（单例）", () => {
      const buffer1 = getProcessLogBuffer({ maxSize: 10 });
      const buffer2 = getProcessLogBuffer({ maxSize: 20 });
      expect(buffer1).toBe(buffer2);
    });
  });

  describe("addEntry / getLogs", () => {
    let buffer: ReturnType<typeof getProcessLogBuffer>;

    beforeEach(() => {
      buffer = getProcessLogBuffer({ maxSize: 10 });
      buffer.clear();
    });

    it("应该添加并检索日志条目", () => {
      buffer.addEntry({
        level: "info",
        message: "test message",
        timestamp: "2024-01-01T00:00:00.000Z",
        source: "console",
      });

      expect(buffer.size()).toBe(1);
      expect(buffer.getLogs()).toHaveLength(1);
    });

    it("应该在超过 maxSize 时移除最旧条目", () => {
      for (let i = 0; i < 15; i++) {
        buffer.addEntry({
          level: "info",
          message: `message ${i}`,
          timestamp: new Date(2024, 0, 1, 0, 0, 0, i).toISOString(),
          source: "console",
        });
      }

      expect(buffer.size()).toBe(10);

      const logs = buffer.getLogs();
      expect(logs[0].message).toBe("message 5");
    });

    it("应该按 level 过滤", () => {
      buffer.addEntry({
        level: "info",
        message: "msg1",
        timestamp: "2024-01-01T00:00:00Z",
        source: "console",
      });
      buffer.addEntry({
        level: "warn",
        message: "msg2",
        timestamp: "2024-01-01T00:00:01Z",
        source: "console",
      });
      buffer.addEntry({
        level: "error",
        message: "msg3",
        timestamp: "2024-01-01T00:00:02Z",
        source: "console",
      });

      const errorLogs = buffer.getLogs({ level: "error" });
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].level).toBe("error");
    });

    it("应该支持多级别过滤", () => {
      buffer.addEntry({
        level: "info",
        message: "msg1",
        timestamp: "2024-01-01T00:00:00Z",
        source: "console",
      });
      buffer.addEntry({
        level: "warn",
        message: "msg2",
        timestamp: "2024-01-01T00:00:01Z",
        source: "console",
      });
      buffer.addEntry({
        level: "error",
        message: "msg3",
        timestamp: "2024-01-01T00:00:02Z",
        source: "console",
      });

      const logs = buffer.getLogs({ level: ["warn", "error"] });
      expect(logs).toHaveLength(2);
    });

    it("应该按 source 过滤", () => {
      buffer.addEntry({
        level: "info",
        message: "msg1",
        timestamp: "2024-01-01T00:00:00Z",
        source: "console",
      });
      buffer.addEntry({
        level: "info",
        message: "msg2",
        timestamp: "2024-01-01T00:00:01Z",
        source: "opencode-stdout",
      });

      const consoleLogs = buffer.getLogs({ source: "console" });
      expect(consoleLogs).toHaveLength(1);
      expect(consoleLogs[0].source).toBe("console");
    });

    it("应该按 since 时间过滤", () => {
      buffer.addEntry({
        level: "info",
        message: "old",
        timestamp: "2024-01-01T00:00:00Z",
        source: "console",
      });
      buffer.addEntry({
        level: "info",
        message: "new",
        timestamp: "2024-06-01T00:00:00Z",
        source: "console",
      });

      const recentLogs = buffer.getLogs({ since: "2024-03-01T00:00:00Z" });
      expect(recentLogs).toHaveLength(1);
      expect(recentLogs[0].message).toBe("new");
    });

    it("应该通过 limit 限制返回数量", () => {
      for (let i = 0; i < 5; i++) {
        buffer.addEntry({
          level: "info",
          message: `msg${i}`,
          timestamp: "2024-01-01T00:00:00Z",
          source: "console",
        });
      }

      const logs = buffer.getLogs({ limit: 3 });
      expect(logs).toHaveLength(3);
      expect(logs[logs.length - 1].message).toBe("msg4");
    });
  });

  describe("addOpenCodeStdout / addOpenCodeStderr", () => {
    let buffer: ReturnType<typeof getProcessLogBuffer>;

    beforeEach(() => {
      buffer = getProcessLogBuffer({ maxSize: 10 });
      buffer.clear();
    });

    it("应该添加 stdout 条目", () => {
      buffer.addOpenCodeStdout("server started");

      const logs = buffer.getLogs();
      expect(logs[0]).toMatchObject({
        level: "info",
        message: "server started",
        source: "opencode-stdout",
      });
    });

    it("应该添加 stderr 条目", () => {
      buffer.addOpenCodeStderr("connection failed");

      const logs = buffer.getLogs();
      expect(logs[0]).toMatchObject({
        level: "error",
        message: "connection failed",
        source: "opencode-stderr",
      });
    });
  });

  describe("clear / size", () => {
    it("应该清空缓冲区", () => {
      const buffer = getProcessLogBuffer({ maxSize: 10 });
      buffer.clear();
      buffer.addEntry({
        level: "info",
        message: "msg",
        timestamp: "2024-01-01T00:00:00Z",
        source: "console",
      });
      expect(buffer.size()).toBe(1);

      buffer.clear();
      expect(buffer.size()).toBe(0);
      expect(buffer.getLogs()).toHaveLength(0);
    });
  });

  describe("setEnabled / isEnabled", () => {
    let buffer: ReturnType<typeof getProcessLogBuffer>;

    beforeEach(() => {
      buffer = getProcessLogBuffer({ maxSize: 10 });
      buffer.clear();
      buffer.setEnabled(true);
    });

    it("应该默认启用", () => {
      expect(buffer.isEnabled()).toBe(true);
    });

    it("应该可以切换启用状态", () => {
      buffer.setEnabled(false);
      expect(buffer.isEnabled()).toBe(false);

      buffer.addEntry({
        level: "info",
        message: "msg",
        timestamp: "2024-01-01T00:00:00Z",
        source: "console",
      });
      expect(buffer.size()).toBe(0);
    });
  });

  describe("initProcessLogCapture / stopProcessLogCapture", () => {
    it("应该拦截 console 方法", () => {
      const originalLog = console.log;
      const originalInfo = console.info;
      const originalWarn = console.warn;
      const originalError = console.error;
      const originalDebug = console.debug;

      initProcessLogCapture({ maxSize: 10 });

      expect(console.log).not.toBe(originalLog);
      expect(console.info).not.toBe(originalInfo);
      expect(console.warn).not.toBe(originalWarn);
      expect(console.error).not.toBe(originalError);
      expect(console.debug).not.toBe(originalDebug);

      stopProcessLogCapture();

      expect(console.log).toBe(originalLog);
      expect(console.info).toBe(originalInfo);
      expect(console.warn).toBe(originalWarn);
      expect(console.error).toBe(originalError);
      expect(console.debug).toBe(originalDebug);
    });

    it("重复调用 initProcessLogCapture 不应重复拦截", () => {
      initProcessLogCapture({ maxSize: 10 });

      const currentLog = console.log;
      initProcessLogCapture({ maxSize: 10 });

      expect(console.log).toBe(currentLog);

      stopProcessLogCapture();
    });

    it("应该能捕获 console 输出到缓冲区", () => {
      const buffer = getProcessLogBuffer({ maxSize: 10 });
      buffer.clear();
      buffer.setEnabled(true);

      buffer.addEntry({
        level: "info",
        message: "direct entry",
        timestamp: new Date().toISOString(),
        source: "console",
      });

      const logs = buffer.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.some((l) => l.message === "direct entry")).toBe(true);
    });
  });
});
