/**
 * core/service.ts（AIPanelService 服务生命周期编排）vitest 单元测试。
 *
 * 覆盖目标：启动流程各步骤（环境检查 / 端口分配 / Web 启动与就绪等待 / 代理启动 /
 * Chrome MCP 预热 / 事件订阅 / 任务状态推送）、已启动与并发幂等、各类失败分支的
 * 任务状态与清理（provider.stop / startPromise 重置）、stop 清理、宿主事件广播与
 * retryWarmupChromeMcp 各结果。
 *
 * stub 策略：
 * - vi.mock 隔离 @aipanel/core/node（createLogger / findAvailablePort / findGitRoot /
 *   waitForServer）与 ../src/core/proxy-server（startProxyServer），不触碰真实文件系统、端口与子进程；
 * - WebProvider / McpProxy 均为最小 stub（vi.fn），不启动真实 Provider/Chrome。
 *   mock 通过 vi.hoisted 提升，避免 vitest 的 vi.mock 提升规则导致引用未初始化。
 * 事件类型引用 @aipanel/core 的 SSE_EVENT_TYPES 单一来源。
 */
import { describe, expect, it, vi } from "vitest";
import type http from "node:http";
import {
  DEFAULT_PROXY_PORT,
  DEFAULT_WEB_PORT,
  SSE_EVENT_TYPES,
  type PluginOptions,
  type ProviderEvent,
  type ServiceStartupTask,
  type WebProvider,
} from "@aipanel/core";

const h = vi.hoisted(() => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    timer: vi.fn(() => ({ end: vi.fn(), checkpoint: vi.fn() })),
  })),
  findAvailablePort: vi.fn(async (port: number) => port),
  findGitRoot: vi.fn(() => "/repo"),
  waitForServer: vi.fn(async () => undefined),
  startProxyServer: vi.fn(),
}));

vi.mock("@aipanel/core/node", () => ({
  createLogger: h.createLogger,
  findAvailablePort: h.findAvailablePort,
  findGitRoot: h.findGitRoot,
  waitForServer: h.waitForServer,
}));

vi.mock("../src/core/proxy-server", () => ({
  startProxyServer: h.startProxyServer,
}));

import { AIPanelService } from "../src/core/service";
import type { McpProxy } from "../src/core/mcp-proxy";

function makeConfig(overrides: Partial<PluginOptions> = {}): Required<PluginOptions> {
  return {
    enabled: true,
    provider: "default",
    webPort: DEFAULT_WEB_PORT,
    proxyPort: DEFAULT_PROXY_PORT,
    hostname: "127.0.0.1",
    position: "bottom-right",
    theme: "dark",
    open: false,
    verbose: false,
    mcpOnly: false,
    hotkey: "ctrl+k",
    warmupChromeMcp: true,
    chromeDevtoolsPort: 9222,
    displayMode: "bubble",
    splitMode: undefined,
    logFiles: [],
    providerOptions: {},
    ...overrides,
  } as unknown as Required<PluginOptions>;
}

interface ProviderMocks {
  id: string;
  displayName: string;
  bridgeScript: string;
  checkEnvironment: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  killOrphans: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
  buildSessionUrl: ReturnType<typeof vi.fn>;
  subscribeEvents: ReturnType<typeof vi.fn>;
}

function makeProvider(overrides: Partial<ProviderMocks> = {}): {
  provider: ProviderMocks;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const unsubscribe = vi.fn();
  const provider: ProviderMocks = {
    id: "test",
    displayName: "TestProvider",
    checkEnvironment: vi.fn(async () => ({ ok: true, version: "1.2.3" })),
    start: vi.fn(async () => ({
      url: "http://127.0.0.1:5097",
      processHandle: { exitCode: null },
    })),
    stop: vi.fn(async () => undefined),
    killOrphans: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
    createSession: vi.fn(async () => ({ id: "s1", title: "t" })),
    deleteSession: vi.fn(async () => undefined),
    buildSessionUrl: vi.fn(() => "http://127.0.0.1:5097/"),
    subscribeEvents: vi.fn(() => unsubscribe),
    bridgeScript: "<bridge-script>",
    ...overrides,
  };
  return { provider, unsubscribe };
}

