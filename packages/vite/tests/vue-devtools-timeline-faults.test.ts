/**
 * client/vue-devtools-timeline.ts 故障注入测试。
 *
 * 目标不是"happy path 能跑"，而是断言在畸形/恶意输入下：
 * - 采集器构造、事件回调、查询全链路都不抛错（宿主链路上的回调已装箱）
 * - 返回结果始终可 JSON 序列化、字段自洽、体积受控（不能把宿主或 host 端打挂）
 * - 不写宿主可见状态（app / appRecords / router 只读；不碰 devtools 全局状态）
 * - 缓冲有界（高频事件下内存不无界增长）
 * - 宁可缺字段也不给假信息（不给 `?:uid` 这种用不了的 nodeId）
 *
 * 输入用固定种子伪随机生成，保证可复现。
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

/**
 * 与采集器里的 MAX_PAYLOAD_BYTES 同值（实现未导出该常量）。
 * 体积上限是发布验收点，测试侧独立声明：实现改动时这里会立刻失败，而不是跟着漂移。
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** 固定种子线性同余发生器：注入用例可复现 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

interface FakeHook {
  hook: TimelineHook;
  emit: (event: string, ...args: unknown[]) => void;
}

function createFakeHook(): FakeHook {
  const listeners = new Map<string, Array<(...args: never[]) => void>>();
  return {
    hook: {
      on(event, listener) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return () => {};
      },
    },
    emit(event, ...args) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        (listener as unknown as (...rest: unknown[]) => void)(...args);
      }
    },
  };
}

/** 各种畸形输入：类型错的、会抛的、循环的、超大的、不可 JSON 序列化的 */
function hostileValue(random: () => number): unknown {
  switch (Math.floor(random() * 16)) {
    case 0:
      return undefined;
    case 1:
      return null;
    case 2:
      return Number.NaN;
    case 3:
      return Number.POSITIVE_INFINITY;
    case 4:
      return -1;
    case 5:
      return "";
    case 6:
      return Symbol("boom");
    case 7:
      return 9007199254740993n;
    case 8:
      return () => {
        throw new Error("boom");
      };
    case 9:
      return {
        get fullPath(): string {
          throw new Error("boom");
        },
      };
    case 10: {
      const circular: Record<string, unknown> = { name: "circular" };
      circular.self = circular;
      return circular;
    }
    case 11:
      return new Proxy(
        {},
        {
          get() {
            throw new Error("boom");
          },
          ownKeys() {
            throw new Error("boom");
          },
        },
      );
    case 12:
      return new Date(0);
    case 13:
      // 非字符串组件名：必须被规整为字符串，否则查询期的 name.toLowerCase() 会抛
      return { type: { name: 42, __name: 43n }, root: undefined, uid: "not-a-number" };
    case 14:
      return "x".repeat(5000);
    default:
      return random() < 0.5 ? random() * 1000 : "render";
  }
}

const RAW_APP = Object.freeze({
  _instance: Object.freeze({ uid: 2 }),
  __VUE_DEVTOOLS_NEXT_APP_RECORD_ID__: "app-1",
});

function buildRecorder(options: Omit<TimelineRecorderOptions, "hook"> = {}) {
  const fake = createFakeHook();
  const recorder = createTimelineRecorder({
    hook: fake.hook,
    now: () => 50_000,
    getAppRecords: () => [{ id: "app-1", app: RAW_APP }],
    ...options,
  });
  return { ...fake, recorder };
}

/** 断言一条结果结构自洽、可序列化、字段不撒谎 */
function expectSaneResult(result: unknown, label: string): number {
  let json = "";
  expect(() => {
    json = JSON.stringify(result);
  }, `${label}: 结果必须可 JSON 序列化`).not.toThrow();
  expect(json.length, `${label}: 体积必须受控`).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);

  const data = result as {
    window: { ms: number };
    buffer: { size: number; capacity: number };
    records: Array<{ name: unknown; t: number; dur?: number; nodeId?: string }>;
  };
  expect(Number.isFinite(data.window.ms)).toBe(true);
  expect(data.buffer.size).toBeLessThanOrEqual(data.buffer.capacity);
  for (const record of data.records) {
    expect(typeof record.name).toBe("string");
    expect(Number.isFinite(record.t)).toBe(true);
    if (record.dur !== undefined) expect(record.dur).toBeGreaterThanOrEqual(0);
    if (record.nodeId !== undefined) expect(record.nodeId.startsWith("?:")).toBe(false);
  }
  return json.length;
}

