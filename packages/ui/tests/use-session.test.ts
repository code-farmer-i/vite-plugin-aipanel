/**
 * @aipanel/ui useSession（AI-panel-widget 会话列表逻辑）单元测试。
 *
 * 覆盖目标：
 *  - sessionItems 由 sessions 映射：key/id/title（缺省「新会话」）/meta/active/session；
 *  - meta 优先级：session.meta > updatedAt 相对时间（刚刚/N 分钟前/N 小时前/N 天前/>7 天回退日期）；
 *  - 非法/缺失 updatedAt 的兜底为空串；
 *  - handleCreateSession / handleSelectSession 透传；
 *  - handleDeleteSession 弹确认，仅 confirmed 才回调 onDeleteSession。
 *
 * 策略：该 composable 无生命周期钩子，直接调用；相对时间以当前时间为基准构造时间戳，
 * 规避对固定系统时间的依赖。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { AIPanelWidgetSession, AIPanelWidgetSessionItem } from "@aipanel/core";
import { useSession, type UseSessionOptions } from "../src/AI-panel-widget/composables/use-session";

type Options = Parameters<typeof useSession>[0];

function setup(overrides: Partial<Options> = {}) {
  const sessions = ref<AIPanelWidgetSession[]>([]);
  const currentSessionId = ref<string | number | null>(null);
  const onCreateSession = vi.fn();
  const onSelectSession = vi.fn();
  const onDeleteSession = vi.fn();
  const showConfirmDialog = vi.fn(async () => true);
  const opts: UseSessionOptions = {
    sessions,
    currentSessionId,
    onCreateSession,
    onSelectSession,
    onDeleteSession,
    showConfirmDialog,
    ...overrides,
  };
  const api = useSession(opts);
  return {
    api,
    sessions,
    currentSessionId,
    onCreateSession,
    onSelectSession,
    onDeleteSession,
    showConfirmDialog,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSession", () => {
  it("sessionItems 映射 key/id/title/active，并保留原始 session", () => {
    const s = setup();
    const session: AIPanelWidgetSession = { id: "s1", title: "标题一", meta: "3 分钟前" };
    s.sessions.value = [session, { id: "s2" }];
    s.currentSessionId.value = "s2";

    const items = s.api.sessionItems.value;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      key: "s1",
      id: "s1",
      title: "标题一",
      meta: "3 分钟前",
      active: false,
    });
    expect(items[0].session).toStrictEqual(session);
    // 无 title 时兜底「新会话」，active 命中当前会话
    expect(items[1]).toMatchObject({ title: "新会话", active: true });
  });

  it("meta 缺省时按 updatedAt 生成相对时间标签", () => {
    const s = setup();
    const now = Date.now();
    s.sessions.value = [
      { id: "a", updatedAt: now - 10_000 },
      { id: "b", updatedAt: now - 2 * MINUTE },
      { id: "c", updatedAt: now - 3 * HOUR },
      { id: "d", updatedAt: now - 2 * DAY },
    ];

    expect(s.api.sessionItems.value.map((item) => item.meta)).toEqual([
      "刚刚",
      "2 分钟前",
      "3 小时前",
      "2 天前",
    ]);
  });

  it("updatedAt 为未来时间或 Date 实例时正确处理", () => {
    const s = setup();
    s.sessions.value = [
      { id: "future", updatedAt: Date.now() + 60_000 },
      { id: "date", updatedAt: new Date(Date.now() - 4 * HOUR) },
    ];

    expect(s.api.sessionItems.value.map((item) => item.meta)).toEqual(["刚刚", "4 小时前"]);
  });

  it("超过 7 天回退为本地日期时间字符串；非法/缺失 updatedAt 兜底空串", () => {
    const s = setup();
    s.sessions.value = [
      { id: "old", updatedAt: Date.now() - 8 * DAY },
      { id: "bad", updatedAt: "not-a-date" },
      { id: "none" },
    ];

    const items = s.api.sessionItems.value;
    expect(items[0].meta).not.toContain("天前");
    expect(items[0].meta.length).toBeGreaterThan(0);
    expect(items[1].meta).toBe("");
    expect(items[2].meta).toBe("");
  });

  it("session.meta 优先于 updatedAt", () => {
    const s = setup();
    s.sessions.value = [{ id: "a", meta: "自定义", updatedAt: Date.now() - 2 * DAY }];
    expect(s.api.sessionItems.value[0].meta).toBe("自定义");
  });

  it("sessions 为 undefined 时映射为空数组，不抛错", () => {
    // sessions 类型上非可选，此处模拟运行时为 undefined 的容错分支
    const s = setup({ sessions: ref(undefined as unknown as AIPanelWidgetSession[]) });
    expect(s.api.sessionItems.value).toEqual([]);
  });

  it("handleCreateSession 回调 onCreateSession", () => {
    const s = setup();
    s.api.handleCreateSession();
    expect(s.onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("handleSelectSession 透传 item.session", () => {
    const s = setup();
    const session: AIPanelWidgetSession = { id: "s1", title: "t" };
    s.sessions.value = [session];
    const item = s.api.sessionItems.value[0];

    s.api.handleSelectSession(item);
    expect(s.onSelectSession).toHaveBeenCalledWith(session);
  });

  it("handleDeleteSession 弹确认并透传 item.session（仅 confirmed）", async () => {
    const s = setup();
    const session: AIPanelWidgetSession = { id: "s1", title: "待删除" };
    s.sessions.value = [session];
    const item: AIPanelWidgetSessionItem = s.api.sessionItems.value[0];

    s.showConfirmDialog.mockResolvedValueOnce(false);
    await s.api.handleDeleteSession(item);
    expect(s.showConfirmDialog).toHaveBeenCalledWith('确定要删除会话 "待删除" 吗？');
    expect(s.onDeleteSession).not.toHaveBeenCalled();

    s.showConfirmDialog.mockResolvedValueOnce(true);
    await s.api.handleDeleteSession(item);
    expect(s.onDeleteSession).toHaveBeenCalledWith(session);
  });
});
