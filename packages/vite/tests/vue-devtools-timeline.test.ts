/**
 * client/vue-devtools-timeline.ts（页面侧时间线采集器）vitest 单元测试。
 *
 * 覆盖目标：原始 devtools hook 事件 → 配对/计数/记录；生命周期只计数不产记录；
 * mark/clear/sinceMark 窗口语义；layers/include/minDurationMs/component/limit 过滤；
 * 容量溢出丢弃；router 订阅与导航摘要；组件树 file 补全；回调抛错被吞掉不影响页面。
 *
 * stub 策略：自建 FakeHook（on/emit）替代 __VUE_DEVTOOLS_GLOBAL_HOOK__，注入可控时钟，
 * 不接触真实 devtools-kit 运行时状态。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import {
  DEVTOOLS_HOOK_EVENTS,
  createTimelineRecorder,
  type TimelineHook,
  type TimelineRecorderOptions,
  type TimelineRouterLike,
} from "../src/client/vue-devtools-timeline";

interface FakeHook {
  hook: TimelineHook;
  emit: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
}

function createFakeHook(): FakeHook {
  const listeners = new Map<string, Array<(...args: never[]) => void>>();
  return {
    hook: {
      on(event, listener) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return () => {
          const current = listeners.get(event) ?? [];
          const index = current.indexOf(listener);
          if (index >= 0) current.splice(index, 1);
        };
      },
    },
    emit(event, ...args) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        (listener as unknown as (...rest: unknown[]) => void)(...args);
      }
    },
    listenerCount: (event) => (listeners.get(event) ?? []).length,
  };
}

const RAW_APP = { _instance: { uid: 2 } };

function setup(options: Omit<TimelineRecorderOptions, "hook"> = {}) {
  const fake = createFakeHook();
  // 时钟与测试里的事件时间（1000ms 附近）保持同一量级，避免落出默认 5s 窗口
  let clock = 1000;
  const recorder = createTimelineRecorder({
    hook: fake.hook,
    now: () => clock,
    getAppRecords: () => [{ id: "app-1", app: RAW_APP }],
    ...options,
  });
  return {
    ...fake,
    recorder,
    advance: (ms: number) => {
      clock += ms;
    },
    setClock: (value: number) => {
      clock = value;
    },
  };
}

/** 触发一次组件渲染（start + end），返回结束时间 */
function render(
  emit: FakeHook["emit"],
  uid: number,
  name: string,
  type: string,
  start: number,
  duration: number,
): void {
  emit(DEVTOOLS_HOOK_EVENTS.performanceStart, RAW_APP, uid, { type: { name } }, type, start);
  emit(DEVTOOLS_HOOK_EVENTS.performanceEnd, RAW_APP, uid, { type: { name } }, type, start + duration);
}

