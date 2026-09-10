/**
 * packages/extension/src/content/index.ts 单元测试。
 *
 * 策略：content script 顶层即注册监听并拦截 history，需先注入 chrome stub 再 import。
 * 该脚本用 window 上的初始化标记做幂等，故整个文件只 import 一次（beforeAll），
 * 各用例复用同一实例的监听器，通过 beforeEach 清理 mock 调用。
 * 最后一个用例单独验证「重复注入被标记拦截」。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { EXT_MSG, SESSION_ID_KEY, WIDGET_MSG } from "@aipanel/core";
import { createChromeStub, installChrome, flushAsync, type ChromeStub } from "./helpers";

/** content script 内部的初始化标记（源码未导出，测试内直接引用其字面量做幂等断言） */
const EXTENSION_INIT_MARKER = "__AIPANEL_EXTENSION_INITIALIZED__";

let chromeStub: ChromeStub;
let initialCalls: unknown[][];

beforeAll(async () => {
  chromeStub = createChromeStub();
  installChrome(chromeStub);
  sessionStorage.clear();
  delete (window as unknown as Record<string, unknown>)[EXTENSION_INIT_MARKER];

  await import("../src/content/index");
  await flushAsync();

  initialCalls = [...chromeStub.runtime.sendMessage.mock.calls];
});

beforeEach(() => {
  chromeStub.runtime.sendMessage.mockClear();
});

describe("content script 页面上下文上报", () => {
  it("启动时立即上报 url/title", () => {
    expect(initialCalls.some((call) => (call[0] as { type?: string }).type === EXT_MSG.PAGE_CONTEXT)).toBe(
      true,
    );
    const msg = initialCalls.find(
      (call) => (call[0] as { type?: string }).type === EXT_MSG.PAGE_CONTEXT,
    )![0] as { ctx: { url: string; title: string } };
    expect(msg.ctx.url).toBe(location.href);
    expect(msg.ctx.title).toBe(document.title);
  });

  it("携带 sessionStorage 中的会话 ID", async () => {
    sessionStorage.setItem(SESSION_ID_KEY, "sess-abc");

    history.pushState({}, "", "/next");
    await flushAsync();

    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EXT_MSG.PAGE_CONTEXT,
        ctx: expect.objectContaining({ sessionId: "sess-abc" }),
      }),
    );
  });

  it("pushState / replaceState 拦截后重新上报", async () => {
    history.pushState({}, "", "/a");
    await flushAsync();
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledTimes(1);

    history.replaceState({}, "", "/b");
    await flushAsync();
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("popstate 事件触发重新上报", async () => {
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flushAsync();

    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: EXT_MSG.PAGE_CONTEXT }),
    );
  });
});

describe("content script 消息中继", () => {
  it("REQUEST_PAGE_CONTEXT 立即上报并回包 success", async () => {
    const listener = chromeStub.runtime.onMessage.listeners[0];
    const sendResponse = vi.fn();

    const result = listener({ type: EXT_MSG.REQUEST_PAGE_CONTEXT }, {}, sendResponse);

    expect(result).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: EXT_MSG.PAGE_CONTEXT }),
    );
  });

  it("SELECTION_START / SELECTION_STOP 通过 window.postMessage 转发到页面", async () => {
    const postSpy = vi.spyOn(window, "postMessage");
    const listener = chromeStub.runtime.onMessage.listeners[0];
    const sendResponse = vi.fn();

    expect(listener({ type: EXT_MSG.SELECTION_START }, {}, sendResponse)).toBe(true);
    expect(postSpy).toHaveBeenCalledWith({ type: WIDGET_MSG.SELECTOR_START }, "*");
    expect(sendResponse).toHaveBeenCalledWith({ success: true });

    expect(listener({ type: EXT_MSG.SELECTION_STOP }, {}, sendResponse)).toBe(true);
    expect(postSpy).toHaveBeenCalledWith({ type: WIDGET_MSG.SELECTOR_STOP }, "*");

    postSpy.mockRestore();
  });
});

describe("content script 页面选择结果转发", () => {
  it("同源且类型匹配时转发到 background，补 pageUrl 并移除 pageTitle", async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        data: { type: WIDGET_MSG.ELEMENT_SELECTED, pageTitle: "T", element: { id: 1 } },
      }),
    );
    await flushAsync();

    const forwarded = chromeStub.runtime.sendMessage.mock.calls.find(
      (call) => (call[0] as { type?: string }).type === WIDGET_MSG.ELEMENT_SELECTED,
    );
    expect(forwarded).toBeDefined();
    const payload = forwarded![0] as Record<string, unknown>;
    expect(payload.pageUrl).toBe(location.href);
    expect(payload).not.toHaveProperty("pageTitle");
  });

  it("跨源消息被忽略", async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example",
        data: { type: WIDGET_MSG.ELEMENT_SELECTED },
      }),
    );
    await flushAsync();

    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: WIDGET_MSG.ELEMENT_SELECTED }),
    );
  });

  it("不匹配的消息类型不转发", async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        data: { type: "SOME_OTHER_EVENT" },
      }),
    );
    await flushAsync();

    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe("content script 幂等", () => {
  it("重复注入被初始化标记拦截，不再注册监听", async () => {
    const listenersBefore = chromeStub.runtime.onMessage.listeners.length;

    vi.resetModules();
    await import("../src/content/index");
    await flushAsync();

    expect(chromeStub.runtime.onMessage.listeners.length).toBe(listenersBefore);
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
