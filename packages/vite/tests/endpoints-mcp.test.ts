/**
 * endpoints/mcp.ts（setupMcpEndpoint）vitest 单元测试。
 *
 * 覆盖目标（tools/call 路由分发 / 边界守卫 / 错误映射）：
 * - 方法分发：非 MCP 路径 next、OPTIONS 204、GET SSE、DELETE、POST 空 body 400；
 * - tools/list：官方白名单 + CUSTOM_TOOLS + 服务日志工具组合、会话头；
 * - chrome-devtools_current_page / list_pages / new_page 各分支与错误映射；
 * - 工具白名单守卫（isAllowedToolName / deny）、pageId 解析与范围校验、
 *   navigate_page 目标范围守卫、select_page + 剥离 pageId 转发；
 * - vue-devtools_* action 映射与结果裁剪、logs-devtools_* 日志工具、默认方法透传。
 *
 * stub 策略：McpProxy 用 vi.fn stub（call/callChromeDevTool/forward），不启动真实进程；
 * fake server 捕获中间件后直接调用 handler(req,res,next)，req 为 EventEmitter（setImmediate 投递 body）；
 * 协议常量引用 @aipanel/core 与本地 mcp-tools（白名单单一来源）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MCP_API_PATH, type PageContext } from "@aipanel/core";
import { getProcessLogBuffer } from "@aipanel/core/node";
import { setupMcpEndpoint } from "../src/endpoints/mcp";
import type { McpProxy } from "../src/core/mcp-proxy";
import {
  CUSTOM_TOOLS,
  OFFICIAL_GLOBAL_POLICY,
  configureToolScope,
  displayToolName,
  officialDefaultShorts,
} from "../src/core/mcp-tools";
import { OFFICIAL_TOOL_META } from "../src/core/official-meta";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;
type FakeReq = EventEmitter & { method: string; url: string; headers: Record<string, unknown> };

const PROJECT_ORIGIN = "http://localhost:5173";
const PROJECT_LIST_TEXT = "0: App (http://localhost:5173/)";
const PAGE_TOOL = displayToolName("take_snapshot");

const ALL_SHORTS = [
  ...new Set([...OFFICIAL_TOOL_META.map((m) => m.name), ...OFFICIAL_GLOBAL_POLICY]),
];

function toolsListResponse() {
  return {
    result: {
      tools: ALL_SHORTS.map((short) => ({
        name: displayToolName(short),
        description: `official ${short}`,
        inputSchema: { type: "object", properties: {}, required: [] },
      })),
    },
  };
}

interface McpStub {
  sessionId: string;
  isRunning: boolean;
  call: ReturnType<typeof vi.fn>;
  callChromeDevTool: ReturnType<typeof vi.fn>;
  forward: ReturnType<typeof vi.fn>;
}

function makeMcp(): McpStub {
  return {
    sessionId: "sess-1",
    isRunning: true,
    call: vi.fn(async () => toolsListResponse()),
    callChromeDevTool: vi.fn(async () => ({ result: {} })),
    forward: vi.fn(async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { echoed: true } })),
  };
}

/** 让 list_pages 返回给定文本 */
function listPages(mcp: McpStub, text: string) {
  mcp.callChromeDevTool.mockImplementation(async (name: string) => {
    if (name === "list_pages") return { result: { content: [{ text }] } };
    if (name === "evaluate_script") {
      return {
        result: {
          content: [{ text: `Script ran on page and returned:\n\`\`\`json\nnull\n\`\`\`` }],
        },
      };
    }
    return { result: {} };
  });
}

