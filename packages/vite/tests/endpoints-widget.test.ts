/**
 * endpoints/widget.ts（setupWidgetEndpoints）vitest 单元测试。
 *
 * 覆盖目标：挂件脚本/样式资源存在时 200 + 正确 content-type 并通过流写出文件内容；
 * 资源缺失时 404。以真实临时文件驱动 fs，避免 mock fs（临时目录测试后清理）。
 *
 * stub 策略：fake server 捕获两个中间件（脚本/样式路径）；res 用 Writable 子类，
 * 以便接收 fs.createReadStream 的 pipe。协议路径引用 @aipanel/core 的
 * WIDGET_SCRIPT_PATH / WIDGET_STYLE_PATH。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WIDGET_SCRIPT_PATH, WIDGET_STYLE_PATH } from "@aipanel/core";
import { setupWidgetEndpoints } from "../src/endpoints/widget";
import type { EndpointContext } from "../src/endpoints/types";

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;

class FakeRes extends Writable {
  headers: Record<string, unknown> = {};
  statusCode: number | undefined = undefined;
  payload = "";

  setHeader(key: string, value: unknown) {
    this.headers[key.toLowerCase()] = value;
  }

  writeHead(code: number, headers?: Record<string, unknown>) {
    this.statusCode = code;
    if (headers) Object.assign(this.headers, headers);
    return this;
  }

  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
    this.payload += chunk.toString();
    cb();
  }
}

function runHandler(handler: Handler, res: FakeRes) {
  const finished = new Promise<void>((resolve) => {
    if (res.writableEnded) resolve();
    else res.once("finish", resolve);
  });
  const handled = Promise.resolve(handler({ method: "GET", url: "/", headers: {} }, res, () => {}));
  return Promise.all([handled, finished]).then(() => res);
}

function captureHandlers(ctx: EndpointContext) {
  const handlers = new Map<string, Handler>();
  const server = {
    middlewares: {
      use: (pathOrHandler: unknown, maybeHandler?: unknown) => {
        if (typeof pathOrHandler === "function") {
          handlers.set("__no_path__", pathOrHandler as Handler);
        } else {
          handlers.set(pathOrHandler as string, maybeHandler as Handler);
        }
      },
    },
  };
  setupWidgetEndpoints(server as never, ctx);
  return handlers;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-widget-"));
const scriptPath = path.join(tmpDir, "widget.js");
const stylePath = path.join(tmpDir, "widget.css");
const missingScriptPath = path.join(tmpDir, "missing.js");
const missingStylePath = path.join(tmpDir, "missing.css");

beforeAll(() => {
  fs.writeFileSync(scriptPath, "window.__widget__=1;", "utf-8");
  fs.writeFileSync(stylePath, ".widget{color:red}", "utf-8");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeCtx(script: string, style: string): EndpointContext {
  return {
    resolveWidgetPath: () => script,
    resolveWidgetStylePath: () => style,
  } as unknown as EndpointContext;
}

describe("setupWidgetEndpoints", () => {
  it("注册脚本与样式两个中间件", () => {
    const handlers = captureHandlers(makeCtx(scriptPath, stylePath));
    expect(handlers.has(WIDGET_SCRIPT_PATH)).toBe(true);
    expect(handlers.has(WIDGET_STYLE_PATH)).toBe(true);
  });

  it("脚本存在时返回 200、application/javascript 与文件内容", async () => {
    const handlers = captureHandlers(makeCtx(scriptPath, stylePath));
    const res = await runHandler(handlers.get(WIDGET_SCRIPT_PATH)!, new FakeRes());

    // 成功分支只 setHeader 后直接 pipe，未显式 writeHead：Node http 默认 200
    expect(res.statusCode ?? 200).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.payload).toBe("window.__widget__=1;");
  });

  it("脚本缺失时返回 404 与提示文本", async () => {
    const handlers = captureHandlers(makeCtx(missingScriptPath, stylePath));
    const res = await runHandler(handlers.get(WIDGET_SCRIPT_PATH)!, new FakeRes());

    expect(res.statusCode).toBe(404);
    expect(res.payload).toBe("Widget script not found");
  });

  it("样式存在时返回 200、text/css 与文件内容", async () => {
    const handlers = captureHandlers(makeCtx(scriptPath, stylePath));
    const res = await runHandler(handlers.get(WIDGET_STYLE_PATH)!, new FakeRes());

    expect(res.statusCode ?? 200).toBe(200);
    expect(res.headers["content-type"]).toBe("text/css");
    expect(res.payload).toBe(".widget{color:red}");
  });

  it("样式缺失时返回 404 与提示文本", async () => {
    const handlers = captureHandlers(makeCtx(scriptPath, missingStylePath));
    const res = await runHandler(handlers.get(WIDGET_STYLE_PATH)!, new FakeRes());

    expect(res.statusCode).toBe(404);
    expect(res.payload).toBe("Widget style not found");
  });
});