describe("createTimelineRecorder — 采集与配对", () => {
  it("start/end 配对成一条 perf 记录，根组件 nodeId 用 appId:root", async () => {
    const { emit, recorder, setClock } = setup();
    render(emit, 2, "App", "render", 1000, 3.25);
    setClock(1100);

    const result = await recorder.get({ minDurationMs: 0 });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      layer: "perf",
      kind: "render",
      name: "App",
      nodeId: "app-1:root",
      dur: 3.25,
      t: -96.75,
    });
    expect(result.summary.perf).toMatchObject({ operations: 1, totalMs: 3.25 });
  });

  it("子组件 nodeId 为 appId:uid；低于 minDurationMs 的渲染不进明细但计入摘要", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "Card", "render", 1000, 2.5);

    const slow = await recorder.get({ minDurationMs: 4 });
    expect(slow.records).toHaveLength(0);
    expect((slow.summary.perf as any).operations).toBe(1);
    expect((slow.summary.perf as any).byComponent[0]).toMatchObject({ name: "Card", count: 1 });

    const all = await recorder.get({ minDurationMs: 0 });
    expect(all.records[0]).toMatchObject({ nodeId: "app-1:13", dur: 2.5 });
  });

  it("只有 end 没有 start 的事件计入 unpaired，不产生记录", async () => {
    const { emit, recorder } = setup();
    emit(DEVTOOLS_HOOK_EVENTS.performanceEnd, RAW_APP, 13, { type: { name: "Card" } }, "render", 1000);

    const result = await recorder.get({ minDurationMs: 0 });

    expect(result.records).toHaveLength(0);
    expect(result.buffer.unpaired).toBe(1);
  });

  it("组件数超过逐组件表上限时，累计总数仍精确且标明逐组件表不完整", async () => {
    const { emit, recorder } = setup();

    for (let index = 0; index < 250; index += 1) {
      emit(DEVTOOLS_HOOK_EVENTS.componentUpdated, RAW_APP, index + 100, 2, { type: { name: `C${index}` } });
    }

    const result = await recorder.get({});
    // 250 个组件全部计入总数（表容量 200 只影响 byComponent）
    expect(result.summary.lifecycle).toMatchObject({
      updated: 250,
      trackedComponents: 200,
      componentEvictions: 50,
    });
  });

  it("componentEvictions 是淘汰次数（组件反复活跃会重复淘汰），不是不同组件数", async () => {
    const { emit, recorder } = setup();

    // 201 个组件轮转：总共只出现 201 个，但会反复把别人挤出表
    for (let round = 0; round < 5; round += 1) {
      for (let index = 0; index < 201; index += 1) {
        emit(DEVTOOLS_HOOK_EVENTS.componentUpdated, RAW_APP, index + 100, 2, { type: { name: `C${index}` } });
      }
    }

    const lifecycle = (await recorder.get({})).summary.lifecycle as any;
    expect(lifecycle.updated).toBe(1005);
    expect(lifecycle.trackedComponents).toBe(200);
    // 远超"不同组件数（201）"：字段语义就是淘汰次数
    expect(lifecycle.componentEvictions).toBeGreaterThan(201);
  });

  it("now() 抛错时采集器构造与查询都不抛错（桥初始化不能被带崩）", async () => {
    const { hook } = createFakeHook();
    const fixed = createTimelineRecorder({
      hook,
      now: () => {
        throw new Error("no performance");
      },
    });
    expect(fixed).toBeDefined();
    expect(() => fixed.mark("x")).not.toThrow();

    const result = await fixed.get({ windowMs: 1000 });
    expect(Number.isFinite(result.window.ms)).toBe(true);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("路由失败原因与 emit 参数走同一套裁剪（不可序列化的值不会污染结果）", async () => {
    let navigate: ((to: unknown, from: unknown, failure?: unknown) => void) | undefined;
    const router: TimelineRouterLike = {
      afterEach: (handler) => {
        navigate = handler;
        return () => {};
      },
    };
    const { emit, recorder } = setup({ resolveRouter: () => router });
    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);

    // bigint / 超长字符串的 failure message
    navigate?.({ fullPath: "/blocked" }, { fullPath: "/from" }, { message: 123456789012345678901234567890n });
    navigate?.({ fullPath: "/aborted" }, { fullPath: "/from" }, { message: "x".repeat(400) });

    const result = await recorder.get({ minDurationMs: 0 });

    expect(() => JSON.stringify(result)).not.toThrow();
    const failures = result.records.map((record) => (record.data as { failure?: unknown })?.failure);
    expect(failures[0]).toBe("123456789012345678901234567890n");
    expect(String(failures[1])).toContain("(400 chars)");
  });

  it("mark 的非字符串 label 被规整为字符串（否则整份结果不可序列化）", async () => {
    const { recorder } = setup();
    const { markId } = recorder.mark({ evil: 1n } as unknown as string);

    const result = await recorder.get({ minDurationMs: 0 });
    expect(markId).toBe("m1");
    expect(result.records[0]).toMatchObject({ layer: "agent", name: "mark" });
    expect(result.summary.agent).toMatchObject([{ label: "mark" }]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("两个 app 共用同一个 router 时，卸载一个不会拆掉另一个的订阅", async () => {
    const off = vi.fn();
    const router: TimelineRouterLike = { afterEach: vi.fn(() => off) };
    const otherApp = { _instance: { uid: 9 } };
    const { emit, recorder } = setup({ resolveRouter: () => router });

    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    emit(DEVTOOLS_HOOK_EVENTS.appInit, otherApp);
    // 共用一个 router：只订阅一次，但两个 app 各记一份
    expect(router.afterEach).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(2);

    emit(DEVTOOLS_HOOK_EVENTS.appUnmount, RAW_APP);
    expect(off).not.toHaveBeenCalled();
    expect((await recorder.get({})).buffer.capture.routers).toBe(1);

    emit(DEVTOOLS_HOOK_EVENTS.appUnmount, otherApp);
    expect(off).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(0);
  });

  it("同一个 app 第二次 app:init 换了 router：退掉旧的、订阅新的", async () => {
    const offA = vi.fn();
    const offB = vi.fn();
    const routerA: TimelineRouterLike = { afterEach: vi.fn(() => offA) };
    const routerB: TimelineRouterLike = { afterEach: vi.fn(() => offB) };
    let current = routerA;
    const { emit, recorder } = setup({ resolveRouter: () => current });

    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    expect(routerA.afterEach).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(1);

    // 同一个 app 换了 router（开发期重建）：旧订阅必须释放，新订阅必须生效
    current = routerB;
    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    expect(offA).toHaveBeenCalledTimes(1);
    expect(routerB.afterEach).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(1);
  });

  it("dispose 之后不再收到 hook 事件（也不会重复订阅）：恢复录制应新建采集器", async () => {
    const router: TimelineRouterLike = { afterEach: vi.fn(() => () => {}) };
    const { emit, recorder } = setup({ resolveRouter: () => router });

    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    expect(router.afterEach).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(1);

    recorder.dispose();
    expect((await recorder.get({})).buffer.capture.routers).toBe(0);

    // dispose 已退订所有 hook：再 emit 不应重新订阅，也不抛错
    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    emit(DEVTOOLS_HOOK_EVENTS.appUnmount, RAW_APP);
    expect(router.afterEach).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(0);
  });

  it("生命周期事件只累计计数、不产生明细记录", async () => {
    const { emit, recorder } = setup();
    emit(DEVTOOLS_HOOK_EVENTS.componentAdded, RAW_APP, 13, 2, { type: { name: "Card" } });
    emit(DEVTOOLS_HOOK_EVENTS.componentUpdated, RAW_APP, 13, 2, { type: { name: "Card" } });
    emit(DEVTOOLS_HOOK_EVENTS.componentUpdated, RAW_APP, 13, 2, { type: { name: "Card" } });
    emit(DEVTOOLS_HOOK_EVENTS.componentRemoved, RAW_APP, 14, 2, { type: { name: "Old" } });

    const result = await recorder.get({});

    expect(result.records.some((record) => record.layer === "lifecycle")).toBe(false);
    expect(result.summary.lifecycle).toMatchObject({ added: 1, updated: 2, removed: 1 });
    expect((result.summary.lifecycle as any).byComponent[0]).toMatchObject({
      name: "Card",
      nodeId: "app-1:13",
      updated: 2,
    });
  });

  it("组件事件记录 event，并把参数裁剪后放进 data", async () => {
    const { emit, recorder } = setup();
    emit(DEVTOOLS_HOOK_EVENTS.componentEmit, RAW_APP, { uid: 13, type: { name: "Card" } }, "select", {
      id: 1,
      payload: "x".repeat(400),
    });

    const result = await recorder.get({});
    const record = result.records[0];

    expect(record).toMatchObject({ layer: "emit", kind: "emit", name: "Card", nodeId: "app-1:13" });
    expect((record.data as any).event).toBe("select");
    expect((record.data as any).params.payload).toContain("(400 chars)");
    expect((result.summary.emit as any)[0]).toMatchObject({ name: "Card", event: "select", count: 1 });
  });
});

describe("createTimelineRecorder — 窗口与标注", () => {
  it("mark 不清历史，sinceMark 只返回标记之后的事件", async () => {
    const { emit, recorder, setClock } = setup();
    render(emit, 13, "Card", "render", 1000, 5);
    setClock(2000);
    const { markId, buffered } = recorder.mark("点击提交");
    expect(markId).toBe("m1");
    expect(buffered).toBe(2);

    setClock(2100);
    render(emit, 14, "List", "patch", 2100, 6);

    const result = await recorder.get({ sinceMark: markId });

    expect(result.records.map((record) => record.name)).toEqual(["点击提交", "List"]);
    expect(result.summary.agent).toMatchObject([{ label: "点击提交" }]);
    // sinceMark 覆盖 windowMs：ms 报实际跨度（mark 在 2000，查询在 2100）
    expect(result.window).toMatchObject({ sinceMark: markId, ms: 100 });
  });

  it("sinceMark 找不到时退回 windowMs 并给出 note", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "Card", "render", 1000, 5);

    const result = await recorder.get({ sinceMark: "m404", minDurationMs: 0 });

    expect(result.records).toHaveLength(1);
    expect(result.notes.join()).toContain("未找到 mark");
  });

  it("clear 清空明细、标记与累计计数，并重置窗口起点", async () => {
    const { emit, recorder, setClock } = setup();
    render(emit, 13, "Card", "render", 1000, 5);
    emit(DEVTOOLS_HOOK_EVENTS.componentUpdated, RAW_APP, 13, 2, { type: { name: "Card" } });
    setClock(2000);
    recorder.mark("旧标记");

    expect(recorder.clear()).toEqual({ cleared: 2, marks: 1 });

    const result = await recorder.get({ minDurationMs: 0 });
    expect(result.records).toHaveLength(0);
    expect(result.buffer.size).toBe(0);
    expect(result.buffer.marks).toBe(0);
    expect(result.buffer.startedAtMsAgo).toBe(0);
    expect((result.summary.lifecycle as any).updated).toBe(0);
  });

  it("窗口之外的事件不返回，空窗口给出原因说明", async () => {
    const { emit, recorder, setClock } = setup();
    render(emit, 13, "Card", "render", 1000, 5);
    setClock(60_000);

    const result = await recorder.get({ windowMs: 5000, minDurationMs: 0 });

    expect(result.records).toHaveLength(0);
    expect(result.notes.join()).toContain("窗口内无事件");
  });
});

