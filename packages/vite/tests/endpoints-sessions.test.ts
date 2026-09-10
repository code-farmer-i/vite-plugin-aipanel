/**
 * endpoints/sessions.ts（setupSessionsEndpoint）vitest 单元测试。
 *
 * 覆盖目标：GET 会话列表 + Provider 能力聚合（current 查询透传）、POST 创建会话、
 * DELETE 删除（含缺少 id 的 400）、OPTIONS 与非法方法、异常映射为 500。
 *
 * stub 策略：fake server 捕获中间件后直接调用 handler(req,res)；ctx 提供
 * getSessions/createSession/deleteSession/getCapabilities 的 vi.fn stub；
 * 协议路径引用 @aipanel/core 的 SESSIONS_API_PATH。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SESSIONS_API_PATH } from "@aipanel/core";
import { setupSessionsEndpoint } from "../src/endpoints/sessions";
import type { EndpointContext } from "../src/endpoints/types";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;
type FakeReq = EventEmitter & { method: string; url: string; headers: Record<string, unknown> };

function fakeReq(method: string, url = SESSIONS_API_PATH): FakeReq {
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

function makeCtx() {
  const ctx = {
    webUrl: null,
    sseClients: new Set<unknown>(),
    getPageContext: vi.fn(() => ({ url: "", title: "" })),
    setPageContext: vi.fn(),
    setActiveTabId: vi.fn(),
    clearSelectedElements: vi.fn(),
    isServiceStarted: false,
    currentTask: null,
    actualProxyPort: 6097,
    actualWebPort: 5097,
    serviceInstanceId: "svc-1",
    getSessions: vi.fn(async () => [{ id: "s1", title: "Session 1" }]),
    createSession: vi.fn(async () => ({ id: "s2", title: "New" })),
    deleteSession: vi.fn(async () => undefined),
    getCapabilities: vi.fn(() => ({ deepLink: true })),
    eventsToken: null,
    pushProviderEvent: vi.fn(),
    resolveWidgetPath: vi.fn(() => ""),
    resolveWidgetStylePath: vi.fn(() => ""),
    retryWarmupChromeMcp: vi.fn(),
  };
  return { ctx: ctx as unknown as EndpointContext, mock: ctx };
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
  setupSessionsEndpoint(server as never, ctx);
  if (!handler) throw new Error("sessions handler 未注册");
  return handler;
}

describe("setupSessionsEndpoint", () => {
  it("GET 返回会话列表与 Provider 能力，并把 current 透传为 activeSessionId", async () => {
    const { ctx, mock } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("GET", `${SESSIONS_API_PATH}?current=s9`), res);

    expect(res.statusCode).toBe(200);
    expect(mock.getSessions).toHaveBeenCalledWith("s9");
    expect(mock.getCapabilities).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.payload)).toEqual({
      sessions: [{ id: "s1", title: "Session 1" }],
      capabilities: { deepLink: true },
    });
  });

  it("GET 无 current 参数时 activeSessionId 为 undefined", async () => {
    const { ctx, mock } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("GET"), res);
    expect(mock.getSessions).toHaveBeenCalledWith(undefined);
  });

  it("POST 创建会话并返回新会话", async () => {
    const { ctx, mock } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("POST"), res);
    expect(mock.createSession).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.payload)).toEqual({ id: "s2", title: "New" });
  });

  it("DELETE 缺少 id 参数返回 400，不调用 deleteSession", async () => {
    const { ctx, mock } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("DELETE"), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload)).toEqual({ error: "Session ID is required" });
    expect(mock.deleteSession).not.toHaveBeenCalled();
  });

  it("DELETE 携带 id 时删除会话并返回 success", async () => {
    const { ctx, mock } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("DELETE", `${SESSIONS_API_PATH}?id=s1`), res);
    expect(mock.deleteSession).toHaveBeenCalledWith("s1");
    expect(JSON.parse(res.payload)).toEqual({ success: true });
  });

  it("OPTIONS 返回 200 空响应，非法方法返回 405", async () => {
    const { ctx } = makeCtx();
    const options = fakeRes();
    await captureHandler(ctx)(fakeReq("OPTIONS"), options);
    expect(options.statusCode).toBe(200);

    const put = fakeRes();
    await captureHandler(ctx)(fakeReq("PUT"), put);
    expect(put.statusCode).toBe(405);
    expect(JSON.parse(put.payload)).toEqual({ error: "Method not allowed" });
  });

  it("ctx 抛错时返回 500 并携带错误信息", async () => {
    const { ctx, mock } = makeCtx();
    mock.getSessions.mockRejectedValueOnce(new Error("Provider 未初始化"));
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("GET"), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toContain("Provider 未初始化");
  });
});