describe("故障注入 — 畸形事件风暴", () => {
  it("随机畸形事件不会抛错，查询结果仍然自洽可序列化", async () => {
    const random = makeRandom(20260921);
    const { emit, recorder } = buildRecorder({ capacity: 100 });
    const events = Object.values(DEVTOOLS_HOOK_EVENTS);

    for (let index = 0; index < 3000; index += 1) {
      const event = events[Math.floor(random() * events.length)];
      const args = [0, 1, 2, 3, 4].map(() => hostileValue(random));
      expect(() => emit(event, ...args), `第 ${index} 次注入（${event}）不应抛错`).not.toThrow();
    }

    for (const query of [
      {},
      { include: "all" as const, limit: 200, minDurationMs: 0 },
      { include: "summary" as const },
      { windowMs: 0 },
      { windowMs: 600_000, minDurationMs: 0, enrich: true },
      { layers: ["perf"], component: "x", limit: 1 },
    ]) {
      const result = await recorder.get(query);
      expectSaneResult(result, `查询 ${JSON.stringify(query)}`);
    }
  });

  it("hook 的 on 抛错 / 返回非函数时，采集器仍能构造并可用", async () => {
    const throwingHook: TimelineHook = {
      on() {
        throw new Error("boom");
      },
    };
    const weirdHook = { on: vi.fn(() => undefined) } as unknown as TimelineHook;

    expect(() => createTimelineRecorder({ hook: throwingHook })).not.toThrow();
    const recorder = createTimelineRecorder({ hook: weirdHook, now: () => 1 });
    expect(() => recorder.dispose()).not.toThrow();

    const result = await recorder.get({});
    expectSaneResult(result, "异常 hook");
    expect(result.buffer.capture.hook).toBe(true);
  });

  it("宿主对象畸形（appRecords / router / 组件树）时查询仍不抛错", async () => {
    const random = makeRandom(7);
    const routerAccess: string[] = [];
    const router = new Proxy(
      {
        afterEach() {
          return () => {};
        },
      },
      {
        get(target, prop, receiver) {
          routerAccess.push(String(prop));
          return Reflect.get(target, prop, receiver);
        },
      },
    );

    const { emit, recorder } = buildRecorder({
      getAppRecords: () => {
        // 一半概率直接抛错，一半返回畸形数组
        if (random() < 0.5) throw new Error("boom");
        return [null as any, { id: null as any, app: undefined }, { id: "app-1", app: RAW_APP }];
      },
      resolveRouter: () => {
        if (random() < 0.5) throw new Error("boom");
        return router as unknown as TimelineRouterLike;
      },
      getInspectorTree: async () => {
        if (random() < 0.5) throw new Error("boom");
        return random() < 0.5
          ? ([{ id: null, file: 42, children: [null, { id: "x" }] }] as unknown as unknown[])
          : "not-a-tree";
      },
    });

    for (let index = 0; index < 300; index += 1) {
      expect(() =>
        emit(
          DEVTOOLS_HOOK_EVENTS[
            (["performanceStart", "performanceEnd", "componentAdded", "componentEmit", "appInit"] as const)[
              Math.floor(random() * 5)
            ]
          ],
          hostileValue(random),
          hostileValue(random),
          hostileValue(random),
          hostileValue(random),
        ),
      ).not.toThrow();
    }
    expect(() => recorder.attachRouters()).not.toThrow();

    const result = await recorder.get({ include: "all", limit: 200, minDurationMs: 0, enrich: true });
    expectSaneResult(result, "畸形宿主");
    // 宿主只应被读取 afterEach，不得顺手改别的属性
    expect(routerAccess.every((prop) => prop === "afterEach")).toBe(true);
  });

  it("高频事件下缓冲有界，不做无界增长", async () => {
    const { emit, recorder } = buildRecorder({ capacity: 50 });

    for (let index = 0; index < 5000; index += 1) {
      emit(
        DEVTOOLS_HOOK_EVENTS.performanceStart,
        RAW_APP,
        index % 20,
        { type: { name: `C${index % 20}`, __name: "C" } },
        "render",
        1000 + index,
      );
      emit(
        DEVTOOLS_HOOK_EVENTS.performanceEnd,
        RAW_APP,
        index % 20,
        { type: { name: `C${index % 20}`, __name: "C" } },
        "render",
        1000 + index + 1,
      );
    }

    const result = await recorder.get({ include: "summary", windowMs: 600_000 });
    expectSaneResult(result, "高频风暴");
    expect(result.buffer.size).toBe(50);
    expect(result.buffer.dropped).toBeGreaterThan(4000);
    expect(result.buffer.windowTruncated).toBe(true);
  });

  it("不写宿主可见状态（app / appRecords / devtools 全局状态只读）", async () => {
    const random = makeRandom(99);
    const appRecord = Object.freeze({ id: "app-1", app: RAW_APP });
    const appRecords = Object.freeze([appRecord]);
    const globalKey = "__VUE_DEVTOOLS_KIT_GLOBAL_STATE__";
    const globalBefore = { timelineLayersState: { recordingState: false }, sentinel: "untouched" };
    (globalThis as any)[globalKey] = globalBefore;

    try {
      const { emit, recorder } = buildRecorder({ getAppRecords: () => appRecords as any });
      const snapshot = () =>
        JSON.stringify({
          appKeys: Object.keys(RAW_APP),
          recordKeys: Object.keys(appRecord),
          ids: appRecords.map((record) => record.id),
          global: (globalThis as any)[globalKey],
        });
      const before = snapshot();

      for (let index = 0; index < 500; index += 1) {
        emit(
          DEVTOOLS_HOOK_EVENTS[
            (["performanceStart", "performanceEnd", "componentAdded", "componentUpdated", "appInit"] as const)[
              Math.floor(random() * 5)
            ]
          ],
          RAW_APP,
          index % 10,
          { type: { name: "C" } },
          "render",
          1000 + index,
        );
      }
      await recorder.get({ include: "all", limit: 200 });
      recorder.mark("标注");
      recorder.clear();

      expect(snapshot()).toBe(before);
    } finally {
      delete (globalThis as any)[globalKey];
    }
  });
});