describe("createTimelineRecorder — 过滤", () => {
  it("layers 只返回并汇总指定层", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "Card", "render", 1000, 9);
    emit(DEVTOOLS_HOOK_EVENTS.componentEmit, RAW_APP, { uid: 13, type: { name: "Card" } }, "select", {});

    const result = await recorder.get({ layers: ["emit"], minDurationMs: 0 });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].layer).toBe("emit");
    expect(result.summary.perf).toBeUndefined();
    expect(result.summary.lifecycle).toBeUndefined();
    expect(result.summary.emit).toBeDefined();
  });

  it("component 过滤按组件名子串命中，路由与标记不受影响", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "Card", "render", 1000, 9);
    render(emit, 14, "List", "render", 1000, 9);
    recorder.mark("检查点");

    const result = await recorder.get({ component: "card", minDurationMs: 0 });

    // mark 在渲染结束之前（1000 < 1009），明细按时间升序
    expect(result.records.map((record) => record.name)).toEqual(["检查点", "Card"]);
    expect((result.summary.perf as any).byComponent).toHaveLength(1);
  });

  it("include=summary 只给摘要，all 给窗口内全部明细", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "Card", "render", 1000, 1);
    render(emit, 14, "List", "patch", 1001, 2);

    const summary = await recorder.get({ include: "summary" });
    expect(summary.records).toHaveLength(0);
    expect((summary.summary.perf as any).operations).toBe(2);

    const all = await recorder.get({ include: "all", limit: 1 });
    expect(all.records).toHaveLength(1);
    expect(all.records[0].name).toBe("List");
  });

  it("容量溢出时丢弃最早记录并计数", async () => {
    const { emit, recorder } = setup({ capacity: 2 });
    emit(DEVTOOLS_HOOK_EVENTS.componentEmit, RAW_APP, { uid: 13, type: { name: "A" } }, "e1", {});
    emit(DEVTOOLS_HOOK_EVENTS.componentEmit, RAW_APP, { uid: 13, type: { name: "B" } }, "e2", {});
    emit(DEVTOOLS_HOOK_EVENTS.componentEmit, RAW_APP, { uid: 13, type: { name: "C" } }, "e3", {});

    const result = await recorder.get({});

    expect(result.buffer.size).toBe(2);
    expect(result.buffer.dropped).toBe(1);
    expect(result.records.map((record) => record.name)).toEqual(["B", "C"]);
    // 被丢弃的记录落在窗口内 ⇒ 明确告知窗口不完整，而不是让 agent 以为只有两条
    expect(result.buffer.dropped).toBe(1);
    expect(result.buffer.windowTruncated).toBe(true);
    expect(result.buffer.droppedAtMsAgo).toBeTypeOf("number");
    expect(result.notes.join()).toContain("窗口内数据不完整");
  });
});

