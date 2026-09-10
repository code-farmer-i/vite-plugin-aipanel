/**
 * dsh-plugin 宿主事件中继（setupEventRelay）单元测试。
 *
 * 历史回归：setupEventRelay 曾漏传 viteHost，中继内部回退到 127.0.0.1，
 * 导致跨网络/自定义 host 下 running/标题事件整体推丢。此处锁住三点：
 *   - viteHost 作为单一来源：缺失即报错并停用中继，不做 127.0.0.1 向下兼容；
 *   - 事件回推 URL 必须用传入的 viteHost（不再是默认 loopback）；
 *   - token/端口不满足时空操作（不注册监听、不推送）。
 *
 * 监听经 mock ctx.on 捕获调用注册的 handler；推送目标用 mock global fetch 捕获。
 * 标题事件走直接 post，运行状态走 flush 定时器（120ms），后者用真实等待越过窗口。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { HOST_EVENTS_API_PATH } from "@aipanel/core/node";
import { setupEventRelay } from "../dsh-plugin/src/events-relay";

/** flush 窗口实际值（events-relay 常量），越窗用 */
const FLUSH_MS = 120;

/** ctx 真实类型（@deepseek-ai/cordis Context），由 setupEventRelay 参数推导，避免引入外部依赖 */
type RelayCtx = Parameters<typeof setupEventRelay>[0];

/** 轻量 ctx mock：只捕获 (name, handler) 注册的监听 */
function createCtx() {
  const registrations = new Map<string, (...args: unknown[]) => void>();
  const ctx = {
    on: (name: string, handler: (...args: unknown[]) => void) => {
      registrations.set(name, handler);
    },
  };
  return { ctx: ctx as unknown as RelayCtx, registrations };
}

/** 让事件链路尽量落到断言点：post 是 async promise 链，给一个宏任务让 microtask 排干 */
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("dsh-plugin host event relay (setupEventRelay)", () => {
  it("viteHost 缺失时报错并停用中继（不注册任何监听，不做 127.0.0.1 向下兼容）", async () => {
    const { ctx, registrations } = createCtx();
    setupEventRelay(ctx, { vitePort: 5173, eventsToken: "tok" });
    expect(registrations.size).toBe(0);
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("eventsToken 缺失时为空操作", () => {
    const { ctx, registrations } = createCtx();
    setupEventRelay(ctx, { vitePort: 5173, viteHost: "127.0.0.1" });
    expect(registrations.size).toBe(0);
  });

  it("vitePort 无效（<=0）时为空操作", () => {
    const { ctx, registrations } = createCtx();
    setupEventRelay(ctx, { vitePort: 0, viteHost: "127.0.0.1", eventsToken: "tok" });
    expect(registrations.size).toBe(0);
  });

  it("session/title 事件用传入 viteHost 回推 session.updated", async () => {
    const { ctx, registrations } = createCtx();
    const viteHost = "192.168.1.50";
    setupEventRelay(ctx, {
      vitePort: 5173,
      viteHost,
      eventsPath: HOST_EVENTS_API_PATH,
      eventsToken: "tok",
    });

    const onSessionEvent = registrations.get("session/event")!;
    onSessionEvent({ id: "s1" }, { type: "session/title", data: { title: "你好" }, time: 123 });
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    // 单一来源：URL 用传入的 viteHost，而非默认 127.0.0.1
    expect(url).toBe(`http://${viteHost}:5173${HOST_EVENTS_API_PATH}`);
    const body = JSON.parse(init.body);
    expect(body.token).toBe("tok");
    expect(body.event).toMatchObject({
      type: "session.updated",
      session: { id: "s1", title: "你好", updatedAt: 123 },
    });
  });

  it("同名标题去重：同一标题只推送一次", async () => {
    const { ctx, registrations } = createCtx();
    setupEventRelay(ctx, {
      vitePort: 5173,
      viteHost: "10.0.0.8",
      eventsPath: HOST_EVENTS_API_PATH,
      eventsToken: "tok",
    });
    const onSessionEvent = registrations.get("session/event")!;
    const emit = (title: string) =>
      onSessionEvent({ id: "s1" }, { type: "session/title", data: { title }, time: 123 });

    emit("首次");
    emit("首次"); // 同内容不重复外发
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("agent/status running 经 flush 后回推 session.status 到同一 viteHost 地址", async () => {
    vi.useFakeTimers();
    const { ctx, registrations } = createCtx();
    const viteHost = "172.16.3.9";
    setupEventRelay(ctx, {
      vitePort: 8080,
      viteHost,
      eventsPath: HOST_EVENTS_API_PATH,
      eventsToken: "tok",
    });

    const onAgentStatus = registrations.get("agent/status")!;
    onAgentStatus({ agent: { session: { id: "s1" } }, status: "running" });
    await vi.advanceTimersByTimeAsync(FLUSH_MS + 100);

    // 首次 flush 会把四种状态一次性全量外发（status/thinking/pending/subagents）
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const pushed = fetchMock.mock.calls.map(([url, init]) => ({
      url: url as string,
      body: JSON.parse((init as { body: string }).body) as {
        event: Record<string, unknown>;
      },
    }));
    // 单一来源：每一次回推都指向传入的 viteHost，而非默认 127.0.0.1
    for (const { url } of pushed) {
      expect(url).toBe(`http://${viteHost}:8080${HOST_EVENTS_API_PATH}`);
    }
    // 其中一条是 running 状态的权威变化
    expect(pushed).toContainEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          event: expect.objectContaining({
            type: "session.status",
            sessionId: "s1",
            status: "running",
          }),
        }),
      }),
    );
  });
});
