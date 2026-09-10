/**
 * endpoints/context.ts（setupContextEndpoint）vitest 单元测试。
 *
 * 覆盖目标：GET 读取上下文、POST 写入上下文（含 ensureNodeId 兜底 / active tab 同步）、
 * DELETE 清空选中元素并广播 CLEAR_ELEMENTS、OPTIONS 与非法方法的响应。
 *
 * stub 策略：fake server 捕获 server.middlewares.use 注册的中间件后直接调用
 * handler(req,res)；req 用 EventEmitter 模拟（body 通过 setImmediate 投递 data/end），
 * res 为记录 writeHead/end 的普通对象；ctx 为 EndpointContext stub。
 * 协议字符串一律引用 @aipanel/core 常量。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CONTEXT_API_PATH, SSE_EVENT_TYPES } from "@aipanel/core";
import { setupContextEndpoint } from "../src/endpoints/context";
import type { EndpointContext } from "../src/endpoints/types";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;

function fakeRes() {
  const res: Record<string, unknown> = {
    headers: {} as Record<string, unknown>,
    statusCode: undefined as number | undefined,
    payload: "",
    setHeader: vi.fn((key: string, value: unknown) => {
      (res.headers as Record<string, unknown>)[key.toLowerCase()] = value;
    }),
    writeHead: vi.fn((code: number, headers?: Record<string, unknown>) => {
      res.statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          (res.headers as Record<string, unknown>)[k.toLowerCase()] = v;
        }
      }
      return res;
    }),
    write: vi.fn((chunk: unknown) => {
      res.payload += String(chunk);
      return true;
    }),
    end: vi.fn((chunk?: unknown) => {
      if (chunk !== undefined) res.payload += String(chunk);
      return res;
    }),
  };
  return res;
}

type FakeReq = EventEmitter & {
  method: string;
  url: string;
  headers: Record<string, unknown>;
};

function fakeReq(method: string, body?: string, url = CONTEXT_API_PATH): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:5173" };
  if (body !== undefined) {
    setImmediate(() => {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  }
  return req;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeCtx() {
  const sseClients = new Set<unknown>();
  const ctx = {
    webUrl: "http://127.0.0.1:5097",
    sseClients,
    getPageContext: vi.fn(() => ({ url: "http://localhost:5173/", title: "Home" })),
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
  setupContextEndpoint(server as never, ctx);
  if (!handler) throw new Error("context handler 未注册");
  return handler;
}

describe("setupContextEndpoint", () => {
  it("GET 返回当前页面上下文 JSON，并设置 CORS 与 JSON 头", async () => {
    const { ctx, mock } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("GET"), res);

    expect(res.statusCode).toBe(200);
    expect((res.headers as Record<string, unknown>)["content-type"]).toBe("application/json");
    expect((res.headers as Record<string, unknown>)["access-control-allow-origin"]).toBe("*");
    expect(JSON.parse(res.payload as string)).toEqual({
      url: "http://localhost:5173/",
      title: "Home",
    });
    expect(mock.getPageContext).toHaveBeenCalledTimes(1);
  });

  it("OPTIONS 直接返回 200 空响应", async () => {
    const { ctx } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("OPTIONS"), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("");
  });

  it("DELETE 清空选中元素并向所有 SSE 客户端广播 CLEAR_ELEMENTS", async () => {
    const { ctx, mock, sseClients } = makeCtx();
    const clientA = { write: vi.fn() };
    const clientB = { write: vi.fn() };
    sseClients.add(clientA);
    sseClients.add(clientB);

    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("DELETE"), res);

    expect(mock.clearSelectedElements).toHaveBeenCalledTimes(1);
    const expected = `data: ${JSON.stringify({ type: SSE_EVENT_TYPES.CLEAR_ELEMENTS })}\n\n`;
    expect(clientA.write).toHaveBeenCalledWith(expected);
    expect(clientB.write).toHaveBeenCalledWith(expected);
    expect(JSON.parse(res.payload as string)).toEqual({ success: true });
  });

  it("DELETE 时单个客户端 write 抛错不影响其余客户端与整体响应", async () => {
    const { ctx, sseClients } = makeCtx();
    const broken = {
      write: vi.fn(() => {
        throw new Error("socket closed");
      }),
    };
    const ok = { write: vi.fn() };
    sseClients.add(broken);
    sseClients.add(ok);

    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("DELETE"), res);

    expect(res.statusCode).toBe(200);
    expect(ok.write).toHaveBeenCalledTimes(1);
  });

  it("POST 写入指定 tab 上下文、为元素兜底分配 id，并在 active 时同步活跃 tab", async () => {
    const { ctx, mock } = makeCtx();
    const res = fakeRes();
    const handler = captureHandler(ctx);
    const body = JSON.stringify({
      url: "http://localhost:5173/page",
      title: "Page",
      tabId: "t2",
      active: true,
      selectedElements: [{ filePath: "a.vue", line: 1, column: 1, innerText: "hi" }],
    });
    await handler(fakeReq("POST", body), res);
    await flush();

    expect(mock.setActiveTabId).toHaveBeenCalledWith("t2");
    expect(mock.setPageContext).toHaveBeenCalledTimes(1);
    const [tabId, saved] = mock.setPageContext.mock.calls[0] as [string, Record<string, unknown>];
    expect(tabId).toBe("t2");
    expect(saved.url).toBe("http://localhost:5173/page");
    expect(saved.title).toBe("Page");
    const els = saved.selectedElements as Array<{ id?: string; innerText: string }>;
    expect(els).toHaveLength(1);
    expect(els[0].innerText).toBe("hi");
    expect(els[0].id).toMatch(/^n[0-9a-z]+$/);
    expect(JSON.parse(res.payload as string)).toEqual({ success: true });
  });

  it("POST 缺少 tabId 时归入 default，并复用已有 tabId/tabIndex；非 active 不改活跃 tab", async () => {
    const { ctx, mock } = makeCtx();
    mock.getPageContext.mockReturnValue({
      url: "",
      title: "",
      tabId: 5,
      tabIndex: 1,
    } as never);
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("POST", JSON.stringify({ url: "u" })), res);
    await flush();

    expect(mock.setPageContext).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ url: "u", title: "", tabId: 5, tabIndex: 1 }),
    );
    expect(mock.setActiveTabId).not.toHaveBeenCalled();
  });

  it("POST 保留已有元素 id（ensureNodeId 幂等）", async () => {
    const { ctx, mock } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(
      fakeReq(
        "POST",
        JSON.stringify({
          selectedElements: [
            { id: "nkept1234", filePath: null, line: null, column: null, innerText: "x" },
          ],
        }),
      ),
      res,
    );
    await flush();

    const [, saved] = mock.setPageContext.mock.calls[0] as [
      string,
      { selectedElements: Array<{ id?: string }> },
    ];
    expect(saved.selectedElements[0].id).toBe("nkept1234");
  });

  it("POST 非法 JSON 返回 400 与 Invalid JSON", async () => {
    const { ctx } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("POST", "{not json"), res);
    await flush();

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload as string)).toEqual({ error: "Invalid JSON" });
  });

  it("不支持的方法返回 405", async () => {
    const { ctx } = makeCtx();
    const res = fakeRes();
    await captureHandler(ctx)(fakeReq("PUT"), res);
    expect(res.statusCode).toBe(405);
    expect(JSON.parse(res.payload as string)).toEqual({ error: "Method not allowed" });
  });
});
