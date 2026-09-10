/**
 * @aipanel/provider-opencode OpenCodeAPI 单元测试：
 * - buildSessionProxyUrl：loopback/端口 + base64(projectDir) + session id 拼接
 * - getSessions：请求 /session（directory 编码）并为每条会话注入代理 URL
 * - createSession：POST body 仅在显式传 title 时携带
 * 通过 mock node:http.request 承载请求封装，避免真实网络。
 */
import { EventEmitter } from "node:events";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeAPI } from "../src/api";
import { base64Encode } from "@aipanel/core";

/** 每次 mock 请求：options 与经 req.write 写入的 body */
interface CapturedRequest {
  options: http.RequestOptions;
  written: string[];
}

const captured: CapturedRequest[] = [];

function mockHttpRequest(responseBody: unknown) {
  captured.length = 0;
  return vi.spyOn(http, "request").mockImplementation(((_opts: unknown, cb?: unknown) => {
    const res = new EventEmitter();
    if (typeof cb === "function") (cb as (r: EventEmitter) => void)(res);
    setTimeout(() => {
      res.emit("data", JSON.stringify(responseBody));
      res.emit("end");
    }, 0);
    const written: string[] = [];
    captured.push({ options: _opts as http.RequestOptions, written });
    return {
      on: vi.fn(),
      write: vi.fn((chunk: string) => written.push(chunk)),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    } as unknown as http.ClientRequest;
  }) as never);
}

const lastRequest = () => captured[captured.length - 1]!;

let api: OpenCodeAPI;

beforeEach(() => {
  captured.length = 0;
  api = new OpenCodeAPI(
    "127.0.0.1",
    () => 6096,
    () => 6097,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenCodeAPI: buildSessionProxyUrl", () => {
  it("用 base64(projectDir) 拼出 loopback:proxyPort 的代理 URL", () => {
    const url = api.buildSessionProxyUrl("/project/foo", "sess-1");
    expect(url).toBe(`http://127.0.0.1:6097/${base64Encode("/project/foo")}/session/sess-1`);
  });
});

describe("OpenCodeAPI: getSessions", () => {
  it("请求 /session（directory 编码）并为每条会话注入代理 URL", async () => {
    mockHttpRequest([
      { id: "s1", directory: "/a b", summary: {}, time: { created: 1, updated: 2 } },
    ]);
    const sessions = await api.getSessions("/a b", 1);

    expect(lastRequest().options.path).toBe("/session?directory=%2Fa%20b");
    expect(lastRequest().options.port).toBe(6096);
    expect(sessions[0].id).toBe("s1");
    expect(sessions[0].url).toBe(`http://127.0.0.1:6097/${base64Encode("/a b")}/session/s1`);
  });
});

describe("OpenCodeAPI: createSession", () => {
  it("显式 title 时经 req.write 发 JSON body，无 title 时不写 body", async () => {
    mockHttpRequest({
      id: "n1",
      directory: "/proj",
      summary: {},
      time: { created: 1, updated: 2 },
    });

    await api.createSession("/proj", 1, "新会话");
    expect(lastRequest().options.method).toBe("POST");
    expect(lastRequest().options.port).toBe(6096);
    expect(lastRequest().written).toEqual([JSON.stringify({ title: "新会话" })]);

    await api.createSession("/proj", 1);
    expect(lastRequest().written).toEqual([]);
  });
});