function fakeReq(method: string, url = MCP_API_PATH, body?: string): FakeReq {
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
      if (headers) {
        for (const [k, v] of Object.entries(headers)) res.headers[k.toLowerCase()] = v;
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

function json(res: ReturnType<typeof fakeRes>) {
  return JSON.parse(res.payload);
}

function toolResultText(res: ReturnType<typeof fakeRes>): string {
  return json(res).result.content[0].text;
}

function toolError(res: ReturnType<typeof fakeRes>) {
  return json(res).error;
}

interface SetupOptions {
  mcp: McpStub;
  logFiles?: Array<{ name: string; path: string; description: string }>;
  chromeProject?: { allowOrigins?: string[]; includeExtensionPages?: boolean };
  origins?: string[];
  pageContext?: PageContext;
}

function setup(options: SetupOptions): Handler {
  let handler: Handler | null = null;
  const server = {
    resolvedUrls: { local: options.origins ?? [`${PROJECT_ORIGIN}/`], network: [] },
    middlewares: {
      use: (pathOrHandler: unknown, maybeHandler?: unknown) => {
        handler = (typeof pathOrHandler === "function" ? pathOrHandler : maybeHandler) as Handler;
      },
    },
  };
  setupMcpEndpoint(
    server as never,
    options.mcp as unknown as McpProxy,
    () => options.pageContext ?? { url: "", title: "" },
    options.logFiles ?? [],
    options.chromeProject,
  );
  if (!handler) throw new Error("mcp handler 未注册");
  return handler;
}

function postBody(
  res: ReturnType<typeof fakeRes>,
  params: Record<string, unknown>,
  id: number | null = 1,
) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params,
  };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-mcp-"));
const logFilePath = path.join(tmpDir, "api.log");

beforeAll(() => {
  fs.writeFileSync(logFilePath, "starting server\nERROR boom happened\nwarn slow\n", "utf-8");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  configureToolScope();
  getProcessLogBuffer().clear();
});

describe("setupMcpEndpoint — 方法分发", () => {
  it("非 MCP 路径请求交给 next()，不写响应", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    const next = vi.fn();
    await handler(fakeReq("GET", "/other"), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it("OPTIONS 返回 204 并设置 CORS 头", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(fakeReq("OPTIONS"), res, vi.fn());
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("DELETE 返回 200 空响应", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(fakeReq("DELETE"), res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("");
  });

  it("GET 建立 SSE：写入会话头与 ok 帧，断开时清理定时器", async () => {
    const mcp = makeMcp();
    const handler = setup({ mcp });
    const req = fakeReq("GET");
    const res = fakeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["mcp-session-id"]).toBe("sess-1");
    expect(res.payload).toContain(":ok\n\n");
    req.emit("close");
  });

  it("POST 空 body 返回 400", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(fakeReq("POST", MCP_API_PATH, ""), res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.payload).toBe("Empty body");
  });
});

describe("setupMcpEndpoint — tools/list", () => {
  it("返回官方白名单 + 自定义工具 + 服务日志工具，并带会话头", async () => {
    const mcp = makeMcp();
    const handler = setup({
      mcp,
      logFiles: [{ name: "api", path: logFilePath, description: "API 日志" }],
    });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      ),
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers["mcp-session-id"]).toBe("sess-1");
    expect(mcp.call).toHaveBeenCalledWith("tools/list", {});

    const names = (json(res).result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        ...officialDefaultShorts().map(displayToolName),
        ...CUSTOM_TOOLS.map((t) => t.name),
        "logs-devtools_api_logs",
      ]),
    );
    expect(names).toHaveLength(officialDefaultShorts().length + CUSTOM_TOOLS.length + 1);
  });
});