describe("createTimelineRecorder — 路由与 file 补全", () => {
  it("订阅 app 的 router.afterEach 记录导航，并在摘要里给出 from/to", async () => {
    let navigate: ((to: unknown, from: unknown, failure?: unknown) => void) | undefined;
    const router: TimelineRouterLike = {
      afterEach: vi.fn((handler) => {
        navigate = handler;
        return () => {
          navigate = undefined;
        };
      }),
    };
    const { emit, recorder } = setup({ resolveRouter: (app) => (app === RAW_APP ? router : undefined) });

    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    expect(router.afterEach).toHaveBeenCalledTimes(1);

    navigate?.({ fullPath: "/next" }, { fullPath: "/prev" });

    const result = await recorder.get({});
    expect(result.buffer.capture.routers).toBe(1);
    expect(result.summary.navigate).toMatchObject([{ from: "/prev", to: "/next", at: 0 }]);
    expect(result.records[0]).toMatchObject({ layer: "navigate", name: "/next", level: "default" });
  });

  it("同一个 app 重复 app:init 不重复订阅（微前端多 app 各自订阅）", async () => {
    const router: TimelineRouterLike = { afterEach: vi.fn(() => () => {}) };
    const { emit, recorder } = setup({ resolveRouter: () => router });

    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);

    expect(router.afterEach).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(1);
  });

  it("app:unmount 时退订 router（不留住已卸载应用的 router），重新挂载可再订阅", async () => {
    const off = vi.fn();
    const router: TimelineRouterLike = { afterEach: vi.fn(() => off) };
    const { emit, recorder } = setup({ resolveRouter: () => router });

    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    expect((await recorder.get({})).buffer.capture.routers).toBe(1);

    emit(DEVTOOLS_HOOK_EVENTS.appUnmount, RAW_APP);
    expect(off).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(0);

    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);
    expect(router.afterEach).toHaveBeenCalledTimes(2);
    expect((await recorder.get({})).buffer.capture.routers).toBe(1);
  });

  it("app:unmount 找不到对应 router 时不抛错（也不影响其它订阅）", () => {
    const { emit } = setup({ resolveRouter: () => undefined });
    expect(() => emit(DEVTOOLS_HOOK_EVENTS.appUnmount, RAW_APP)).not.toThrow();
  });

  it("pending 有硬上限：同一毫秒内的 start 风暴不会无界增长", async () => {
    const { emit, recorder } = setup();
    for (let index = 0; index < 6000; index += 1) {
      emit(
        DEVTOOLS_HOOK_EVENTS.performanceStart,
        RAW_APP,
        index + 10,
        { type: { name: "X" } },
        "render",
        1000,
      );
    }
    // 最早的 start 已被硬上限挤掉 → 它的 end 只能算 unpaired
    emit(DEVTOOLS_HOOK_EVENTS.performanceEnd, RAW_APP, 10, { type: { name: "X" } }, "render", 1001);

    const result = await recorder.get({ minDurationMs: 0 });
    expect(result.buffer.prunedStarts).toBe(1000);
    expect(result.buffer.unpaired).toBe(1);
  });

  it("attachRouters 为已挂载的应用补订阅（桥注入晚于 app 挂载的兜底）", async () => {
    const router: TimelineRouterLike = { afterEach: vi.fn(() => () => {}) };
    const { recorder, listenerCount } = setup({ resolveRouter: () => router });

    expect(listenerCount(DEVTOOLS_HOOK_EVENTS.appInit)).toBe(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(0);

    recorder.attachRouters();

    expect(router.afterEach).toHaveBeenCalledTimes(1);
    expect((await recorder.get({})).buffer.capture.routers).toBe(1);
  });

  it("resolveRouter 抛错被吞掉，不影响页面", () => {
    const { emit } = setup({
      resolveRouter: () => {
        throw new Error("boom");
      },
    });

    expect(() => emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP)).not.toThrow();
  });

  it("导航回调内部抛错不外泄（不能打断 vue-router 的导航链）", () => {
    let navigate: ((to: unknown, from: unknown, failure?: unknown) => void) | undefined;
    const router: TimelineRouterLike = {
      afterEach: (handler) => {
        navigate = handler;
        return () => {};
      },
    };
    const { emit } = setup({ resolveRouter: () => router });
    emit(DEVTOOLS_HOOK_EVENTS.appInit, RAW_APP);

    const hostile = Object.defineProperty({}, "fullPath", {
      get() {
        throw new Error("boom");
      },
    });

    expect(() => navigate?.(hostile, { fullPath: "/from" })).not.toThrow();
  });

  it("attachRouters 在 appRecords / 单个应用解析抛错时都不抛出（桥初始化不能被带崩）", () => {
    const broken = createTimelineRecorder({
      hook: createFakeHook().hook,
      getAppRecords: () => {
        throw new Error("boom");
      },
    });
    expect(() => broken.attachRouters()).not.toThrow();

    const router: TimelineRouterLike = { afterEach: vi.fn(() => () => {}) };
    const partial = createTimelineRecorder({
      hook: createFakeHook().hook,
      getAppRecords: () => [
        { id: "app-1", app: RAW_APP },
        { id: "app-2", app: {} },
      ],
      resolveRouter: (app) => {
        if (app === RAW_APP) return router;
        throw new Error("boom");
      },
    });
    expect(() => partial.attachRouters()).not.toThrow();
    // 前一个应用照常订阅，坏的那个只影响自己
    expect(router.afterEach).toHaveBeenCalledTimes(1);
  });

  it("用最新组件树把 nodeId 补成 file，enrich:false 时跳过", async () => {
    const getInspectorTree = vi.fn(async () => [
      { id: "app-1:13", file: "/src/Card.vue", children: [{ id: "app-1:14", file: "/src/Inner.vue", children: [] }] },
    ]);
    const { emit, recorder } = setup({ getInspectorTree });
    render(emit, 13, "Card", "render", 1000, 9);
    render(emit, 14, "Inner", "render", 1000, 9);

    const enriched = await recorder.get({ minDurationMs: 0 });
    expect(enriched.records.map((record) => record.file)).toEqual(["/src/Card.vue", "/src/Inner.vue"]);
    expect(getInspectorTree).toHaveBeenCalledTimes(1);

    // 第二次查询命中 2s 缓存，不再重复拉树
    await recorder.get({ minDurationMs: 0 });
    expect(getInspectorTree).toHaveBeenCalledTimes(1);

    const raw = await recorder.get({ minDurationMs: 0, enrich: false });
    expect(raw.records.every((record) => record.file === undefined)).toBe(true);
  });
});

