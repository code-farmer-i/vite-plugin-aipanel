/**
 * endpoints/start.ts（setupStartEndpoint）vitest 单元测试。
 *
 * 覆盖目标：启动信息端点返回 proxyPort/webPort/projectRoot/serviceInstanceId，
 * 设置 JSON 与 CORS 头（该端点被扩展背景脚本高频轮询，需稳定返回）。
 *
 * stub 策略：fake server 捕获中间件（含 config.root）后调用 handler(req,res)；
 * ctx 提供端口与服务实例 id。协议路径引用 @aipanel/core 的 START_API_PATH。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { START_API_PATH } from "@aipanel/core";
import { setupStartEndpoint } from "../src/endpoints/start";
import type { EndpointContext } from "../src/endpoints/types";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;

function fakeReq(): EventEmitter & { method: string; url: string; headers: object } {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: object;
  };
  req.method = "GET";
  req.url = START_API_PATH;
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

function captureHandler(ctx: EndpointContext): Handler {
  let handler: Handler | null = null;
  const server = {
    config: { root: "/repo/packages/app" },
    middlewares: {
      use: (_path: unknown, maybeHandler?: unknown) => {
        handler = (typeof _path === "function" ? _path : maybeHandler) as Handler;
      },
    },
  };
  setupStartEndpoint(server as never, ctx);
  if (!handler) throw new Error("start handler 未注册");
  return handler;
}

function makeCtx(): EndpointContext {
  return {
    actualProxyPort: 6097,
    actualWebPort: 5097,
    serviceInstanceId: "svc-abc",
  } as unknown as EndpointContext;
}

describe("setupStartEndpoint", () => {
  it("返回服务启动信息（端口 / 项目根 / 实例 id）", async () => {
    const res = fakeRes();
    await captureHandler(makeCtx())(fakeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(JSON.parse(res.payload)).toEqual({
      success: true,
      proxyPort: 6097,
      webPort: 5097,
      projectRoot: "/repo/packages/app",
      serviceInstanceId: "svc-abc",
    });
  });
});
