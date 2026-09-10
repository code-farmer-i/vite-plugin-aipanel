/**
 * endpoints/index.ts（setupMiddlewares 装配编排）vitest 单元测试。
 *
 * 覆盖目标：按预期注册全部中间件路径（widget×2 + context/start/sse/host-events/
 * sessions/warmup/logs 各 1；提供 mcp 时追加 MCP 路由与 vue-devtools 端点），
 * 以及 re-export 的路径常量与 @aipanel/core 单一来源一致。
 *
 * stub 策略：仅记录 server.middlewares.use 的注册参数，不真正触发 handler；
 * mcp 传入最小 stub。协议路径一律引用 @aipanel/core 常量。
 */
import { describe, expect, it } from "vitest";
import {
  CONTEXT_API_PATH,
  HOST_EVENTS_API_PATH,
  LOGS_API_PATH as CORE_LOGS_API_PATH,
  MCP_API_PATH as CORE_MCP_API_PATH,
  SESSIONS_API_PATH,
  SSE_EVENTS_PATH,
  START_API_PATH,
  VUE_DEVTOOLS_API_PATH as CORE_VUE_DEVTOOLS_API_PATH,
  WARMUP_API_PATH,
  WIDGET_SCRIPT_PATH,
  WIDGET_STYLE_PATH,
} from "@aipanel/core";
import {
  LOGS_API_PATH,
  MCP_API_PATH,
  VUE_DEVTOOLS_API_PATH,
  setupMiddlewares,
} from "../src/endpoints/index";
import type { McpProxy } from "../src/core/mcp-proxy";
import type { EndpointContext } from "../src/endpoints/types";

interface UseCall {
  path: string | undefined;
  handler: unknown;
}

function makeServer() {
  const calls: UseCall[] = [];
  const server = {
    resolvedUrls: { local: ["http://localhost:5173/"], network: [] },
    middlewares: {
      use: (pathOrHandler: unknown, maybeHandler?: unknown) => {
        calls.push({
          path: typeof pathOrHandler === "function" ? undefined : (pathOrHandler as string),
          handler: typeof pathOrHandler === "function" ? pathOrHandler : maybeHandler,
        });
      },
    },
  };
  return { server, calls };
}

const ctx = {
  getPageContext: () => ({ url: "", title: "" }),
} as unknown as EndpointContext;

const mcpStub = {
  sessionId: "sess-1",
  isRunning: true,
  call: async () => ({ result: { tools: [] } }),
} as unknown as McpProxy;

describe("setupMiddlewares", () => {
  it("未提供 mcp 时注册 widget/context/start/sse/host-events/sessions/warmup/logs", () => {
    const { server, calls } = makeServer();
    setupMiddlewares(server as never, ctx);

    expect(calls.map((c) => c.path)).toEqual([
      WIDGET_SCRIPT_PATH,
      WIDGET_STYLE_PATH,
      CONTEXT_API_PATH,
      START_API_PATH,
      SSE_EVENTS_PATH,
      HOST_EVENTS_API_PATH,
      SESSIONS_API_PATH,
      WARMUP_API_PATH,
      CORE_LOGS_API_PATH,
    ]);
    for (const call of calls) expect(typeof call.handler).toBe("function");
  });

  it("提供 mcp 时追加 MCP 路由（无路径挂载）与 vue-devtools 端点", () => {
    const { server, calls } = makeServer();
    setupMiddlewares(server as never, ctx, mcpStub, [], undefined);

    expect(calls.map((c) => c.path)).toEqual([
      WIDGET_SCRIPT_PATH,
      WIDGET_STYLE_PATH,
      CONTEXT_API_PATH,
      START_API_PATH,
      SSE_EVENTS_PATH,
      HOST_EVENTS_API_PATH,
      SESSIONS_API_PATH,
      WARMUP_API_PATH,
      CORE_LOGS_API_PATH,
      undefined,
      CORE_VUE_DEVTOOLS_API_PATH,
    ]);
  });

  it("re-export 的路径常量与 @aipanel/core 单一来源一致", () => {
    expect(LOGS_API_PATH).toBe(CORE_LOGS_API_PATH);
    expect(MCP_API_PATH).toBe(CORE_MCP_API_PATH);
    expect(VUE_DEVTOOLS_API_PATH).toBe(CORE_VUE_DEVTOOLS_API_PATH);
  });
});
