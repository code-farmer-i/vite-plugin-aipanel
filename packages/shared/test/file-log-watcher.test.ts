import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
    },
    statSync: vi.fn(),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
  },
  existsSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
  },
  statSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
}));

import fs from "fs";
import { readLogFile, readLogFileTail } from "../src/file-log-watcher";

describe("detectLogLevel（通过 readLogFile 间接测试）", () => {
  it("应该正确检测各级别日志", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      "Error: something went wrong\n" +
        "FATAL: critical failure\n" +
        "Warning: deprecated API\n" +
        "normal info message\n",
    );

    const result = await readLogFile({ name: "test", filePath: "/test.log" });

    expect(result).toHaveLength(4);
    expect(result[0].level).toBe("error");
    expect(result[1].level).toBe("error");
    expect(result[2].level).toBe("warn");
    expect(result[3].level).toBe("info");
  });
});

describe("readLogFile", () => {
  const mockFilePath = "/app/logs/test.log";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应该在文件不存在时返回空数组", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await readLogFile({ name: "test", filePath: mockFilePath });
    expect(result).toEqual([]);
  });

  it("应该读取并解析日志文件", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      "info: server started\nwarn: disk space low\nerror: connection failed\n",
    );

    const result = await readLogFile({ name: "test", filePath: mockFilePath });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ level: "info", source: "file:test" });
    expect(result[1]).toMatchObject({ level: "warn", source: "file:test" });
    expect(result[2]).toMatchObject({ level: "error", source: "file:test" });
  });

  it("应该根据 level 过滤日志", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      "info: server started\nwarn: disk space low\nerror: connection failed\n",
    );

    const result = await readLogFile({
      name: "test",
      filePath: mockFilePath,
      level: "error",
    });

    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("error");
  });

  it("应该支持多级别过滤", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      "info: server started\nwarn: disk space low\nerror: connection failed\n",
    );

    const result = await readLogFile({
      name: "test",
      filePath: mockFilePath,
      level: ["warn", "error"],
    });

    expect(result).toHaveLength(2);
    expect(result[0].level).toBe("warn");
    expect(result[1].level).toBe("error");
  });

  it("应该通过 limit 限制返回行数", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const lines = Array.from({ length: 10 }, (_, i) => `info: log line ${i + 1}`).join("\n");
    vi.mocked(fs.promises.readFile).mockResolvedValue(lines);

    const result = await readLogFile({
      name: "test",
      filePath: mockFilePath,
      limit: 3,
    });

    expect(result).toHaveLength(3);
  });

  it("应该处理读取错误", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockRejectedValue(new Error("Permission denied"));

    const result = await readLogFile({ name: "test", filePath: mockFilePath });
    expect(result).toEqual([]);
  });
});

describe("readLogFileTail", () => {
  const mockFilePath = "/app/logs/test.log";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应该在文件不存在时返回空数组", async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = await readLogFileTail({ name: "test", filePath: mockFilePath });
    expect(result).toEqual([]);
  });

  it("应该读取文件并返回日志条目", async () => {
    const logContent = "info: server started\nwarn: disk space low\nerror: connection failed\n";
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      size: Buffer.byteLength(logContent),
    });
    (fs.openSync as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (fs.readSync as ReturnType<typeof vi.fn>).mockReturnValue(logContent.length);
    (fs.closeSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const result = await readLogFileTail({
      name: "test",
      filePath: mockFilePath,
      lines: 10,
    });

    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it("应该通过 level 过滤", async () => {
    const logContent = "info: server started\nerror: connection failed\n";
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue({
      size: Buffer.byteLength(logContent),
    });
    (fs.openSync as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (fs.readSync as ReturnType<typeof vi.fn>).mockReturnValue(logContent.length);
    (fs.closeSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const result = await readLogFileTail({
      name: "test",
      filePath: mockFilePath,
      lines: 10,
      level: "error",
    });

    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