describe("setupMcpEndpoint — 页面工具", () => {
  it("current_page：无页面符合范围时给出提示", async () => {
    const mcp = makeMcp();
    listPages(mcp, "0: Other (https://other.org/)");
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: displayToolName("current_page"), arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(toolResultText(res)).toContain("暂无可用页面");
  });

  it("current_page：有页面但页面上下文为空时提示无法定位 pageId", async () => {
    const mcp = makeMcp();
    listPages(mcp, PROJECT_LIST_TEXT);
    const handler = setup({ mcp, pageContext: { url: "", title: "" } });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: displayToolName("current_page"), arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(toolResultText(res)).toContain("无法定位当前页面对应的 pageId");
  });

  it("list_pages：输出范围内页面，无会话标识时 active 全为 false", async () => {
    const mcp = makeMcp();
    listPages(mcp, PROJECT_LIST_TEXT);
    const handler = setup({ mcp, pageContext: { url: "", title: "" } });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: displayToolName("list_pages"), arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(JSON.parse(toolResultText(res))).toEqual([
      { pageId: 0, url: `${PROJECT_ORIGIN}/`, title: "App", active: false, selected: false },
    ]);
  });

  it("list_pages：底层返回 error 时映射为 -32603", async () => {
    const mcp = makeMcp();
    mcp.callChromeDevTool.mockResolvedValue({ error: { message: "Chrome 未连接" } });
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: displayToolName("list_pages"), arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32603);
    expect(toolError(res).message).toContain("Chrome 未连接");
  });

  it("new_page：缺少 url 返回 -32000", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: displayToolName("new_page"), arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32000);
    expect(toolError(res).message).toContain("缺少 url 参数");
  });

  it("new_page：范围外 URL 拒绝", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(
          postBody(res, {
            name: displayToolName("new_page"),
            arguments: { url: "https://evil.com/" },
          }),
        ),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32000);
    expect(toolError(res).message).toContain("不允许打开该页面");
  });

  it("new_page：项目页已打开时不重复打开", async () => {
    const mcp = makeMcp();
    listPages(mcp, PROJECT_LIST_TEXT);
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(
          postBody(res, {
            name: displayToolName("new_page"),
            arguments: { url: `${PROJECT_ORIGIN}/page` },
          }),
        ),
      ),
      res,
      vi.fn(),
    );
    expect(toolResultText(res)).toContain("当前项目已有打开的页面");
    expect(mcp.forward).not.toHaveBeenCalled();
  });

  it("new_page：项目页未打开时转发并注入 background", async () => {
    const mcp = makeMcp();
    listPages(mcp, "0: Other (https://other.org/)");
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(
          postBody(res, {
            name: displayToolName("new_page"),
            arguments: { url: `${PROJECT_ORIGIN}/page` },
          }),
        ),
      ),
      res,
      vi.fn(),
    );

    expect(mcp.forward).toHaveBeenCalledTimes(1);
    const forwarded = JSON.parse(mcp.forward.mock.calls[0][0] as string);
    expect(forwarded.params.name).toBe("new_page");
    expect(forwarded.params.arguments.background).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("allowOrigins 扩展可操作范围后能列出白名单页", async () => {
    const mcp = makeMcp();
    listPages(mcp, "0: Baidu (https://www.baidu.com/)");
    const handler = setup({ mcp, chromeProject: { allowOrigins: ["https://www.baidu.com"] } });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: displayToolName("list_pages"), arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(JSON.parse(toolResultText(res))[0].url).toBe("https://www.baidu.com/");
  });
});

describe("setupMcpEndpoint — 工具白名单与 pageId 守卫", () => {
  it("未知工具名返回 -32601", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: "chrome-devtools_not_a_real_tool", arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32601);
  });

  it("deny 的工具被白名单守卫拒绝", async () => {
    configureToolScope([], ["take_snapshot"]);
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: PAGE_TOOL, arguments: { pageId: 0 } })),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32601);
  });

  it("页面级工具缺少 pageId 返回 -32000", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: PAGE_TOOL, arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32000);
    expect(toolError(res).message).toContain("缺少 pageId 参数");
  });

  it("pageId 不在可操作范围返回 -32000", async () => {
    const mcp = makeMcp();
    listPages(mcp, PROJECT_LIST_TEXT);
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: PAGE_TOOL, arguments: { pageId: 9 } })),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32000);
    expect(toolError(res).message).toContain("不在可操作范围");
  });

  it("合法 pageId：先 select_page，再剥离 pageId 转发底层工具", async () => {
    const mcp = makeMcp();
    listPages(mcp, PROJECT_LIST_TEXT);
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: PAGE_TOOL, arguments: { pageId: 0, verbose: true } })),
      ),
      res,
      vi.fn(),
    );

    expect(mcp.callChromeDevTool).toHaveBeenCalledWith("select_page", {
      pageId: 0,
      bringToFront: false,
    });
    const forwarded = JSON.parse(mcp.forward.mock.calls[0][0] as string);
    expect(forwarded.params.name).toBe("take_snapshot");
    expect(forwarded.params.arguments).toEqual({ verbose: true });
    expect(forwarded.params.arguments).not.toHaveProperty("pageId");
  });

  it("navigate_page（type=url）目标范围外返回 -32000", async () => {
    const mcp = makeMcp();
    listPages(mcp, PROJECT_LIST_TEXT);
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(
          postBody(res, {
            name: displayToolName("navigate_page"),
            arguments: { pageId: 0, type: "url", url: "https://evil.com/" },
          }),
        ),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32000);
    expect(toolError(res).message).toContain("不允许跳转到该页面");
    expect(mcp.forward).not.toHaveBeenCalled();
  });
});

