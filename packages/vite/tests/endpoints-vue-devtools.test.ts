/**
 * endpoints/vue-devtools.ts（setupVueDevtoolsEndpoint + executeAction）vitest 单元测试。
 *
 * 覆盖目标：
 * - executeAction：pageId 缺失/越界报错、先 select_page 再 evaluate_script、
 *   各 action 生成的桥调用表达式、未知 action 报错、evaluate 结果（markdown JSON / 纯文本 / 空）解析；
 * - 端点：OPTIONS/非 POST/非法 JSON 与成功响应包装。
 *
 * stub 策略：McpProxy 用 callChromeDevTool stub（list_pages 文本 + evaluate_script 结果），
 * 不启动真实 Chrome/进程；fake server 捕获中间件并直接调用 handler。
 * action 名与路径引用 @aipanel/core 的 VUE_DEVTOOLS_ACTIONS / VUE_DEVTOOLS_API_PATH。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { VUE_DEVTOOLS_ACTIONS, VUE_DEVTOOLS_API_PATH } from "@aipanel/core";
import { executeAction, setupVueDevtoolsEndpoint } from "../src/endpoints/vue-devtools";
import type { McpProxy } from "../src/core/mcp-proxy";

const PROJECT_ORIGINS = ["http://localhost:5173"];
const LIST_PAGES_TEXT = "0: App (http://localhost:5173/)";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;
type FakeReq = EventEmitter & { method: string; url: string; headers: Record<string, unknown> };

function fakeReq(method: string, body?: string): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.method = method;
  req.url = VUE_DEVTOOLS_API_PATH;
  req.headers = { host: "localhost:5173" };
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

interface McpStub {
  callChromeDevTool: ReturnType<typeof vi.fn>;
  sessionId: string;
  isRunning: boolean;
}

function makeMcp(evalText?: string): McpStub {
  return {
    sessionId: "sess-1",
    isRunning: true,
    callChromeDevTool: vi.fn(async (name: string) => {
      if (name === "list_pages") {
        return { result: { content: [{ text: LIST_PAGES_TEXT }] } };
      }
      if (name === "evaluate_script") {
        return evalText === undefined
          ? { result: { content: [] } }
          : { result: { content: [{ text: evalText }] } };
      }
      return { result: {} };
    }),
  };
}

function asMcp(stub: McpStub): McpProxy {
  return stub as unknown as McpProxy;
}

function captureHandler(mcp: McpProxy): Handler {
  let handler: Handler | null = null;
  const server = {
    resolvedUrls: { local: ["http://localhost:5173/"], network: [] },
    middlewares: {
      use: (_path: unknown, maybeHandler?: unknown) => {
        handler = (typeof _path === "function" ? _path : maybeHandler) as Handler;
      },
    },
  };
  setupVueDevtoolsEndpoint(server as never, mcp);
  if (!handler) throw new Error("vue-devtools handler 未注册");
  return handler;
}

function fenced(json: string) {
  return `Script ran on page and returned:\n\`\`\`json\n${json}\n\`\`\``;
}

describe("executeAction", () => {
  it("缺少 pageId 参数时抛错且不触碰 mcp", async () => {
    const mcp = makeMcp();
    await expect(
      executeAction(VUE_DEVTOOLS_ACTIONS.GET_APPS, {}, asMcp(mcp), PROJECT_ORIGINS),
    ).rejects.toThrow("缺少 pageId 参数");
    expect(mcp.callChromeDevTool).not.toHaveBeenCalled();
  });

  it("pageId 不在可操作范围时抛错并透传校验原因", async () => {
    const mcp = makeMcp();
    mcp.callChromeDevTool.mockImplementation(async (name: string) => {
      if (name === "list_pages") {
        return { result: { content: [{ text: "1: Other (https://other.org/)" }] } };
      }
      return { result: {} };
    });
    await expect(
      executeAction(VUE_DEVTOOLS_ACTIONS.GET_APPS, { pageId: 1 }, asMcp(mcp), PROJECT_ORIGINS),
    ).rejects.toThrow("不在可操作范围");
    expect(mcp.callChromeDevTool.mock.calls.map((c) => c[0])).toEqual(["list_pages"]);
  });

  it("合法 pageId：先 select_page 再 evaluate_script，并解析 markdown JSON 结果", async () => {
    const mcp = makeMcp(fenced('{"ok":true}'));
    const result = await executeAction(
      VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_TREE,
      { pageId: 0, filter: "Foo" },
      asMcp(mcp),
      PROJECT_ORIGINS,
    );

    expect(result).toEqual({ ok: true });
    const calls = mcp.callChromeDevTool.mock.calls;
    expect(calls[0]).toEqual(["list_pages", {}]);
    expect(calls[1]).toEqual(["select_page", { pageId: 0, bringToFront: false }]);
    expect(calls[2][0]).toBe("evaluate_script");
    expect((calls[2][1] as { function: string }).function).toContain("getInspectorTree");
  });

  it("各 action 生成的表达式命中对应的桥 API", async () => {
    const cases: Array<{ action: string; args: Record<string, unknown>; expect: string[] }> = [
      {
        action: VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_TREE,
        args: { pageId: 0, filter: "Foo" },
        expect: ["getInspectorTree", '"Foo"'],
      },
      {
        action: VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_STATE,
        args: { pageId: 0, nodeId: "n1" },
        expect: ["getInspectorState", '"n1"'],
      },
      {
        action: VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_RENDER_CODE,
        args: { pageId: 0, nodeId: "n2" },
        expect: ["getComponentRenderCode", '"n2"'],
      },
      {
        action: VUE_DEVTOOLS_ACTIONS.GET_APPS,
        args: { pageId: 0 },
        expect: ["ctx.state.appRecords"],
      },
      {
        action: VUE_DEVTOOLS_ACTIONS.TOGGLE_APP,
        args: { pageId: 0, appId: "app-1" },
        expect: ["toggleApp", '"app-1"'],
      },
      {
        action: VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO,
        args: { pageId: 0 },
        expect: ["router.value", "safeStringify", "currentRoute"],
      },
    ];

    for (const testCase of cases) {
      const mcp = makeMcp("plain");
      await executeAction(testCase.action, testCase.args, asMcp(mcp), PROJECT_ORIGINS);
      const evalCall = mcp.callChromeDevTool.mock.calls.find((c) => c[0] === "evaluate_script");
      const expr = evalCall?.[1].function as string;
      for (const fragment of testCase.expect) expect(expr).toContain(fragment);
    }
  });

  it("未知 action 抛 Unknown action 错误", async () => {
    const mcp = makeMcp("x");
    await expect(
      executeAction("no_such_action", { pageId: 0 }, asMcp(mcp), PROJECT_ORIGINS),
    ).rejects.toThrow("Unknown action: no_such_action");
  });

  it("evaluate 无文本返回 null，纯文本返回原文", async () => {
    const empty = makeMcp();
    await expect(
      executeAction(VUE_DEVTOOLS_ACTIONS.GET_APPS, { pageId: 0 }, asMcp(empty), PROJECT_ORIGINS),
    ).resolves.toBeNull();

    const plain = makeMcp("Script ran and returned: hello");
    await expect(
      executeAction(VUE_DEVTOOLS_ACTIONS.GET_APPS, { pageId: 0 }, asMcp(plain), PROJECT_ORIGINS),
    ).resolves.toBe("Script ran and returned: hello");
  });
});

describe("setupVueDevtoolsEndpoint", () => {
  it("OPTIONS 返回 200，非 POST 返回 405", () => {
    const handler = captureHandler(asMcp(makeMcp()));

    const options = fakeRes();
    handler(fakeReq("OPTIONS"), options);
    expect(options.statusCode).toBe(200);

    const get = fakeRes();
    handler(fakeReq("GET"), get);
    expect(get.statusCode).toBe(405);
    expect(JSON.parse(get.payload)).toEqual({ error: "Method not allowed" });
  });

  it("POST 合法请求执行 action 并返回 { success, data }", async () => {
    const mcp = makeMcp(fenced('{"appRecords":[]}'));
    const handler = captureHandler(asMcp(mcp));
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        JSON.stringify({ action: VUE_DEVTOOLS_ACTIONS.GET_APPS, args: { pageId: 0 } }),
      ),
      res,
    );
    await flush();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ success: true, data: { appRecords: [] } });
  });

  it("POST 缺失 pageId 时返回 500 与错误信息", async () => {
    const handler = captureHandler(asMcp(makeMcp()));
    const res = fakeRes();
    await handler(
      fakeReq("POST", JSON.stringify({ action: VUE_DEVTOOLS_ACTIONS.GET_APPS, args: {} })),
      res,
    );
    await flush();

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toContain("缺少 pageId");
  });

  it("POST 非法 JSON 时返回 500", async () => {
    const handler = captureHandler(asMcp(makeMcp()));
    const res = fakeRes();
    await handler(fakeReq("POST", "{oops"), res);
    await flush();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).success).toBe(false);
  });
});
