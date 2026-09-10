/**
 * @aipanel/provider-opencode 单元测试：
 * - mapEvent：Provider 私有事件 → ProviderEvent 归一化（session.updated / session.status / thinking）
 * - listSessions：过滤 warmup、subagent(parentID)、已归档会话，并归一化到 ChatSession
 * - resolveOpenCodeOptions（经 provider 构造）：providerOptions > 顶层 > 默认 优先级
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultWebProvider } from "../src/provider";
import { mapEvent } from "../src/provider";
import type { SessionInfo } from "../src/types";

/** 构造一个依赖注入齐全、api 已替换为 mock 的 provider 实例 */
function createProvider(apiMock: {
  getSessions?: unknown;
  createSession?: unknown;
  deleteSession?: unknown;
  getOrCreateSession?: unknown;
}) {
  const provider = new DefaultWebProvider(
    { hostname: "127.0.0.1", chromeDevtoolsPort: 9222 },
    { getWebPort: () => 6096, getProxyPort: () => 6097 },
    {},
  );
  const original = provider["api"] as object;
  // 替换私有依赖为 mock，沿用其方法签名
  Object.assign(original, apiMock);
  return provider;
}

const session = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: "0",
  slug: "s",
  projectID: "p1",
  directory: "/proj",
  title: "T",
  version: "1",
  summary: { additions: 0, deletions: 0, files: 0 },
  time: { created: 1, updated: 2 },
  url: "",
  ...overrides,
});

describe("opencode provider: mapEvent 事件归一化", () => {
  it("session.updated 映射为会话标题/时间更新", () => {
    const event = mapEvent({
      type: "session.updated",
      properties: {
        info: { id: "s1", title: "新标题", time: { created: 1, updated: 99 } },
      },
    });
    expect(event).toEqual({
      type: "session.updated",
      session: { id: "s1", title: "新标题", createdAt: 1, updatedAt: 99, archived: false },
    });
  });

  it("session.updated 缺 info.id 时丢弃", () => {
    expect(mapEvent({ type: "session.updated", properties: { info: {} } })).toBeNull();
  });

  it("session.status 透传运行/空闲状态", () => {
    expect(
      mapEvent({
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "running" } },
      }),
    ).toEqual({
      type: "session.status",
      sessionId: "s1",
      status: "running",
    });
    expect(
      mapEvent({ type: "session.status", properties: { sessionID: "s1", status: {} } }),
    ).toEqual({
      type: "session.status",
      sessionId: "s1",
      status: "idle",
    });
  });

  it("non-assistant 消息不产生 thinking", () => {
    expect(
      mapEvent({
        type: "message.updated",
        properties: { info: { role: "user", sessionID: "s1" } },
      }),
    ).toBeNull();
  });

  it("assistant 消息未完成列为思考中，完成则停止", () => {
    const props = (completed?: number) => ({
      properties: {
        info: {
          role: "assistant",
          sessionID: "s1",
          time: completed === undefined ? {} : { completed },
        },
      },
    });
    expect(mapEvent({ type: "message.updated", ...props(undefined) })).toEqual({
      type: "thinking",
      sessionId: "s1",
      thinking: true,
    });
    expect(mapEvent({ type: "message.updated", ...props(123) })).toEqual({
      type: "thinking",
      sessionId: "s1",
      thinking: false,
    });
  });

  it("message.part.delta 视为增量思考中", () => {
    expect(mapEvent({ type: "message.part.delta", properties: { sessionID: "s1" } })).toEqual({
      type: "thinking",
      sessionId: "s1",
      thinking: true,
    });
  });

  it("未知/非法载荷返回 null", () => {
    expect(mapEvent(null)).toBeNull();
    expect(mapEvent({ type: "session.updated", properties: { info: null } })).toBeNull();
    expect(mapEvent({ type: "bogus.type", properties: { sessionID: "s1" } })).toBeNull();
  });
});

describe("opencode provider: listSessions 过滤与归一化", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("过滤 warmup、subagent(parentID) 与已归档会话，并保留正常会话", async () => {
    const normal = session({ id: "a", title: "正常会话" });
    const warmup = session({ id: "b", title: "__chrome_mcp_warmup__" });
    const sub = session({ id: "c", parentID: "a" });
    const archived = session({ id: "d", time: { created: 1, updated: 2, archived: 5 } });

    const provider = createProvider({
      getSessions: vi.fn().mockResolvedValue([normal, warmup, sub, archived]),
    });
    const sessions = await provider.listSessions("/proj");

    expect(provider["api"].getSessions).toHaveBeenCalledWith("/proj");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "a", title: "正常会话", archived: false });
  });
});

describe("opencode provider: 选项解析优先级", () => {
  it("无配置时回到默认值（enableLsp/enablePrettier 交由 opencode 自身默认，resolve 不兜底）", () => {
    const provider = createProvider({});
    const opts = provider["opts"];
    // resolveOpenCodeOptions 仅合并显式字段，不覆盖默认常量里的 enableLsp/enablePrettier
    expect(opts.enableLsp).toBeUndefined();
    expect(opts.enablePrettier).toBeUndefined();
  });

  it("providerOptions 优先于顶层字段", () => {
    const provider = new DefaultWebProvider(
      { hostname: "127.0.0.1", chromeDevtoolsPort: 9222 },
      { getWebPort: () => 1, getProxyPort: () => 2 },
      {
        providerOptions: { enableLsp: false },
        enableLsp: true,
      },
    );
    expect(provider["opts"].enableLsp).toBe(false);
  });

  it("缺失 providerOptions 时退到顶层字段（不做 providerOptions 向下兼容）", () => {
    const provider = new DefaultWebProvider(
      { hostname: "127.0.0.1", chromeDevtoolsPort: 9222 },
      { getWebPort: () => 1, getProxyPort: () => 2 },
      { enableLsp: true, enablePrettier: false },
    );
    expect(provider["opts"].enableLsp).toBe(true);
    expect(provider["opts"].enablePrettier).toBe(false);
  });
});
