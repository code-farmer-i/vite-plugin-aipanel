/**
 * DeepSeekAPI.listSessions 会话列表过滤单测。
 *
 * 过滤为纯内存语义（workspace/follow baseline + session/list 快照 → 合并过滤），
 * 这里把两个 RPC 面 mock 成内存快照，验证与 dsh UI（sessionVisible）对齐的可见性规则：
 *   - 排除 origin=subagent / 全局归档 / blank 非当前选中会话
 *   - 归属以匹配工作区 sessionIds 为准（官方按工作区分组）
 *   - 回归：0.1.3 起磁盘残留大量未挂载工作区的历史/blank 会话，
 *     cwd 兜底仅在匹配不到该目录工作区时启用，不得把游离会话并入项目列表
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekAPI } from "../src/api";
import type { SessionSummary, SessionListResult, WorkspaceListResult, WorkspaceView } from "../src/types";

/** 暴露 listSessions 与两个被 mock 的私有 RPC 面（白盒，仅测试用） */
type ApiSurface = {
  listSessions(projectDir: string, activeSessionId?: string, retries?: number): Promise<SessionSummary[]>;
  fetchWorkspaceBaseline: () => Promise<WorkspaceListResult>;
  call: <T>(method: string, args?: Record<string, unknown>) => Promise<T>;
};

const PROJ = "/work/proj";
const OTHER = "/work/other";

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { sessionId: id, updatedAt: 0, running: false, blank: false, ...overrides };
}

function workspaceView(overrides: Partial<WorkspaceView> & { path: string; sessionIds: string[] }): WorkspaceView {
  return {
    workspaceId: `ws:${overrides.path}`,
    title: "proj",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 实例化 API 并把 workspace/follow baseline 与 session/list 换成内存快照 */
function makeApi(workspaces: WorkspaceListResult, all: SessionSummary[]): ApiSurface {
  const api = new DeepSeekAPI("127.0.0.1", () => 6097) as unknown as ApiSurface;
  vi.spyOn(api, "fetchWorkspaceBaseline").mockResolvedValue(workspaces);
  vi.spyOn(api, "call").mockResolvedValue({ items: all } satisfies SessionListResult);
  return api;
}

const ids = (sessions: SessionSummary[]): string[] => sessions.map((s) => s.sessionId);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeepSeekAPI.listSessions 可见性过滤", () => {
  it("匹配到工作区时只保留其 sessionIds 内的可见会话，不再并入磁盘游离会话（回归）", async () => {
    const OWNED = "session-owned";
    const OWNED_BLANK = "session-owned-blank";
    const OWNED_ARCHIVED = "session-owned-archived";
    const api = makeApi(
      {
        items: [
          workspaceView({ path: PROJ, sessionIds: [OWNED, OWNED_BLANK, OWNED_ARCHIVED] }),
          workspaceView({ path: OTHER, sessionIds: ["session-other-ws"] }),
        ],
        archivedSessionIds: [OWNED_ARCHIVED, "session-detached-archived"],
      },
      [
        session(OWNED, { cwd: PROJ, updatedAt: 10 }),
        session(OWNED_BLANK, { cwd: PROJ, updatedAt: 8, blank: true }),
        session(OWNED_ARCHIVED, { cwd: PROJ, updatedAt: 9 }),
        // 磁盘游离残留：未挂载任何工作区、仅 cwd 指向本目录。
        // blank=false 模拟 0.1.3 冷会话投影未命中时 blank 字段失真（真实回归形态）。
        session("session-detached-blank-wire", { cwd: PROJ, updatedAt: 7, blank: false }),
        session("session-detached-real", { cwd: PROJ, updatedAt: 6, blank: false }),
        session("session-detached-archived", { cwd: PROJ, updatedAt: 5 }),
        session("session-detached-subagent", { cwd: PROJ, updatedAt: 4, origin: "subagent" }),
        // 其它工作区（路径不匹配）的会话
        session("session-other-ws", { cwd: OTHER, updatedAt: 3 }),
      ],
    );

    // blank 当前选中会话（对应 UI 的 New Session 占位行）应展示
    const result = await api.listSessions(PROJ, OWNED_BLANK, 1);
    expect(ids(result)).toEqual([OWNED, OWNED_BLANK]);
  });

  it("归档优先级高于当前选中：activeSessionId 指向归档会话时仍被排除", async () => {
    const OWNED = "session-owned";
    const OWNED_ARCHIVED = "session-owned-archived";
    const api = makeApi(
      {
        items: [workspaceView({ path: PROJ, sessionIds: [OWNED, OWNED_ARCHIVED] })],
        archivedSessionIds: [OWNED_ARCHIVED],
      },
      [
        session(OWNED, { cwd: PROJ, updatedAt: 2 }),
        session(OWNED_ARCHIVED, { cwd: PROJ, updatedAt: 1 }),
      ],
    );

    const result = await api.listSessions(PROJ, OWNED_ARCHIVED, 1);
    expect(ids(result)).toEqual([OWNED]);
  });

  it("匹配不到该目录工作区（全新目录）时 cwd 兜底启用，但仍遵守 subagent/归档/blank 规则", async () => {
    const FRESH = "/work/fresh";
    const ACTIVE_BLANK = "session-fresh-active-blank";
    const api = makeApi(
      { items: [], archivedSessionIds: ["session-fresh-archived"] },
      [
        session("session-fresh-1", { cwd: FRESH, updatedAt: 12 }),
        session(ACTIVE_BLANK, { cwd: FRESH, updatedAt: 11, blank: true }),
        session("session-fresh-blank", { cwd: FRESH, updatedAt: 10, blank: true }),
        session("session-fresh-archived", { cwd: FRESH, updatedAt: 9 }),
        session("session-fresh-subagent", { cwd: FRESH, updatedAt: 8, origin: "subagent" }),
        session("session-fresh-other-cwd", { cwd: OTHER, updatedAt: 7 }),
        // 兜底路径依赖 wire 的 blank 字段：冷会话投影未命中时 blank=false，失真残留会一并带入，
        // 这是“仅当工作区匹配失败”的 best-effort 限制（正常路径工作区匹配成功即不会触发）。
        session("session-fresh-detached-blank-wire", { cwd: FRESH, updatedAt: 6, blank: false }),
      ],
    );

    const result = await api.listSessions(FRESH, ACTIVE_BLANK, 1);
    expect(ids(result)).toEqual(["session-fresh-1", ACTIVE_BLANK, "session-fresh-detached-blank-wire"]);
  });

  it("同一目录匹配到工作区时的归属与排序：updatedAt 降序", async () => {
    const OWNED = "session-owned";
    const api = makeApi(
      {
        items: [workspaceView({ path: PROJ, sessionIds: [OWNED] })],
        archivedSessionIds: [],
      },
      [
        session("session-detached-newer", { cwd: PROJ, updatedAt: 100 }),
        session(OWNED, { cwd: PROJ, updatedAt: 1 }),
      ],
    );

    // 游离会话即使 updatedAt 更大也不得越权出现在匹配到工作区的项目列表里
    const result = await api.listSessions(PROJ, undefined, 1);
    expect(ids(result)).toEqual([OWNED]);
  });
});
