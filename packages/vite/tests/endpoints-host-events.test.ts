/**
 * endpoints/host-events.ts（setupHostEventsEndpoint）vitest 单元测试。
 *
 * 覆盖目标：带 Origin 的浏览器请求被拒（403）、OPTIONS 204、非 POST 405、
 * token 校验（缺失/不匹配 403）、ProviderEvent 形状校验（400）与合法事件广播（200）。
 *
 * stub 策略：fake server 捕获中间件后调用 handler(req,res)；req 用 EventEmitter
 * 模拟 body（setImmediate 投递 data/end）；ctx.pushProviderEvent 为 vi.fn stub。
 * 协议路径引用 @aipanel/core 的 HOST_EVENTS_API_PATH。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { HOST_EVENTS_API_PATH, type ProviderEvent } from "@aipanel/core";
import { setupHostEventsEndpoint } from "../src/endpoints/host-events";
import type { EndpointContext } from "../src/endpoints/types";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;
type FakeReq = EventEmitter & {
  method: string;
  url: string;
  headers: Record<string, unknown>;
};

function fakeReq(method: string, body?: string, origin?: string): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.method = method;
  req.url = HOST_EVENTS_API_PATH;
  req.headers = { host: "localhost:5173", ...(origin ? { origin } : {}) };
  if (body !== undefined) {
    setImmediate(() => {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  }
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

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeCtx(eventsToken: string | null) {
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
    eventsToken,
    pushProviderEvent: vi.fn(),
    resolveWidgetPath: vi.fn(),
    resolveWidgetStylePath: vi.fn(),
    retryWarmupChromeMcp: vi.fn(),
  };
  return ctx as unknown as EndpointContext & { pushProviderEvent: ReturnType<typeof vi.fn> };
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
  setupHostEventsEndpoint(server as never, ctx);
  if (!handler) throw new Error("host-events handler 未注册");
  return handler;
}

const VALID_EVENT: ProviderEvent = { type: "session.status", sessionId: "s1", status: "idle" };

describe("setupHostEventsEndpoint", () => {
  it("携带浏览器 Origin 的请求一律 403 forbidden", async () => {
    const ctx = makeCtx("tok");
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("POST", "{}", "http://localhost:5173"), res);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toEqual({ error: "forbidden" });
  });

  it("OPTIONS 返回 204，非 POST 返回 405", async () => {
    const ctx = makeCtx("tok");
    const options = fakeRes();
    await captureHandler(ctx)(fakeReq("OPTIONS"), options);
    expect(options.statusCode).toBe(204);

    const get = fakeRes();
    await captureHandler(ctx)(fakeReq("GET"), get);
    expect(get.statusCode).toBe(405);
    expect(JSON.parse(get.payload)).toEqual({ error: "method not allowed" });
  });

  it("token 缺失或不匹配时 403 invalid token", async () => {
    const ctx = makeCtx("tok");

    const missing = fakeRes();
    await captureHandler(ctx)(fakeReq("POST", JSON.stringify({ event: VALID_EVENT })), missing);
    await flush();
    expect(missing.statusCode).toBe(403);
    expect(JSON.parse(missing.payload)).toEqual({ error: "invalid token" });

    const wrong = fakeRes();
    await captureHandler(ctx)(
      fakeReq("POST", JSON.stringify({ token: "bad", event: VALID_EVENT })),
      wrong,
    );
    await flush();
    expect(wrong.statusCode).toBe(403);
  });

  it("未启动（eventsToken 为 null）时所有推送均 403", async () => {
    const ctx = makeCtx(null);
    const res = fakeRes();
    await captureHandler(ctx)(
      fakeReq("POST", JSON.stringify({ token: "tok", event: VALID_EVENT })),
      res,
    );
    await flush();
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toEqual({ error: "invalid token" });
  });

  it("token 合法但事件形状非法时 400 invalid event", async () => {
    const ctx = makeCtx("tok");
    const res = fakeRes();
    await captureHandler(ctx)(
      fakeReq("POST", JSON.stringify({ token: "tok", event: { type: "nope" } })),
      res,
    );
    await flush();
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload)).toEqual({ error: "invalid event" });
  });

  it("session.status 事件缺少 sessionId 时视为非法", async () => {
    const ctx = makeCtx("tok");
    const res = fakeRes();
    await captureHandler(ctx)(
      fakeReq("POST", JSON.stringify({ token: "tok", event: { type: "session.status" } })),
      res,
    );
    await flush();
    expect(res.statusCode).toBe(400);
  });

  it("session.updated 事件要求 session.id 为字符串", async () => {
    const ctx = makeCtx("tok");
    const bad = fakeRes();
    await captureHandler(ctx)(
      fakeReq(
        "POST",
        JSON.stringify({ token: "tok", event: { type: "session.updated", session: {} } }),
      ),
      bad,
    );
    await flush();
    expect(bad.statusCode).toBe(400);

    const ok = fakeRes();
    await captureHandler(ctx)(
      fakeReq(
        "POST",
        JSON.stringify({
          token: "tok",
          event: { type: "session.updated", session: { id: "s1", title: "T" } },
        }),
      ),
      ok,
    );
    await flush();
    expect(ok.statusCode).toBe(200);
  });

  it("connected 事件恒为合法", async () => {
    const ctx = makeCtx("tok");
    const res = fakeRes();
    await captureHandler(ctx)(
      fakeReq("POST", JSON.stringify({ token: "tok", event: { type: "connected" } })),
      res,
    );
    await flush();
    expect(res.statusCode).toBe(200);
  });

  it("token 与事件均合法时广播事件并返回 { ok: true }", async () => {
    const ctx = makeCtx("tok");
    const res = fakeRes();
    await captureHandler(ctx)(
      fakeReq("POST", JSON.stringify({ token: "tok", event: VALID_EVENT })),
      res,
    );
    await flush();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
    expect(ctx.pushProviderEvent).toHaveBeenCalledWith(VALID_EVENT);
  });

  it("非法 JSON body 返回 400 invalid json", async () => {
    const ctx = makeCtx("tok");
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("POST", "{oops"), res);
    await flush();
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload)).toEqual({ error: "invalid json" });
  });
});
