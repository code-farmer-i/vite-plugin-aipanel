/**
 * packages/extension/src/sidepanel/index.ts 单元测试。
 *
 * 策略：sidepanel 顶层 init IIFE 会创建 DOM 容器、动态 import vue 与 App 组件并挂载，
 * 故 mock "vue".createApp 及两个组件模块，注入 chrome stub 后动态 import。
 * 每个用例 vi.resetModules() 重载模块以获得干净的多实例/僵尸态状态。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EXT_MSG } from "@aipanel/core";
import { createChromeStub, installChrome, emitEvent, flushAsync, type ChromeStub } from "./helpers";

const createAppMock = vi.hoisted(() => vi.fn());

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue")>();
  return { ...actual, createApp: createAppMock };
});
vi.mock("../src/sidepanel/NoServicePrompt.vue", () => ({
  default: { name: "NoServicePrompt" },
}));
vi.mock("@aipanel/client/App.vue", () => ({ default: { name: "App" } }));

const SERVICE = {
  serviceInstanceId: "sid-1",
  vitePort: "5173",
  viteHost: "localhost",
  proxyPort: 4444,
  projectRoot: "/proj",
};

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = createChromeStub();
  installChrome(chromeStub);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** 卸载并重载 sidepanel，返回新建的 mock App 实例信息 */
async function loadSidepanel(service: typeof SERVICE | null = null): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  createAppMock.mockReset();
  createAppMock.mockImplementation(() => ({ mount: vi.fn(), unmount: vi.fn() }));
  chromeStub.runtime.sendMessage.mockImplementation(async () => service ?? undefined);

  await import("../src/sidepanel/index");
  await flushAsync();
}

/** 从 createAppMock 调用记录里找出挂载 App 组件的那次调用的返回值 */
function appInstance(): { mount: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn> } {
  const call = createAppMock.mock.results.find(
    (_, index) => (createAppMock.mock.calls[index][0] as { name?: string })?.name === "App",
  );
  return call!.value;
}

describe("sidepanel 初始化", () => {
  it("创建 wrapper 与无服务容器，并挂载 NoServicePrompt", async () => {
    await loadSidepanel(null);

    expect(document.getElementById("aipanel-sidepanel-wrapper")).not.toBeNull();
    const noService = document.getElementById("aipanel-no-service-root");
    expect(noService).not.toBeNull();
    // 无服务时覆盖层可见
    expect((noService as HTMLElement).style.left).toBe("0px");
    expect(createAppMock).toHaveBeenCalledTimes(1);
  });

  it("FORCE_POLL 返回服务信息时为该服务创建并挂载 App 实例", async () => {
    await loadSidepanel(SERVICE);

    expect(createAppMock).toHaveBeenCalledTimes(2);
    const mixedCall = createAppMock.mock.calls.find(
      (call) => (call[0] as { name?: string })?.name === "App",
    );
    expect(mixedCall).toBeDefined();
    // 配置透传关键字段
    expect(mixedCall![1]).toMatchObject({
      config: expect.objectContaining({
        serviceInstanceId: "sid-1",
        vitePort: "5173",
        proxyPort: 4444,
        displayMode: "extension",
      }),
    });
    // App 根节点挂到 wrapper 上
    const wrapper = document.getElementById("aipanel-sidepanel-wrapper")!;
    expect(wrapper.children.length).toBe(2);
  });
});

/** 触发 sidepanel 的 runtime.onMessage 监听（sender/sendResponse 由 sidepanel 忽略） */
function dispatch(msg: Record<string, unknown>): Promise<unknown[]> {
  return Promise.all(emitEvent(chromeStub.runtime.onMessage, msg, {}, vi.fn()));
}

describe("sidepanel 消息驱动", () => {
  it("TAB_SWITCHED（portInfo 为空）显示无服务覆盖层", async () => {
    await loadSidepanel(null);
    const noService = document.getElementById("aipanel-no-service-root") as HTMLElement;
    noService.style.left = "-10000px";

    await dispatch({ type: EXT_MSG.TAB_SWITCHED, portInfo: null, tabId: 10, windowId: 1 });
    await flushAsync();

    expect(noService.style.left).toBe("0px");
  });

  it("跨窗口消息被过滤，不为其他窗口创建实例", async () => {
    await loadSidepanel(null);
    const before = createAppMock.mock.calls.length;

    await dispatch({ type: EXT_MSG.TAB_SWITCHED, portInfo: SERVICE, tabId: 10, windowId: 2 });
    await flushAsync();

    expect(createAppMock.mock.calls.length).toBe(before);
  });

  it("SERVICE_APPEARED 缺字段时忽略，字段完整时创建实例", async () => {
    await loadSidepanel(null);
    const before = createAppMock.mock.calls.length;

    await dispatch({ type: EXT_MSG.SERVICE_APPEARED, serviceInstanceId: "sid-x", windowId: 1 });
    await flushAsync();
    expect(createAppMock.mock.calls.length).toBe(before);

    await dispatch({ type: EXT_MSG.SERVICE_APPEARED, ...SERVICE, windowId: 1 });
    await flushAsync();
    expect(createAppMock.mock.calls.length).toBe(before + 1);
  });

  it("SERVICE_APPEARED 命中已有实例时复用，不重复创建", async () => {
    await loadSidepanel(SERVICE);
    const before = createAppMock.mock.calls.length;

    await dispatch({
      type: EXT_MSG.SERVICE_APPEARED,
      ...SERVICE,
      vitePort: "6000",
      windowId: 1,
    });
    await flushAsync();

    expect(createAppMock.mock.calls.length).toBe(before);
  });

  it("SERVICE_GONE 后延迟 30s 销毁实例", async () => {
    await loadSidepanel(SERVICE);
    const instance = appInstance();

    vi.useFakeTimers();
    await dispatch({ type: EXT_MSG.SERVICE_GONE, serviceInstanceId: "sid-1", windowId: 1 });

    expect(instance.unmount).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(instance.unmount).toHaveBeenCalledTimes(1);
  });
});