describe("createTimelineRecorder — 标识解析（devtools-kit 写在实例上的标识优先）", () => {
  it("实例带 __VUE_DEVTOOLS_NEXT_UID__ 时直接复用它的 nodeId", async () => {
    const { emit, recorder } = setup();
    const vm = { uid: 13, type: { name: "Card" }, __VUE_DEVTOOLS_NEXT_UID__: "app-1:13" };

    emit(DEVTOOLS_HOOK_EVENTS.performanceStart, RAW_APP, 13, vm, "render", 1000);
    emit(DEVTOOLS_HOOK_EVENTS.performanceEnd, RAW_APP, 13, vm, "render", 1005);

    const result = await recorder.get({ minDurationMs: 0 });
    expect(result.records[0].nodeId).toBe("app-1:13");
  });

  it("app 不在 appRecords 里时用 app 上的记录标识，而不是 ?", async () => {
    const otherApp = { _instance: { uid: 2 }, __VUE_DEVTOOLS_NEXT_APP_RECORD_ID__: "app-9" };
    const { emit, recorder } = setup();

    emit(DEVTOOLS_HOOK_EVENTS.performanceStart, otherApp, 4, { type: { name: "Header" } }, "render", 1000);
    emit(DEVTOOLS_HOOK_EVENTS.performanceEnd, otherApp, 4, { type: { name: "Header" } }, "render", 1005);
    emit(DEVTOOLS_HOOK_EVENTS.componentUpdated, otherApp, 4, 2, { type: { name: "Header" } });

    const result = await recorder.get({ minDurationMs: 0 });

    expect(result.records[0].nodeId).toBe("app-9:4");
    expect((result.summary.lifecycle as any).byComponent[0].nodeId).toBe("app-9:4");
  });

  it("根实例（instance.root === instance）解析为 appId:root", async () => {
    const rootInstance: Record<string, unknown> = { uid: 2, type: { name: "App" } };
    rootInstance.root = rootInstance;
    const { emit, recorder } = setup();

    emit(DEVTOOLS_HOOK_EVENTS.componentUpdated, RAW_APP, 2, 0, rootInstance);

    const result = await recorder.get({});
    expect((result.summary.lifecycle as any).byComponent[0].nodeId).toBe("app-1:root");
  });
});