function asProvider(provider: ProviderMocks): WebProvider {
  return provider as unknown as WebProvider;
}

interface McpMocks {
  sessionId: string;
  isRunning: boolean;
  verify: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
  callChromeDevTool: ReturnType<typeof vi.fn>;
  forward: ReturnType<typeof vi.fn>;
}

function makeMcp(
  verify: () => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: true }),
): McpMocks {
  return {
    sessionId: "sess-1",
    isRunning: true,
    verify: vi.fn(verify),
    call: vi.fn(),
    callChromeDevTool: vi.fn(),
    forward: vi.fn(),
  };
}

function asMcp(mcp: McpMocks): McpProxy {
  return mcp as unknown as McpProxy;
}

function makeSseClients() {
  const writes: string[] = [];
  const client = {
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
  };
  const clients = new Set([client]) as unknown as Set<http.ServerResponse>;
  return { clients, writes };
}

function makeService(config: Required<PluginOptions> = makeConfig()) {
  const sse = makeSseClients();
  const onPortAllocated = vi.fn();
  const onProxyPortAllocated = vi.fn();
  const service = new AIPanelService(config, sse.clients, onPortAllocated, onProxyPortAllocated);
  return { service, sse, onPortAllocated, onProxyPortAllocated };
}

function startArgs(mcp: McpProxy): Parameters<AIPanelService["start"]> {
  return [
    5173,
    "localhost",
    ["http://localhost:5173"],
    "http://localhost:5173/context",
    "http://localhost:5173/logs",
    "http://localhost:5173",
    mcp,
    "http://localhost:5173/vue",
  ];
}

function events(writes: string[]): Record<string, unknown>[] {
  return writes.map((w) => JSON.parse(w.replace(/^data: /, "").trim()) as Record<string, unknown>);
}

function taskUpdates(writes: string[]): Record<string, unknown>[] {
  return events(writes).filter((e) => e.type === SSE_EVENT_TYPES.TASK_UPDATE);
}

function last<T>(items: T[]): T {
  return items[items.length - 1];
}

function resetMocks() {
  h.findAvailablePort.mockReset().mockImplementation(async (port: number) => port);
  h.findGitRoot.mockReset().mockReturnValue("/repo");
  h.waitForServer.mockReset().mockResolvedValue(undefined);
  h.startProxyServer.mockReset().mockImplementation(async (_url: string, port: number) => ({
    server: { close: vi.fn() },
    actualPort: port,
  }));
}

