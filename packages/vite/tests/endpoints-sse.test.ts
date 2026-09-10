/**
 * endpoints/sse.ts（setupSseEndpoint）vitest 单元测试。
 *
 * 覆盖目标：SSE 连接建立（响应头 / CONNECTED 帧 / STATUS_SYNC 全量状态）、
 * 客户端注册与断开清理、currentTask 为空或存在时的状态载荷差异。
 *
 * stub 策略：fake server 捕获中间件后调用 handler(req,res)；req 为 EventEmitter
 * 以便触发 close；res 记录 writeHead/write；ctx.sseClients 为真实 Set。
 * 事件类型引用 @aipanel/core 的 SSE_EVENT_TYPES。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SSE_EVENTS_PATH, SSE_EVENT_TYPES } from "@aipanel/core";
import { setupSseEndpoint } from "../src/endpoints/sse";
import type { EndpointContext } from "../src/endpoints/types";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;
type FakeReq = EventEmitter & { method: string; url: string; headers: Record<string, unknown> };

function fakeReq(): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.method = "GET";
  req.url = SSE_EVENTS_PATH;
  req.headers = { host: "localhost:5173" };
  return req;
}

function fakeRes() {
  const res = {
    headers: {} as Record<string, unknown>,
    statusCode: undefined as number | undefined,
    frames: [] as string[],
    setHeader: vi.fn(),
    writeHead: vi.fn((code: number, headers?: Record<string, unknown>) => {
      res.statusCode = code;
      if (headers) Object.assign(res.headers, headers);
      return res;
    }),
    write: vi.fn((chunk: unknown) => {
      res.frames.push(String(chunk));
      return true;
    }),
    end: vi.fn(() => res),
  };
  return res;
}

function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  const sseClients = new Set<unknown>();
  const ctx = {
    webUrl: null,
    sseClients,
    getPageContext: vi.fn(() => ({ url: "", title: "" })),
    setPageContext: vi.fn(),
    setActiveTabId: vi.fn(),
    clearSelectedElements: vi.fn(),
    isServiceStarted: false,
    currentTask: null,
    actualProxyPort: 6097,
    actualWebPort: 5097,
    serviceInstanceId: "svc-1",
    getSessions: vi.fn(async () => []),
    createSession: vi.fn(),
    deleteSession: vi.fn(async () => undefined),
    getCapabilities: vi.fn(() => ({})),
    eventsToken: null,
    pushProviderEvent: vi.fn(),
    resolveWidgetPath: vi.fn(() => ""),
    resolveWidgetStylePath: vi.fn(() => ""),
    retryWarmupChromeMcp: vi.fn(),
    ...overrides,
  };
  return { ctx: ctx as unknown as EndpointContext, mock: ctx, sseClients };
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
  setupSseEndpoint(server as never, ctx);
  if (!handler) throw new Error("sse handler 未注册");
  return handler;
}

function parseFrame(frame: string) {
  return JSON.parse(frame.replace(/^data: /, "").trim());
}

describe("setupSseEndpoint", () => {
  it("建立 SSE 连接：返回 200/事件流头、注册客户端并推送 CONNECTED 与 STATUS_SYNC", async () => {
    const { ctx, sseClients } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.headers["Cache-Control"]).toBe("no-cache");
    expect(res.headers["Connection"]).toBe("keep-alive");
    expect(sseClients.has(res)).toBe(true);

    expect(res.frames).toHaveLength(2);
    expect(parseFrame(res.frames[0])).toEqual({ type: SSE_EVENT_TYPES.CONNECTED });
    expect(parseFrame(res.frames[1])).toEqual({
      type: SSE_EVENT_TYPES.STATUS_SYNC,
      isStarted: false,
    });
  });

  it("存在 currentTask 时 STATUS_SYNC 携带任务与其附加字段", async () => {
    const { ctx } = makeCtx({
      currentTask: { task: "chrome_mcp_failed", errorType: "UNKNOWN", errorMessage: "boom" },
    });
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq(), res);

    expect(parseFrame(res.frames[1])).toEqual({
      type: SSE_EVENT_TYPES.STATUS_SYNC,
      isStarted: false,
      task: "chrome_mcp_failed",
      errorType: "UNKNOWN",
      errorMessage: "boom",
    });
  });

  it("客户端断开时从 sseClients 移除", async () => {
    const { ctx, sseClients } = makeCtx();
    const req = fakeReq();
    const res = fakeRes();
    await captureHandler(ctx)(req, res);
    expect(sseClients.size).toBe(1);

    req.emit("close");
    expect(sseClients.size).toBe(0);
  });
});