describe("createTimelineRecorder — 不误导 agent（缺失必须显式）", () => {
  it("app 既没写标识也不在 appRecords 里时不给 nodeId，而不是给 ?:uid", async () => {
    const orphanApp = { _instance: { uid: 2 } };
    const { emit, recorder } = setup();

    emit(DEVTOOLS_HOOK_EVENTS.performanceStart, orphanApp, 7, { type: { name: "Ghost" } }, "render", 1000);
    emit(DEVTOOLS_HOOK_EVENTS.performanceEnd, orphanApp, 7, { type: { name: "Ghost" } }, "render", 1009);

    const result = await recorder.get({ minDurationMs: 0 });

    expect(result.records[0].nodeId).toBeUndefined();
    expect((result.summary.lifecycle as any).byComponent ?? []).toEqual([]);
  });

  it("挂载早期 app 上还没写标识时，用实例的 appContext.app 兜底解析 nodeId（与 devtools-kit 同路）", async () => {
    // app 自身没有记录标识，但实例的 appContext.app 上有（页面刚挂载的窗口）
    const earlyApp = { _instance: { uid: 2 } };
    const vm = { type: { name: "Boot" }, appContext: { app: { __VUE_DEVTOOLS_NEXT_APP_RECORD_ID__: "app-1" } } };
    const { emit, recorder } = setup();

    emit(DEVTOOLS_HOOK_EVENTS.performanceStart, earlyApp, 13, vm, "render", 1000);
    emit(DEVTOOLS_HOOK_EVENTS.performanceEnd, earlyApp, 13, vm, "render", 1009);
    emit(DEVTOOLS_HOOK_EVENTS.componentUpdated, earlyApp, 13, 2, vm);

    const result = await recorder.get({ minDurationMs: 0 });

    expect(result.records[0].nodeId).toBe("app-1:13");
    expect((result.summary.lifecycle as any).byComponent[0]).toMatchObject({
      name: "Boot",
      nodeId: "app-1:13",
    });
    // 不会另外产生一条无 id 的重复行
    expect((result.summary.lifecycle as any).byComponent).toHaveLength(1);
  });

  it("slow 档把低于阈值的条数记进 omitted，并说明明细非全量", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "Fast", "render", 1000, 1);
    render(emit, 14, "Slow", "render", 1001, 9);

    const result = await recorder.get({ minDurationMs: 4 });

    expect(result.records.map((record) => record.name)).toEqual(["Slow"]);
    expect(result.omitted).toEqual({ perfBelowThreshold: 1, byLimit: 0, byPayload: 0 });
    // truncated 只表示 limit/体积裁剪；"明细是否完整"以 detailComplete 为准
    expect(result.truncated).toBe(false);
    expect(result.detailComplete).toBe(false);
    expect(result.notes.join()).toContain("明细非全量");
    expect((result.summary.perf as any).operations).toBe(2);
  });

  it("limit 裁掉的条数记进 omitted 并置 truncated", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "A", "render", 1000, 9);
    render(emit, 14, "B", "render", 1001, 8);
    render(emit, 15, "C", "render", 1002, 7);

    const result = await recorder.get({ include: "all", limit: 2 });

    expect(result.records).toHaveLength(2);
    expect(result.omitted.byLimit).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.detailComplete).toBe(false);
  });

  it("没有裁剪时 detailComplete 为 true", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "A", "render", 1000, 9);

    const result = await recorder.get({ include: "all" });

    expect(result.records).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(result.detailComplete).toBe(true);
  });

  it("include 传非法值时退回默认档（与 core 常量同源）", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "A", "render", 1000, 1);
    render(emit, 14, "B", "render", 1001, 9);

    const result = await recorder.get({ include: "ALL" as never, minDurationMs: 4 });

    // 按默认 slow 档：只给慢的那条，低于阈值的进 omitted
    expect(result.records.map((record) => record.name)).toEqual(["B"]);
    expect(result.omitted.perfBelowThreshold).toBe(1);
  });

  it("include 各种非字符串 / 非法值都退回默认档且不抛错", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "A", "render", 1000, 1);
    render(emit, 14, "B", "render", 1001, 9);

    for (const invalid of [1, null, undefined, true, {}, ["all"], Symbol("all")] as unknown[]) {
      const result = await recorder.get({ include: invalid as never, minDurationMs: 4 });
      expect(result.records.map((record) => record.name)).toEqual(["B"]);
      expect(result.omitted.perfBelowThreshold).toBe(1);
    }
  });

  it("include=summary 不算裁剪（agent 明确只要摘要），detailComplete 恒 true 是请求口径", async () => {
    const { emit, recorder } = setup();
    render(emit, 13, "A", "render", 1000, 1);

    const result = await recorder.get({ include: "summary" });

    expect(result.records).toHaveLength(0);
    expect(result.omitted).toEqual({ perfBelowThreshold: 0, byLimit: 0, byPayload: 0 });
    expect(result.truncated).toBe(false);
    // 冻结契约：summary 档按请求口径为"完整"（窗口内事件看 summary.perf.operations）
    expect(result.detailComplete).toBe(true);
    expect((result.summary.perf as any).operations).toBe(1);
  });

  it("payload 超限时丢最旧的记录、保留最新的（与「刚才很卡」的用法一致）", async () => {
    const { emit, recorder } = setup();
    // 每条 record 的 data 裁剪后仍有 ~3KB（20 个键 × 150 字符），200 条远超 64KB 上限
    const bulky = Object.fromEntries(
      Array.from({ length: 20 }, (_, key) => [`k${key}`, "x".repeat(150)]),
    );
    for (let index = 0; index < 200; index += 1) {
      emit(
        DEVTOOLS_HOOK_EVENTS.componentEmit,
        RAW_APP,
        { uid: 13, type: { name: `C${String(index).padStart(3, "0")}` } },
        "bulk",
        bulky,
      );
    }

    const result = await recorder.get({ include: "all", limit: 200, enrich: false });

    expect(result.omitted.byPayload).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
    expect(result.detailComplete).toBe(false);
    // 保留的是最新的：最后一条在，最早的不在
    const names = result.records.map((record) => record.name);
    expect(names).toContain("C199");
    expect(names).not.toContain("C000");
  });

  it("丢弃发生在窗口之前时不算窗口不完整（不误报）", async () => {
    const { emit, recorder, setClock } = setup({ capacity: 2 });
    // 三条老记录把最早的挤掉（丢弃发生在 1002）
    emit(DEVTOOLS_HOOK_EVENTS.componentEmit, RAW_APP, { uid: 13, type: { name: "A" } }, "e1", {});
    setClock(1001);
    emit(DEVTOOLS_HOOK_EVENTS.componentEmit, RAW_APP, { uid: 13, type: { name: "B" } }, "e2", {});
    setClock(1002);
    emit(DEVTOOLS_HOOK_EVENTS.componentEmit, RAW_APP, { uid: 13, type: { name: "C" } }, "e3", {});
    // 只查最近 1ms 的窗口：丢弃的记录都在窗口之前
    setClock(1003);

    const result = await recorder.get({ windowMs: 1 });

    expect(result.buffer.dropped).toBe(1);
    expect(result.buffer.windowTruncated).toBe(false);
    expect(result.notes.join()).not.toContain("窗口内数据不完整");
  });

  it("只有 end 没有 start 时明确提示耗时缺失、不等于 0ms", async () => {
    const { emit, recorder } = setup();
    emit(DEVTOOLS_HOOK_EVENTS.performanceEnd, RAW_APP, 13, { type: { name: "Card" } }, "render", 1009);
    render(emit, 14, "List", "render", 1000, 9);

    const result = await recorder.get({ minDurationMs: 0 });

    expect(result.buffer.unpaired).toBe(1);
    expect(result.notes.join()).toContain("不是 0ms");
  });

  it("start 长时间没等到 end 时计入 prunedStarts 并提示", async () => {
    const { emit, recorder } = setup();
    // 灌满 pending 表触发 TTL 清理（阈值 64）
    for (let index = 0; index < 70; index += 1) {
      emit(DEVTOOLS_HOOK_EVENTS.performanceStart, RAW_APP, index + 100, { type: { name: "X" } }, "render", 1000);
    }
    // 时间推进超过 TTL 后，再来一次 start 触发清理
    emit(DEVTOOLS_HOOK_EVENTS.performanceStart, RAW_APP, 999, { type: { name: "X" } }, "render", 7000);

    const result = await recorder.get({});

    expect(result.buffer.prunedStarts).toBe(70);
    expect(result.notes.join()).toContain("缺失");
  });
});

describe("createTimelineRecorder — 无 hook 降级", () => {
  it("没有 devtools hook 时不订阅、查询返回空并说明原因", async () => {
    const recorder = createTimelineRecorder({ getAppRecords: () => [] });

    const result = await recorder.get({});

    expect(result.records).toHaveLength(0);
    expect(result.buffer.capture.hook).toBe(false);
    expect(result.notes.join()).toContain("未取得 Vue DevTools hook");
  });
});
