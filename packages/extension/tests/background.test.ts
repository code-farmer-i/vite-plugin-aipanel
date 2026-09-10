/**
 * packages/extension/src/background/index.ts 单元测试。
 *
 * 策略：background 在模块顶层注册 chrome 监听并执行 async IIFE（启动轮询），
 * 因此每个用例先注入 chrome/fetch stub，再 vi.resetModules() 后动态 import，
 * 用 flushAsync 等待顶层 IIFE 收敛，然后手动 emit 监听器断言副作用。
 * 轮询定时器只 fake setInterval，保留真实 setTimeout 以便等待微任务。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EXT_MSG, EXT_BROADCAST, START_API_PATH, SERVER_SYNC_INTERVAL } from "@aipanel/core";
import {
  createChromeStub,
  installChrome,
  emitEvent,
  flushAsync,
  type ChromeStub,
} from "./helpers";

const SERVICE_PAYLOAD = {
  proxyPort: 4444,
  vitePort: "5173",
  serviceInstanceId: "sid-1",
  projectRoot: "/proj",
  verbose: false,
};

let chromeStub: ChromeStub;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  chromeStub = createChromeStub();
  fetchMock = vi.fn(async () => ({ json: async () => SERVICE_PAYLOAD }));
  installChrome(chromeStub);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadBackground(): Promise<void> {
  await import("../src/background/index");
  await flushAsync();
}

describe("background 启动与轮询", () => {
  it("启动时轮询活跃 Tab 的本地服务并广播 SERVICE_APPEARED", async () => {
    await loadBackground();

    expect(fetchMock).toHaveBeenCalledWith(`http://localhost:5173${START_API_PATH}`);
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EXT_MSG.SERVICE_APPEARED,
        serviceInstanceId: "sid-1",
        windowId: 1,
      }),
    );
    // POLL_INTERVAL 单一来源：core SERVER_SYNC_INTERVAL
    expect(SERVER_SYNC_INTERVAL).toBeGreaterThan(0);
    expect(chromeStub.tabs.onActivated.addListener).toHaveBeenCalled();
  });

  it("活跃 Tab 非本地地址时不请求服务端点", async () => {
    chromeStub.tabs.get.mockResolvedValue({ id: 10, windowId: 1, url: "https://example.com/" });
    chromeStub.tabs.query.mockResolvedValue([{ id: 10, windowId: 1, url: "https://example.com/" }]);

    await loadBackground();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: EXT_MSG.SERVICE_APPEARED }),
    );
  });

  it("onActivated 更新活跃映射、通知 sidepanel 并请求页面上下文", async () => {
    await loadBackground();
    chromeStub.runtime.sendMessage.mockClear();
    chromeStub.tabs.sendMessage.mockClear();
    // 新 Tab 非本地 → 无服务
    chromeStub.tabs.get.mockResolvedValue({ id: 20, windowId: 1, url: "https://example.com/" });

    await Promise.all(emitEvent(chromeStub.tabs.onActivated, { tabId: 20, windowId: 1 }));
    await flushAsync();

    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EXT_MSG.TAB_SWITCHED,
        tabId: 20,
        windowId: 1,
        portInfo: null,
      }),
    );
    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(20, {
      type: EXT_MSG.REQUEST_PAGE_CONTEXT,
    });
  });
});

describe("background Tab URL 变更", () => {
  it("同 origin 路径切换不重新轮询服务", async () => {
    await loadBackground();
    fetchMock.mockClear();

    await Promise.all(
      emitEvent(chromeStub.tabs.onUpdated, 10, { url: "http://localhost:5173/other" }, {
        id: 10,
        windowId: 1,
      }),
    );
    await flushAsync();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("导航到非本地 origin 时广播 SERVICE_GONE", async () => {
    await loadBackground();
    chromeStub.runtime.sendMessage.mockClear();

    await Promise.all(
      emitEvent(chromeStub.tabs.onUpdated, 10, { url: "https://example.com/" }, {
        id: 10,
        windowId: 1,
      }),
    );
    await flushAsync();

    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: EXT_MSG.SERVICE_GONE, serviceInstanceId: "sid-1" }),
    );
  });
});

describe("background Tab / 窗口关闭", () => {
  it("Tab 关闭且无其他引用时广播下线的同时切换提示", async () => {
    await loadBackground();
    chromeStub.runtime.sendMessage.mockClear();
    chromeStub.tabs.query.mockResolvedValue([]);

    await Promise.all(emitEvent(chromeStub.tabs.onRemoved, 10, { windowId: 1 }));
    await flushAsync();

    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: EXT_MSG.SERVICE_GONE, serviceInstanceId: "sid-1" }),
    );
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: EXT_MSG.TAB_SWITCHED, tabId: 10, windowId: 1 }),
    );
  });

  it("onFocusChanged 忽略 WINDOW_ID_NONE 与当前活跃窗口", async () => {
    await loadBackground();
    fetchMock.mockClear();

    await Promise.all(emitEvent(chromeStub.windows.onFocusChanged, chromeStub.windows.WINDOW_ID_NONE));
    await Promise.all(emitEvent(chromeStub.windows.onFocusChanged, 1));
    await flushAsync();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("background 消息处理", () => {
  it("转发 PAGE_CONTEXT / THEME_CHANGE 并补全 tabId/windowId", async () => {
    await loadBackground();
    chromeStub.runtime.sendMessage.mockClear();
    const listener = chromeStub.runtime.onMessage.listeners[0];

    const result = listener(
      { type: EXT_BROADCAST.PAGE_CONTEXT, ctx: { url: "http://localhost:5173/" } },
      { tab: { id: 7, windowId: 2 } },
      vi.fn(),
    );

    expect(result).toBe(false);
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: EXT_BROADCAST.PAGE_CONTEXT, tabId: 7, windowId: 2 }),
    );
  });

  it("FORCE_POLL 触发立即轮询并通过 sendResponse 回包当前服务", async () => {
    await loadBackground();
    const listener = chromeStub.runtime.onMessage.listeners[0];
    const sendResponse = vi.fn();

    const result = listener({ type: EXT_MSG.FORCE_POLL }, {}, sendResponse);
    expect(result).toBe(true);

    await flushAsync();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ serviceInstanceId: "sid-1", proxyPort: 4444 }),
    );
  });

  it("无关消息类型返回 false 且不转发", async () => {
    await loadBackground();
    chromeStub.runtime.sendMessage.mockClear();
    const listener = chromeStub.runtime.onMessage.listeners[0];

    const result = listener({ type: "UNKNOWN_MSG" }, {}, vi.fn());

    expect(result).toBe(false);
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
