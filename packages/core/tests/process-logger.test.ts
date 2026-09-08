/**
 * @fileoverview 进程日志捕获器单测（packages/core/src/node/process-logger.ts，node 环境）
 * 模块内有全局单例 globalBuffer，且会改写 console 方法：
 * 每个用例用 vi.resetModules + 动态 import 获取全新模块实例，并在用例内替换
 * console 为静默 mock（捕获原始引用）后于 afterEach 恢复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ProcLoggerModule = typeof import("../src/node/process-logger");

let moduleRef: ProcLoggerModule | null = null;

const originalConsole: Record<string, unknown> = {};

beforeEach(() => {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    originalConsole[method] = console[method];
    console[method] = vi.fn();
  }
});

afterEach(() => {
  // 先停掉当前模块的拦截，把 console 恢复到替换后的 mock，再还原真实方法
  if (moduleRef) {
    try {
      moduleRef.stopProcessLogCapture();
    } catch {
      // ignore
    }
    moduleRef = null;
  }
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    // @ts-expect-error 恢复原始 console 方法
    console[method] = originalConsole[method];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function freshModule(): Promise<ProcLoggerModule> {
  vi.resetModules();
  moduleRef = await import("../src/node/process-logger");
  return moduleRef;
}

describe("console interception", () => {
  it("captures console calls with level, message, timestamp and source", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture();
    console.log("plain", 1);
    console.warn("careful");
    console.error("broken", { code: 1 });
    console.info("note");
    mod.stopProcessLogCapture();

    const logs = buffer.getLogs();
    expect(logs).toHaveLength(4);
    const [logEntry, warnEntry, errorEntry, infoEntry] = logs;
    expect(logEntry.level).toBe("log");
    expect(logEntry.message).toBe("plain 1");
    expect(logEntry.source).toBe("console");
    expect(Number.isNaN(Date.parse(logEntry.timestamp))).toBe(false);
    expect(warnEntry.level).toBe("warn");
    expect(warnEntry.message).toBe("careful");
    expect(errorEntry.message).toBe('broken {"code":1}'.replace('{"code":1}', '{\n  "code": 1\n}'));
    expect(infoEntry.level).toBe("info");
  });

  it("restores the console methods on stop", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture();
    const wrappedLog = console.log;
    mod.stopProcessLogCapture();
    expect(console.log).not.toBe(wrappedLog);
    // 拦截期间保存的 original 为 beforeEach 的 mock，还原后应回到 mock 而非原始真实方法；
    // 真实方法在 afterEach 统一恢复。
    expect(buffer.size()).toBe(0);
  });

  it("is idempotent: double init keeps a single interceptor", async () => {
    const mod = await freshModule();
    const first = mod.initProcessLogCapture();
    const second = mod.initProcessLogCapture({ maxSize: 2 });
    expect(second).toBe(first);
    console.log("x");
    expect(first.size()).toBe(1);
    mod.stopProcessLogCapture();
  });
});

describe("buffer semantics", () => {
  it("evicts the oldest entry beyond maxSize", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture({ maxSize: 3 });
    console.log("a");
    console.log("b");
    console.log("c");
    console.log("d");
    mod.stopProcessLogCapture();
    expect(buffer.size()).toBe(3);
    expect(buffer.getLogs().map((e) => e.message)).toEqual(["b", "c", "d"]);
  });

  it("stops capturing when disabled", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture({ enabled: false });
    console.log("ignored");
    expect(buffer.size()).toBe(0);
    buffer.setEnabled(true);
    console.log("kept");
    expect(buffer.size()).toBe(1);
    mod.stopProcessLogCapture();
  });

  it("adds provider stdout/stderr entries directly", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture();
    buffer.addProviderStdout("out line");
    buffer.addProviderStderr("err line");
    expect(buffer.size()).toBe(2);
    expect(buffer.getLogs()[0]).toMatchObject({
      level: "info",
      message: "out line",
      source: "provider-stdout",
    });
    expect(buffer.getLogs()[1]).toMatchObject({
      level: "error",
      message: "err line",
      source: "provider-stderr",
    });
  });

  it("records entries handed in via addEntry", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture();
    buffer.addEntry({ level: "log", message: "x", timestamp: "2024-01-01T00:00:00.000Z" });
    expect(buffer.getLogs().length).toBe(1);
    expect(buffer.getLogs()[0].message).toBe("x");
    mod.stopProcessLogCapture();
  });

  it("clear empties the buffer", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture();
    buffer.addProviderStdout("a");
    buffer.addProviderStderr("b");
    expect(buffer.size()).toBe(2);
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.getLogs()).toEqual([]);
  });
});

describe("getLogs filtering", () => {
  async function seed(): Promise<{
    mod: ProcLoggerModule;
    buffer: ReturnType<ProcLoggerModule["initProcessLogCapture"]>;
  }> {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture();
    buffer.addProviderStdout("stdout-a");
    buffer.addProviderStderr("stderr-b");
    buffer.addEntry({
      level: "warn",
      message: "manual",
      timestamp: "2024-01-01T00:00:00.000Z",
      source: "vite",
    });
    return { mod, buffer };
  }

  it("filters by level (single and list)", async () => {
    const { mod, buffer } = await seed();
    expect(buffer.getLogs({ level: "error" }).map((e) => e.message)).toEqual(["stderr-b"]);
    expect(buffer.getLogs({ level: ["warn", "error"] }).map((e) => e.message)).toEqual([
      "stderr-b",
      "manual",
    ]);
    mod.stopProcessLogCapture();
  });

  it("filters by source", async () => {
    const { mod, buffer } = await seed();
    const fromVite = buffer.getLogs({ source: "vite" });
    expect(fromVite).toHaveLength(1);
    expect(fromVite[0].message).toBe("manual");
    mod.stopProcessLogCapture();
  });

  it("filters by since timestamp", async () => {
    const { mod, buffer } = await seed();
    const nowIso = new Date(Date.now() + 1000).toISOString();
    expect(buffer.getLogs({ since: "2023-01-01T00:00:00.000Z" })).toHaveLength(3);
    expect(buffer.getLogs({ since: nowIso })).toHaveLength(0);
    mod.stopProcessLogCapture();
  });

  it("returns the newest entries when limiting", async () => {
    const { mod, buffer } = await seed();
    const limited = buffer.getLogs({ limit: 2 });
    expect(limited.map((e) => e.message)).toEqual(["stderr-b", "manual"]);
    mod.stopProcessLogCapture();
  });
});

describe("serialization of console args", () => {
  it("joins multiple formatted args into the message", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture({ enabled: false });
    // 直接经 interceptor 调用需要 enabled；这里用 enabled=false 则不会入缓冲，
    // 因此先启用在测 message 拼接
    buffer.setEnabled(true);
    console.log("count", 3, null, undefined, true);
    mod.stopProcessLogCapture();
    const entry = buffer.getLogs()[0];
    expect(entry.level).toBe("log");
    expect(entry.message).toBe("count 3 null undefined true");
  });

  it("pretty-prints object arguments", async () => {
    const mod = await freshModule();
    const buffer = mod.initProcessLogCapture({ enabled: true });
    console.log({ nested: { list: [1, 2] } });
    mod.stopProcessLogCapture();
    const entry = buffer.getLogs()[0];
    expect(entry.message).toBe('{\n  "nested": {\n    "list": [\n      1,\n      2\n    ]\n  }\n}');
  });
});
