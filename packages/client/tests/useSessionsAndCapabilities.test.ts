/**
 * useSessionsAndCapabilities 单元测试
 * 覆盖：loadSessions 的会话/能力解析（deepLink/reviewPanel 校正）、空列表自动建会话、
 * fetch 失败兜底、selectSession / createSession / deleteSession、updateSessionInfo 更新、
 * iframeSrc 与当前会话联动。fetch 用可编排的 stateful stub。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { SESSIONS_API_PATH } from "@aipanel/core";
import type { ChatSession, ProviderCapabilities } from "@aipanel/core";
import { useSessionsAndCapabilities } from "../src/composables/useSessionsAndCapabilities";

const fetchMock = vi.fn();

interface FetchState {
  sessions: ChatSession[];
  caps: ProviderCapabilities | undefined;
}

function jsonReply(data: unknown) {
  return { json: async () => data } as Response;
}

function session(partial: Partial<ChatSession>): ChatSession {
  return { id: "s1", title: "会话一", createdAt: 1, updatedAt: 1, url: "/chat/s1", ...partial };
}

function installFetch(initial: ChatSession[], caps?: ProviderCapabilities): FetchState {
  const state: FetchState = { sessions: [...initial], caps };
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init && init.method ? init.method : "GET";
    if (method === "POST") {
      const created: ChatSession = {
        id: "created-1",
        title: "新建会话",
        createdAt: 9,
        updatedAt: 9,
        url: "/chat/created-1",
      };
      state.sessions = [created, ...state.sessions];
      return jsonReply(created);
    }
    if (method === "DELETE") {
      const id = new URL(url, "http://a/").searchParams.get("id");
      state.sessions = state.sessions.filter((s) => s.id !== id);
      return jsonReply({});
    }
    return jsonReply({ sessions: state.sessions, capabilities: state.caps });
  });
  return state;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSessionsAndCapabilities", () => {
  it("初始状态默认值", () => {
    const api = useSessionsAndCapabilities({ showNotification: vi.fn() });
    expect(api.sessions.value).toEqual([]);
    expect(api.loadingSessionList.value).toBeUndefined();
    expect(api.currentSessionId.value).toBeNull();
    expect(api.deepLink.value).toBe(true);
    expect(api.reviewPanelEnabled.value).toBe(false);
    expect(api.providerSidebar.value).toBe(false);
    expect(api.sidebarCollapseControl.value).toBe("host");
    expect(api.iframeLoading.value).toBe(true);
    expect(api.iframeSrc.value).toBe("");
  });

  it("loadSessions 解析会话并校正 deepLink=false / reviewPanel=true", async () => {
    installFetch([session({ id: "s1", url: "/shell" }), session({ id: "s2", url: "/shell" })], {
      deepLink: false,
      reviewPanel: true,
    });
    const onFocusSession = vi.fn();
    const api = useSessionsAndCapabilities({ showNotification: vi.fn(), onFocusSession });
    await api.loadSessions();

    expect(fetchMock).toHaveBeenCalledWith(SESSIONS_API_PATH);
    expect(api.sessions.value).toHaveLength(2);
    expect(api.currentSessionId.value).toBe("s1");
    expect(api.deepLink.value).toBe(false);
    expect(api.reviewPanelEnabled.value).toBe(true);
    expect(api.loadingSessionList.value).toBe(false);
    // 无深链：iframe 保持应用壳 URL，聚焦通过回调完成
    expect(api.iframeSrc.value).toBe("/shell");
    expect(onFocusSession).toHaveBeenCalledWith("s1");
  });

  it("loadSessions 解析 sidebar takeover（provider 控制折叠）", async () => {
    installFetch([session({ id: "s1", url: "/shell" })], {
      sidebar: { takeover: true, collapseControl: "provider" },
    });
    const api = useSessionsAndCapabilities({ showNotification: vi.fn() });
    await api.loadSessions();
    expect(api.providerSidebar.value).toBe(true);
    expect(api.sidebarCollapseControl.value).toBe("provider");
  });

  it("sidebar.takeover=true 且 collapseControl 缺省时折叠开关归 host", async () => {
    installFetch([session({ id: "s1", url: "/shell" })], { sidebar: { takeover: true } });
    const api = useSessionsAndCapabilities({ showNotification: vi.fn() });
    await api.loadSessions();
    expect(api.providerSidebar.value).toBe(true);
    expect(api.sidebarCollapseControl.value).toBe("host");
  });

  it("capabilities 缺省时 deepLink=true / reviewPanel=false", async () => {
    installFetch([session({ id: "s1", url: "/chat/s1" })]);
    const onFocusSession = vi.fn();
    const api = useSessionsAndCapabilities({ showNotification: vi.fn(), onFocusSession });
    await api.loadSessions();
    expect(api.deepLink.value).toBe(true);
    expect(api.reviewPanelEnabled.value).toBe(false);
    expect(api.providerSidebar.value).toBe(false);
    expect(api.sidebarCollapseControl.value).toBe("host");
    expect(api.iframeSrc.value).toBe("/chat/s1");
    expect(onFocusSession).not.toHaveBeenCalled();
  });

  it("空会话列表自动 POST 创建会话", async () => {
    installFetch([]);
    const api = useSessionsAndCapabilities({ showNotification: vi.fn() });
    await api.loadSessions();
    await flushPromises();
    expect(api.sessions.value).toHaveLength(1);
    expect(api.sessions.value[0].id).toBe("created-1");
    expect(api.currentSessionId.value).toBe("created-1");
    const posts = fetchMock.mock.calls.filter((call) => {
      const init = call[1] as RequestInit | undefined;
      return init && init.method === "POST";
    });
    expect(posts).toHaveLength(1);
  });

  it("fetch 失败时兜底：清空加载态、不建会话、不弹通知", async () => {
    // loadSessions 失败路径会 log.error，这里静音 console.error
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("network down"));
    const showNotification = vi.fn();
    const api = useSessionsAndCapabilities({ showNotification });
    await api.loadSessions();
    expect(api.loadingSessionList.value).toBe(false);
    expect(api.sessions.value).toEqual([]);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("selectSession 切换当前会话并联动 iframeSrc", async () => {
    installFetch([session({ id: "s1", url: "/chat/s1" }), session({ id: "s2", url: "/chat/s2" })], {
      deepLink: true,
      reviewPanel: false,
    });
    const api = useSessionsAndCapabilities({ showNotification: vi.fn() });
    await api.loadSessions();
    await api.selectSession(api.sessions.value[1]);
    expect(api.currentSessionId.value).toBe("s2");
    expect(api.iframeLoading.value).toBe(true);
    expect(api.iframeSrc.value).toBe("/chat/s2");
  });

  it("无深链下 selectSession 通过 onFocusSession 聚焦", async () => {
    installFetch([session({ id: "s1", url: "/shell" }), session({ id: "s2", url: "/shell" })], {
      deepLink: false,
    });
    const onFocusSession = vi.fn();
    const api = useSessionsAndCapabilities({ showNotification: vi.fn(), onFocusSession });
    await api.loadSessions();
    await api.selectSession(api.sessions.value[1]);
    expect(api.currentSessionId.value).toBe("s2");
    expect(onFocusSession).toHaveBeenLastCalledWith("s2");
  });

  it("deleteSession 删除并重载会话列表，弹通知", async () => {
    installFetch([session({ id: "s1" }), session({ id: "s2" })]);
    const showNotification = vi.fn();
    const api = useSessionsAndCapabilities({ showNotification });
    await api.loadSessions();
    await api.deleteSession(api.sessions.value[1]); // 删除非当前会话 s2
    expect(showNotification).toHaveBeenCalledWith("会话已删除");
    expect(api.sessions.value.map((s) => s.id)).toEqual(["s1"]);
    expect(api.currentSessionId.value).toBe("s1");
  });

  it("删除当前会话后切换到列表首项", async () => {
    installFetch([session({ id: "s1" }), session({ id: "s2" })]);
    const api = useSessionsAndCapabilities({ showNotification: vi.fn() });
    await api.loadSessions();
    await api.deleteSession(api.sessions.value[0]); // 删除当前会话 s1
    expect(api.sessions.value.map((s) => s.id)).toEqual(["s2"]);
    expect(api.currentSessionId.value).toBe("s2");
  });

  it("deleteSession 失败弹失败通知", async () => {
    installFetch([session({ id: "s1" })]);
    const showNotification = vi.fn();
    const api = useSessionsAndCapabilities({ showNotification });
    await api.loadSessions();
    // 下一次 DELETE 请求失败
    fetchMock.mockRejectedValueOnce(new Error("delete boom"));
    await api.deleteSession(api.sessions.value[0]);
    expect(showNotification).toHaveBeenCalledWith("删除会话失败");
  });

  it("createSession 前置新会话并设为当前会话", async () => {
    installFetch([session({ id: "s1" })]);
    const showNotification = vi.fn();
    const api = useSessionsAndCapabilities({ showNotification });
    await api.loadSessions();
    await api.createSession();
    await flushPromises();
    expect(showNotification).not.toHaveBeenCalled();
    expect(api.sessions.value[0].id).toBe("created-1");
    expect(api.currentSessionId.value).toBe("created-1");
  });

  it("updateSessionInfo 更新标题与时间；未知/空标题忽略", async () => {
    installFetch([session({ id: "s1", title: "旧标题", updatedAt: 1 })]);
    const api = useSessionsAndCapabilities({ showNotification: vi.fn() });
    await api.loadSessions();

    api.updateSessionInfo({ id: "s1", title: "新标题", time: { updated: 1234 } });
    expect(api.sessions.value[0].title).toBe("新标题");
    expect(api.sessions.value[0].updatedAt).toBe(1234);

    api.updateSessionInfo({ id: "missing", title: "不存在的会话" });
    expect(api.sessions.value).toHaveLength(1);
    api.updateSessionInfo({ id: "s1" });
    expect(api.sessions.value[0].title).toBe("新标题");
  });
});