describe("AIPanelService.start", () => {
  it("provider 未初始化时抛错", async () => {
    resetMocks();
    const { service } = makeService();
    await expect(service.start(...startArgs(asMcp(makeMcp())))).rejects.toThrow(
      "Provider 未初始化",
    );
  });

  it("完整启动流程：端口回调、任务推送、事件订阅与 ready 状态", async () => {
    resetMocks();
    const { service, sse, onPortAllocated, onProxyPortAllocated } = makeService();
    const { provider, unsubscribe } = makeProvider();
    service.setProvider(asProvider(provider));
    const mcp = makeMcp();

    await service.start(...startArgs(asMcp(mcp)));

    expect(service.isStarted).toBe(true);
    expect(service.chromeMcpWarmupFailed).toBe(false);
    expect(onPortAllocated).toHaveBeenCalledWith(DEFAULT_WEB_PORT);
    expect(onProxyPortAllocated).toHaveBeenCalledWith(DEFAULT_PROXY_PORT);
    expect(provider.start).toHaveBeenCalledWith(
      expect.objectContaining({
        port: DEFAULT_WEB_PORT,
        hostname: "127.0.0.1",
        cwd: "/repo",
        eventsToken: expect.any(String),
      }),
    );
    expect(service.eventsToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(provider.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(h.waitForServer).toHaveBeenCalledTimes(1);
    expect(h.startProxyServer).toHaveBeenCalledWith(
      "http://127.0.0.1:5097",
      DEFAULT_PROXY_PORT,
      expect.objectContaining({ hostname: "127.0.0.1", bridgeScript: "<bridge-script>" }),
    );
    expect(mcp.verify).toHaveBeenCalledTimes(1);

    expect(taskUpdates(sse.writes).map((t) => t.task)).toEqual([
      "checking_provider",
      "allocating_port",
      "preparing_runtime",
      "starting_web",
      "waiting_web_ready",
      "starting_proxy",
      "warming_up_chrome",
      "creating_session",
      "ready",
    ]);
    expect(service.currentTask?.task).toBe("ready");
  });

  it("已启动且 Web 进程存在时二次 start 直接返回，不重复启动", async () => {
    resetMocks();
    const { service } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));
    const mcp = asMcp(makeMcp());

    await service.start(...startArgs(mcp));
    await service.start(...startArgs(mcp));
    expect(provider.start).toHaveBeenCalledTimes(1);
  });

  it("并发 start 复用同一 startPromise（provider.start 只调用一次）", async () => {
    resetMocks();
    const { service } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));
    const mcp = asMcp(makeMcp());

    await Promise.all([service.start(...startArgs(mcp)), service.start(...startArgs(mcp))]);
    expect(provider.start).toHaveBeenCalledTimes(1);
  });

  it("环境检查失败：推送 provider_not_installed 且不启动 provider，可重试", async () => {
    resetMocks();
    const { service, sse } = makeService();
    const { provider } = makeProvider({
      checkEnvironment: vi.fn(async () => ({ ok: false, message: "未安装" })),
    });
    service.setProvider(asProvider(provider));
    const mcp = asMcp(makeMcp());

    await service.start(...startArgs(mcp));
    expect(provider.start).not.toHaveBeenCalled();
    expect(service.isStarted).toBe(false);
    expect(last(taskUpdates(sse.writes)).task).toBe("provider_not_installed");

    // startPromise 已重置，环境恢复后可再次启动
    provider.checkEnvironment.mockResolvedValue({ ok: true });
    await service.start(...startArgs(mcp));
    expect(provider.start).toHaveBeenCalledTimes(1);
    expect(service.isStarted).toBe(true);
  });

  it("provider.start 抛错：推送 web_start_timeout、停止 provider 并允许重试", async () => {
    resetMocks();
    const { service, sse } = makeService();
    const { provider } = makeProvider({
      start: vi.fn(async () => {
        throw new Error("spawn failed");
      }),
    });
    service.setProvider(asProvider(provider));
    const mcp = asMcp(makeMcp());

    await service.start(...startArgs(mcp));
    expect(service.isStarted).toBe(false);
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(last(taskUpdates(sse.writes)).task).toBe("web_start_timeout");

    provider.start.mockResolvedValue({
      url: "http://127.0.0.1:5097",
      processHandle: { exitCode: null },
    });
    await service.start(...startArgs(mcp));
    expect(service.isStarted).toBe(true);
  });

  it("Web 进程提前退出（exitCode 非空）视为启动失败", async () => {
    resetMocks();
    const { service, sse } = makeService();
    const { provider } = makeProvider({
      start: vi.fn(async () => ({
        url: "http://127.0.0.1:5097",
        processHandle: { exitCode: 1 },
      })),
    });
    service.setProvider(asProvider(provider));

    await service.start(...startArgs(asMcp(makeMcp())));
    expect(service.isStarted).toBe(false);
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(last(taskUpdates(sse.writes)).task).toBe("web_start_timeout");
  });

  it("代理端口与 Web 端口冲突时自动避开（+1）", async () => {
    resetMocks();
    const { service, onProxyPortAllocated } = makeService(
      makeConfig({ webPort: 5097, proxyPort: 5097 }),
    );
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));

    await service.start(...startArgs(asMcp(makeMcp())));
    expect(h.startProxyServer).toHaveBeenCalledWith(
      "http://127.0.0.1:5097",
      5098,
      expect.anything(),
    );
    expect(onProxyPortAllocated).toHaveBeenCalledWith(5098);
    expect(service.actualProxyPort).toBe(5098);
  });

  it("代理端口被占用（EADDRINUSE）时回退到下一个端口", async () => {
    resetMocks();
    h.startProxyServer
      .mockRejectedValueOnce(Object.assign(new Error("in use"), { code: "EADDRINUSE" }))
      .mockImplementationOnce(async (_url: string, port: number) => ({
        server: { close: vi.fn() },
        actualPort: port,
      }));
    const { service, onProxyPortAllocated } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));

    await service.start(...startArgs(asMcp(makeMcp())));
    expect(h.startProxyServer).toHaveBeenCalledTimes(2);
    expect(h.startProxyServer.mock.calls[1][1]).toBe(DEFAULT_PROXY_PORT + 1);
    expect(service.actualProxyPort).toBe(DEFAULT_PROXY_PORT + 1);
    expect(onProxyPortAllocated).toHaveBeenLastCalledWith(DEFAULT_PROXY_PORT + 1);
    expect(service.isStarted).toBe(true);
  });

  it("代理启动其它错误：推送 proxy_start_failed 并清理 Web 进程", async () => {
    resetMocks();
    h.startProxyServer.mockRejectedValueOnce(new Error("boom"));
    const { service, sse } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));

    await service.start(...startArgs(asMcp(makeMcp())));
    expect(service.isStarted).toBe(false);
    expect(service.webProcess).toBeNull();
    expect(provider.stop).toHaveBeenCalledTimes(1);
    const failure = last(taskUpdates(sse.writes));
    expect(failure.task).toBe("proxy_start_failed");
    expect(failure.errorMessage).toBe("boom");
  });

  it("Chrome MCP 预热返回失败：记录错误型并推送 chrome_mcp_failed，仍视为已启动", async () => {
    resetMocks();
    const { service, sse } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));

    await service.start(
      ...startArgs(asMcp(makeMcp(async () => ({ ok: false, error: "no chrome" })))),
    );
    expect(service.isStarted).toBe(true);
    expect(service.chromeMcpWarmupFailed).toBe(true);
    expect(service.chromeMcpWarmupErrorType).toBe("UNKNOWN");
    expect(service.chromeMcpWarmupErrorMessage).toBe("no chrome");
    const failure = last(taskUpdates(sse.writes));
    expect(failure.task).toBe("chrome_mcp_failed");
    expect(failure.errorType).toBe("UNKNOWN");
  });

  it("Chrome MCP 预热抛错：降级记录错误信息", async () => {
    resetMocks();
    const { service } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));

    await service.start(
      ...startArgs(
        asMcp(
          makeMcp(async () => {
            throw new Error("verify exploded");
          }),
        ),
      ),
    );
    expect(service.chromeMcpWarmupFailed).toBe(true);
    expect(service.chromeMcpWarmupErrorMessage).toBe("verify exploded");
    expect(service.isStarted).toBe(true);
  });

  it("单个 SSE 客户端 write 抛错不影响启动流程", async () => {
    resetMocks();
    const broken = {
      write: vi.fn(() => {
        throw new Error("closed");
      }),
    };
    const clients = new Set([broken]) as unknown as Set<http.ServerResponse>;
    const service = new AIPanelService(makeConfig(), clients, vi.fn(), vi.fn());
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));

    await service.start(...startArgs(asMcp(makeMcp())));
    expect(service.isStarted).toBe(true);
  });
});

