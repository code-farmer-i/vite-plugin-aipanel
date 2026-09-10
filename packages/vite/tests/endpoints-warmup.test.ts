/**
 * endpoints/warmup.ts（setupWarmupEndpoint）vitest 单元测试。
 *
 * 覆盖目标：非 POST 方法 405；POST 成功返回 { success: true }；
 * POST 失败透传 errorType/error；ctx.retryWarmupChromeMcp 抛错时返回 500。
 *
 * stub 策略：fake server 捕获中间件后调用 handler(req,res)；ctx.retryWarmupChromeMcp
 * 为 vi.fn stub；协议路径引用 @aipanel/core 的 WARMUP_API_PATH。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WARMUP_API_PATH } from "@aipanel/core";
import { setupWarmupEndpoint } from "../src/endpoints/warmup";
import type { EndpointContext } from "../src/endpoints/types";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;

function fakeReq(method: string) {
  const req = new EventEmitter() as EventEmitter & { method: string; url: string; headers: object };
  req.method = method;
  req.url = WARMUP_API_PATH;
  req.headers = {};
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

function makeCtx(retry: () => Promise<{ success: boolean; errorType?: string; errorMessage?: string }>) {
  const ctx = {
    webUrl: null,
    sseClients: new Set<unknown>(),
    getPageContext: vi.fn(),
    setPageContext: vi.fn(),
    setActiveTabId: vi.fn(),
    clearSelectedElements: vi.fn(),
    isServiceStarted: false,
    currentTask: null,
    actualProxyPort: 6097,
    actualWebPort: 5097,
    serviceInstanceId: "svc-1",
    getSessions: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    getCapabilities: vi.fn(),
    eventsToken: null,
    pushProviderEvent: vi.fn(),
    resolveWidgetPath: vi.fn(),
    resolveWidgetStylePath: vi.fn(),
    retryWarmupChromeMcp: vi.fn(retry),
  };
  return ctx as unknown as EndpointContext;
}

function captureHandler(ctx: EndpointContext): Handler {
  let handler: Handler | null = null;
  const server = {
    middlewares: {
      use: (_path: unknown, maybeHandler?: unknown) => {
        handler = (typeof _path === "function" ? _path : maybeHandler) as Handler;
      },
    },
  };
  setupWarmupEndpoint(server as never, ctx);
  if (!handler) throw new Error("warmup handler 未注册");
  return handler;
}

describe("setupWarmupEndpoint", () => {
  it("非 POST 方法返回 405", async () => {
    const ctx = makeCtx(async () => ({ success: true }));
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("GET"), res);
    expect(res.statusCode).toBe(405);
    expect(res.payload).toBe("Method not allowed");
  });

  it("POST 预热成功返回 { success: true }", async () => {
    const ctx = makeCtx(async () => ({ success: true }));
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("POST"), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(res.payload)).toEqual({ success: true });
  });

  it("POST 预热失败透传 errorType 与 errorMessage", async () => {
    const ctx = makeCtx(async () => ({
      success: false,
      errorType: "CHROME_NOT_CONNECTED",
      errorMessage: "not connected",
    }));
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("POST"), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      success: false,
      errorType: "CHROME_NOT_CONNECTED",
      error: "not connected",
    });
  });

  it("ctx 抛错时返回 500 且 errorType 为 UNKNOWN", async () => {
    const ctx = makeCtx(async () => {
      throw new Error("boom");
    });
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("POST"), res);
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.errorType).toBe("UNKNOWN");
    expect(body.error).toContain("boom");
  });
});
