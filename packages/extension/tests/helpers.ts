/**
 * Extension 包测试辅助：Chrome 扩展 API 的最小 stub。
 *
 * background / content / sidepanel 三个入口都在模块顶层注册监听并触发副作用，
 * 测试需要先注入 stub 再动态 import 源码；此处的 stub 只实现被测代码实际用到的
 * 方法/事件，避免引入真实 Chrome 运行时。
 */
import { vi, type Mock } from "vitest";

/** 单个 chrome 事件的桩：记录监听器，可由 emit 手动触发 */
export interface ChromeEvent<A extends unknown[] = unknown[]> {
  addListener: Mock;
  listeners: Array<(...args: A) => unknown>;
}

export function createChromeEvent<A extends unknown[]>(): ChromeEvent<A> {
  const listeners: Array<(...args: A) => unknown> = [];
  const addListener = vi.fn((fn: (...args: A) => unknown) => {
    listeners.push(fn);
  });
  return { addListener, listeners };
}

/** 按注册顺序触发事件的所有监听器，返回其返回值（含 Promise） */
export function emitEvent<A extends unknown[]>(
  event: ChromeEvent<A>,
  ...args: A
): Array<unknown | Promise<unknown>> {
  return event.listeners.map((fn) => fn(...args));
}

export interface ChromeStub {
  tabs: {
    get: Mock;
    query: Mock;
    sendMessage: Mock;
    onActivated: ChromeEvent<[{ tabId: number; windowId: number }]>;
    onUpdated: ChromeEvent<
      [tabId: number, changeInfo: { url?: string }, tab: { id: number; windowId: number }]
    >;
    onRemoved: ChromeEvent<[tabId: number, removeInfo: { windowId: number }]>;
  };
  windows: {
    WINDOW_ID_NONE: number;
    getAll: Mock;
    getCurrent: Mock;
    onFocusChanged: ChromeEvent<[windowId: number]>;
    onRemoved: ChromeEvent<[windowId: number]>;
  };
  runtime: {
    sendMessage: Mock;
    onMessage: ChromeEvent<
      [
        msg: Record<string, unknown>,
        sender: { tab?: { id?: number; windowId?: number } },
        sendResponse: (response?: unknown) => void,
      ]
    >;
    onInstalled: ChromeEvent<[]>;
  };
  action: { onClicked: ChromeEvent<[{ id?: number }]> };
  sidePanel: { open: Mock };
}

/** 创建一个默认「活跃 Tab 命中本地服务」的 Chrome stub */
export function createChromeStub(configure?: (stub: ChromeStub) => void): ChromeStub {
  const stub: ChromeStub = {
    tabs: {
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        windowId: 1,
        url: "http://localhost:5173/",
      })),
      query: vi.fn(async () => [{ id: 10, windowId: 1, url: "http://localhost:5173/" }]),
      sendMessage: vi.fn(async () => undefined),
      onActivated: createChromeEvent(),
      onUpdated: createChromeEvent(),
      onRemoved: createChromeEvent(),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getAll: vi.fn(async () => [{ id: 1 }]),
      getCurrent: vi.fn(async () => ({ id: 1 })),
      onFocusChanged: createChromeEvent(),
      onRemoved: createChromeEvent(),
    },
    runtime: {
      sendMessage: vi.fn(async () => undefined),
      onMessage: createChromeEvent(),
      onInstalled: createChromeEvent(),
    },
    action: { onClicked: createChromeEvent() },
    sidePanel: { open: vi.fn(async () => undefined) },
  };
  configure?.(stub);
  return stub;
}

/** 将 stub 注入全局 chrome（源码内直接引用 chrome 全局） */
export function installChrome(stub: ChromeStub): void {
  Object.assign(globalThis, { chrome: stub as unknown as typeof chrome });
}

/** 等待若干轮微任务，让入口模块的顶层 async IIFE 完成 */
export async function flushAsync(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