describe("AIPanelService.pushProviderEvent", () => {
  it("向所有 SSE 客户端广播 SESSION_EVENT 载荷", () => {
    resetMocks();
    const { service, sse } = makeService();
    const event: ProviderEvent = { type: "connected" };
    service.pushProviderEvent(event);

    expect(sse.writes).toHaveLength(1);
    expect(JSON.parse(sse.writes[0].replace(/^data: /, "").trim())).toEqual({
      type: SSE_EVENT_TYPES.SESSION_EVENT,
      event,
    });
  });
});

describe("AIPanelService.retryWarmupChromeMcp", () => {
  it("MCP 未初始化时返回 UNKNOWN", async () => {
    resetMocks();
    const { service } = makeService();
    await expect(service.retryWarmupChromeMcp()).resolves.toEqual({
      success: false,
      errorType: "UNKNOWN",
      errorMessage: "MCP not initialized",
    });
  });

  it("重试成功：清除失败标记并推送 ready", async () => {
    resetMocks();
    const { service, sse } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));
    const mcp = makeMcp(async () => ({ ok: false, error: "no chrome" }));
    await service.start(...startArgs(asMcp(mcp)));
    expect(service.chromeMcpWarmupFailed).toBe(true);

    mcp.verify.mockResolvedValueOnce({ ok: true });
    await expect(service.retryWarmupChromeMcp()).resolves.toEqual({ success: true });
    expect(service.chromeMcpWarmupFailed).toBe(false);
    expect(last(taskUpdates(sse.writes)).task).toBe("ready");
  });

  it("重试失败返回 CHROME_NOT_CONNECTED", async () => {
    resetMocks();
    const { service } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));
    const mcp = makeMcp(async () => ({ ok: false, error: "still down" }));
    await service.start(...startArgs(asMcp(mcp)));

    await expect(service.retryWarmupChromeMcp()).resolves.toEqual({
      success: false,
      errorType: "CHROME_NOT_CONNECTED",
      errorMessage: "still down",
    });
  });

  it("重试抛错返回 UNKNOWN", async () => {
    resetMocks();
    const { service } = makeService();
    const { provider } = makeProvider();
    service.setProvider(asProvider(provider));
    const mcp = makeMcp();
    await service.start(...startArgs(asMcp(mcp)));

    mcp.verify.mockRejectedValueOnce(new Error("kaboom"));
    await expect(service.retryWarmupChromeMcp()).resolves.toEqual({
      success: false,
      errorType: "UNKNOWN",
      errorMessage: "kaboom",
    });
  });
});

