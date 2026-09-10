/**
 * endpoints/logs.ts（setupLogsEndpoint）vitest 单元测试。
 *
 * 覆盖目标：GET 日志查询（无过滤 / level 单值多值 / limit / source / since）与 meta 统计、
 * DELETE 清空缓冲区、OPTIONS 与非法方法的响应。
 *
 * stub 策略：使用 @aipanel/core/node 的真实进程日志缓冲区单例（本文件内独立模块实例），
 * 直接写入条目驱动；fake server 捕获中间件后调用 handler(req,res)，
 * 协议路径引用 @aipanel/core 的 LOGS_API_PATH。
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGS_API_PATH } from "@aipanel/core";
import { getProcessLogBuffer, type ProcessLogEntry } from "@aipanel/core/node";
import { setupLogsEndpoint } from "../src/endpoints/logs";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;
type FakeReq = EventEmitter & { method: string; url: string; headers: Record<string, unknown> };

const buffer = getProcessLogBuffer();

function fakeReq(method: string, url = LOGS_API_PATH): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:5173" };
  return req;
}

function fakeRes() {
  const res = {
    headers: {} as Record<string, unknown>,
    statusCode: undefined as number | undefined,
    payload: "",
    setHeader: vi.fn((key: string, value: unknown) => {
      res.headers[key.toLowerCase()] = value;
    }),
    writeHead: vi.fn((code: number, headers?: Record<string, unknown>) => {
      res.statusCode = code;
      if (headers) Object.assign(res.headers, headers);
      return res;
    }),
    end: vi.fn((chunk?: unknown) => {
      if (chunk !== undefined) res.payload += String(chunk);
      return res;
    }),
  };
  return res;
}

function captureHandler(): Handler {
  let handler: Handler | null = null;
  const server = {
    middlewares: {
      use: (_path: unknown, maybeHandler?: unknown) => {
        handler = (typeof _path === "function" ? _path : maybeHandler) as Handler;
      },
    },
  };
  setupLogsEndpoint(server as never);
  if (!handler) throw new Error("logs handler 未注册");
  return handler;
}

function addEntry(entry: Partial<ProcessLogEntry> & { level: ProcessLogEntry["level"]; message: string }) {
  buffer.addEntry({
    timestamp: new Date().toISOString(),
    source: "console",
    ...entry,
  } as ProcessLogEntry);
}

function json(res: ReturnType<typeof fakeRes>) {
  return JSON.parse(res.payload);
}

beforeEach(() => {
  buffer.clear();
});

afterEach(() => {
  buffer.clear();
});

describe("setupLogsEndpoint", () => {
  it("GET 无过滤参数返回全部日志与 meta 统计", async () => {
    addEntry({ level: "info", message: "hello" });
    addEntry({ level: "error", message: "boom" });
    const res = fakeRes();
    await captureHandler()(fakeReq("GET"), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    const body = json(res);
    expect(body.logs).toHaveLength(2);
    expect(body.meta).toEqual({ total: 2, returned: 2, filters: {} });
  });

  it("GET level 支持单值与逗号分隔多值过滤", async () => {
    addEntry({ level: "info", message: "i" });
    addEntry({ level: "warn", message: "w" });
    addEntry({ level: "error", message: "e" });

    const single = fakeRes();
    await captureHandler()(fakeReq("GET", `${LOGS_API_PATH}?level=error`), single);
    expect(json(single).logs.map((l: ProcessLogEntry) => l.message)).toEqual(["e"]);

    const multi = fakeRes();
    await captureHandler()(fakeReq("GET", `${LOGS_API_PATH}?level=error,warn`), multi);
    expect(json(multi).logs.map((l: ProcessLogEntry) => l.message)).toEqual(["w", "e"]);
    expect(json(multi).meta.filters.level).toEqual(["error", "warn"]);
  });

  it("GET limit 返回最新 N 条；非法 limit（0 或超上限）被忽略", async () => {
    addEntry({ level: "info", message: "1" });
    addEntry({ level: "info", message: "2" });
    addEntry({ level: "info", message: "3" });

    const limited = fakeRes();
    await captureHandler()(fakeReq("GET", `${LOGS_API_PATH}?limit=2`), limited);
    expect(json(limited).logs.map((l: ProcessLogEntry) => l.message)).toEqual(["2", "3"]);

    const zero = fakeRes();
    await captureHandler()(fakeReq("GET", `${LOGS_API_PATH}?limit=0`), zero);
    expect(json(zero).logs).toHaveLength(3);
    expect(json(zero).meta.filters.limit).toBeUndefined();

    const tooBig = fakeRes();
    await captureHandler()(fakeReq("GET", `${LOGS_API_PATH}?limit=2000`), tooBig);
    expect(json(tooBig).logs).toHaveLength(3);
    expect(json(tooBig).meta.filters.limit).toBeUndefined();
  });

  it("GET source 与 since 过滤生效", async () => {
    const old = new Date(Date.now() - 10_000).toISOString();
    const fresh = new Date().toISOString();
    buffer.addEntry({ level: "info", message: "old", timestamp: old, source: "console" });
    buffer.addEntry({
      level: "error",
      message: "new",
      timestamp: fresh,
      source: "provider-stderr",
    });

    const bySource = fakeRes();
    await captureHandler()(fakeReq("GET", `${LOGS_API_PATH}?source=provider-stderr`), bySource);
    expect(json(bySource).logs.map((l: ProcessLogEntry) => l.message)).toEqual(["new"]);

    const since = new Date(Date.now() - 5_000).toISOString();
    const bySince = fakeRes();
    await captureHandler()(fakeReq("GET", `${LOGS_API_PATH}?since=${encodeURIComponent(since)}`), bySince);
    expect(json(bySince).logs.map((l: ProcessLogEntry) => l.message)).toEqual(["new"]);
  });

  it("DELETE 清空日志缓冲区", async () => {
    addEntry({ level: "info", message: "x" });
    const res = fakeRes();
    await captureHandler()(fakeReq("DELETE"), res);

    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ success: true, message: "Log buffer cleared" });
    expect(buffer.size()).toBe(0);
  });

  it("OPTIONS 返回 200 空响应，非法方法返回 405", async () => {
    const options = fakeRes();
    await captureHandler()(fakeReq("OPTIONS"), options);
    expect(options.statusCode).toBe(200);

    const put = fakeRes();
    await captureHandler()(fakeReq("PUT"), put);
    expect(put.statusCode).toBe(405);
    expect(json(put)).toEqual({ error: "Method not allowed" });
  });
});