describe("setupMcpEndpoint — vue-devtools 与日志工具", () => {
  it("未知 vue-devtools 工具返回 -32601", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: "vue-devtools_unknown", arguments: { pageId: 0 } })),
      ),
      res,
      vi.fn(),
    );
    expect(toolError(res).code).toBe(-32601);
  });

  it("vue-devtools_get_current_route 提取 currentRoute", async () => {
    const mcp = makeMcp();
    mcp.callChromeDevTool.mockImplementation(async (name: string) => {
      if (name === "list_pages") return { result: { content: [{ text: PROJECT_LIST_TEXT }] } };
      if (name === "evaluate_script") {
        return {
          result: {
            content: [
              {
                text: 'Script ran on page and returned:\n```json\n{"currentRoute":{"path":"/home"},"routes":[{"path":"/"}]}\n```',
              },
            ],
          },
        };
      }
      return { result: {} };
    });
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(
          postBody(res, { name: "vue-devtools_get_current_route", arguments: { pageId: 0 } }),
        ),
      ),
      res,
      vi.fn(),
    );
    expect(toolResultText(res)).toBe(JSON.stringify({ path: "/home" }));
  });

  it("logs-devtools_vite_logs：缓冲区为空时给出使用建议", async () => {
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: "logs-devtools_vite_logs", arguments: {} })),
      ),
      res,
      vi.fn(),
    );
    expect(toolResultText(res)).toContain("当前没有符合条件的日志");
  });

  it("logs-devtools_vite_logs：缓冲区有日志时按级别图标格式化", async () => {
    getProcessLogBuffer().addEntry({
      level: "error",
      message: "vite crashed",
      timestamp: new Date().toISOString(),
      source: "vite",
    });
    const handler = setup({ mcp: makeMcp() });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(
          postBody(res, { name: "logs-devtools_vite_logs", arguments: { limit: 10 } }),
        ),
      ),
      res,
      vi.fn(),
    );
    expect(toolResultText(res)).toContain("vite crashed");
    expect(toolResultText(res)).toContain("❌");
  });

  it("服务日志工具从文件 tail 读取并格式化", async () => {
    const handler = setup({
      mcp: makeMcp(),
      logFiles: [{ name: "api", path: logFilePath, description: "API 日志" }],
    });
    const res = fakeRes();
    await handler(
      fakeReq(
        "POST",
        MCP_API_PATH,
        JSON.stringify(postBody(res, { name: "logs-devtools_api_logs", arguments: { limit: 10 } })),
      ),
      res,
      vi.fn(),
    );
    const text = toolResultText(res);
    expect(text).toContain("api 日志（");
    expect(text).toContain("ERROR boom happened");
  });
});

describe("setupMcpEndpoint — 默认方法透传", () => {
  it("initialize 等未知方法直接转发", async () => {
    const mcp = makeMcp();
    const handler = setup({ mcp });
    const res = fakeRes();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} });
    await handler(fakeReq("POST", MCP_API_PATH, body), res, vi.fn());

    expect(mcp.forward).toHaveBeenCalledWith(body);
    expect(res.statusCode).toBe(200);
    expect(json(res).result).toEqual({ echoed: true });
  });

  it("非 JSON body 也走透传（method 视为 unknown）", async () => {
    const mcp = makeMcp();
    const handler = setup({ mcp });
    const res = fakeRes();
    await handler(fakeReq("POST", MCP_API_PATH, "not-json"), res, vi.fn());
    expect(mcp.forward).toHaveBeenCalledWith("not-json");
  });
});