describe("AIPanelService.stop", () => {
  it("停止：取消订阅、清空令牌、关闭代理与 provider、重置状态，并可再次启动", async () => {
    resetMocks();
    const { service } = makeService();
    const { provider, unsubscribe } = makeProvider();
    service.setProvider(asProvider(provider));
    const mcp = asMcp(makeMcp());
    await service.start(...startArgs(mcp));

    const resolvedProxy = await h.startProxyServer.mock.results[0].value;
    const closeSpy = resolvedProxy.server.close as ReturnType<typeof vi.fn>;

    await service.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(service.eventsToken).toBeNull();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(service.isStarted).toBe(false);
    expect(service.webProcess).toBeNull();

    // startPromise 已重置：可再次完整启动
    await service.start(...startArgs(mcp));
    expect(provider.start).toHaveBeenCalledTimes(2);
    expect(service.isStarted).toBe(true);
  });

  it("未设置 provider 时 stop 也不报错", async () => {
    resetMocks();
    const { service } = makeService();
    await expect(service.stop()).resolves.toBeUndefined();
  });
});

describe("AIPanelService 任务状态载荷", () => {
  it("data 中的同名字段不会覆盖 task（task 始终以入参为准）", () => {
    resetMocks();
    const { service, sse } = makeService();
    const sender = service as unknown as {
      sendTaskUpdate(task: ServiceStartupTask, data?: Record<string, unknown>): void;
    };

    sender.sendTaskUpdate("proxy_start_failed", { task: "ready", errorMessage: "boom" });

    expect(service.currentTask).toMatchObject({
      task: "proxy_start_failed",
      errorMessage: "boom",
    });
    expect(last(taskUpdates(sse.writes))).toMatchObject({
      task: "proxy_start_failed",
      errorMessage: "boom",
    });
  });
});
