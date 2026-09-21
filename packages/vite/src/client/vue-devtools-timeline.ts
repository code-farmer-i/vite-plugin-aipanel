/**
 * Vue DevTools 时间线采集器（页面侧，供 agent 调试）。
 *
 * 为什么自己实现存储：devtools-kit 的 timeline 事件只转发给已连接的 DevTools 客户端，不落盘
 * （没有 clientConnected 时事件即发即弃），且内置层受 recordingState/highPerfModeEnabled 门控。
 * 本模块直接订阅 `__VUE_DEVTOOLS_GLOBAL_HOOK__` 的原始 Vue 事件（实测不受上述两个门控影响），
 * 在页面内存里维护一个有界环形缓冲，供 `vue-devtools_get_timeline` 按窗口查询。
 *
 * 采集约定：
 * - 常驻采集（无 start/stop 状态）：`clear()` 等价于"从现在开始录"，`mark()` 只插边界不清历史；
 * - 捕获期就把数据降级为 primitive（绝不持有 app/vm/instance 引用），生命周期事件只累计计数；
 * - 所有 hook 回调都包在 try/catch 里：devtools hook 的 emit 是同步遍历，回调抛错会影响页面渲染。
 */

import {
  VUE_DEVTOOLS_TIMELINE_DEFAULTS,
  VUE_DEVTOOLS_TIMELINE_INCLUDE,
  VUE_DEVTOOLS_TIMELINE_INCLUDES,
  VUE_DEVTOOLS_TIMELINE_LAYERS,
  type VueDevtoolsTimelineInclude,
  type VueDevtoolsTimelineLayer,
} from "@aipanel/core";
import { sanitizeValue } from "./vue-devtools-sanitize";

/**
 * 原始 devtools hook 的事件名（唯一来源）。
 * @vue/devtools-kit 的 DevToolsHooks 枚举只有 d.ts 声明、运行时未导出（import 值为 undefined），
 * 故无法 import；这里集中定义一次，值对齐 @vue/devtools-kit@8.2.1 的 DevToolsHooks
 * （dist/index.d.ts:718-733），升级该依赖时需同步核对（vue-devtools-timeline.test.ts 锁住配合行为）。
 */
export const DEVTOOLS_HOOK_EVENTS = {
  appInit: "app:init",
  appUnmount: "app:unmount",
  componentAdded: "component:added",
  componentUpdated: "component:updated",
  componentRemoved: "component:removed",
  componentEmit: "component:emit",
  performanceStart: "perf:start",
  performanceEnd: "perf:end",
} as const;

/**
 * devtools hook 的监听器签名随事件而异，注册时按动态签名处理（devtools-kit 自己用的是 `Function`）。
 * `never[]` 是下界：任何声明了具体参数的监听器都能注册，但取出来调用时需按事件自行收窄。
 */
export type HookListener = (...args: never[]) => void;

/**
 * 原始 devtools hook 的最小结构。
 * 不用 devtools-kit 的 DevToolsHook 类型：其 on() 的事件参数是未导出的枚举类型。
 */
export interface TimelineHook {
  on(event: string, listener: HookListener): () => void;
}

/** Vue 应用实例上与时间线相关的最小形状（避免依赖 Vue 类型） */
export interface TimelineAppLike {
  _instance?: { uid?: number };
  /** devtools-kit 写在 app 上的记录标识；按引用比对 appRecords 会漏（实测出现 ?:uid） */
  __VUE_DEVTOOLS_NEXT_APP_RECORD_ID__?: string;
  __VUE_DEVTOOLS_NEXT_APP_RECORD__?: { id?: string };
}

/** Vue 组件实例上与 nodeId 相关的最小形状 */
export interface TimelineInstanceLike {
  uid?: number;
  root?: unknown;
  type?: { name?: string; __name?: string };
  /** devtools-kit 写在实例上的完整 nodeId（与组件树 id 同源） */
  __VUE_DEVTOOLS_NEXT_UID__?: string;
  /** 挂载早期 app 上还没有记录标识时，用它兜底解析 appId */
  appContext?: { app?: TimelineAppLike };
}

/** vue-router 实例上与时间线相关的最小形状 */
export interface TimelineRouterLike {
  afterEach: (handler: (to: unknown, from: unknown, failure?: unknown) => void) => () => void;
}

export interface TimelineAppRecord {
  id: string;
  app: unknown;
}

/** 时间线明细记录（t 为相对查询时刻的毫秒数，负数表示过去） */
export interface TimelineRecord {
  seq: number;
  t: number;
  layer: VueDevtoolsTimelineLayer;
  kind: string;
  name: string;
  dur?: number;
  nodeId?: string;
  file?: string;
  level?: "default" | "warning" | "error";
  data?: unknown;
}

/** 时间线查询参数（来自 MCP 工具入参，全部可省略） */
export interface TimelineQuery {
  windowMs?: number;
  sinceMark?: string;
  layers?: string[];
  minDurationMs?: number;
  component?: string;
  include?: VueDevtoolsTimelineInclude;
  limit?: number;
  /** 是否用最新组件树补全 file（默认开，2s 缓存） */
  enrich?: boolean;
}

export interface TimelineQueryResult {
  window: { from: number; to: number; ms: number; sinceMark?: string };
  buffer: {
    capacity: number;
    size: number;
    dropped: number;
    /**
     * 已丢弃记录里最新一条的时间（相对现在的 ms）。
     * 用它判断"窗口内数据是否被丢弃过"：只有当它落在窗口内才说明窗口不完整。
     */
    droppedAtMsAgo?: number;
    /** 窗口起点早于被丢弃的记录 ⇒ 窗口内数据不完整（与 droppedAtMsAgo 配套，避免误报） */
    windowTruncated: boolean;
    /** 只有 end 没有 start 的渲染次数（耗时缺失，不等于 0ms） */
    unpaired: number;
    /** 因长时间没有 end 而被清掉的 start 次数（同样属于耗时缺失） */
    prunedStarts: number;
    marks: number;
    startedAtMsAgo: number;
    bootId: string;
    capture: { hook: boolean; routers: number };
  };
  summary: Record<string, unknown>;
  records: TimelineRecord[];
  /** 明细被 limit / 体积上限裁剪过（阈值裁剪见 omitted.perfBelowThreshold）——摘要计数不受影响 */
  truncated: boolean;
  /**
   * 明细是否全量：omitted 三项全为 0 才为 true。判断"有没有被裁"只看这一个字段。
   * include=summary 时 records 按请求为空、本字段恒 true（按请求口径，不代表窗口内没有事件）。
   */
  detailComplete: boolean;
  /** 明细裁剪的去向，保证"没看到的不是没发生" */
  omitted: { perfBelowThreshold: number; byLimit: number; byPayload: number };
  notes: string[];
}

export interface TimelineRecorderOptions {
  hook?: TimelineHook;
  getAppRecords?: () => TimelineAppRecord[];
  /** 组件树（用于把 nodeId 补成源码文件路径） */
  getInspectorTree?: () => Promise<unknown>;
  /** 由桥决定如何从 Vue 应用取 router（采集器不感知 Vue 内部结构） */
  resolveRouter?: (app: unknown) => TimelineRouterLike | undefined;
  now?: () => number;
  capacity?: number;
}

export interface TimelineRecorder {
  get(query?: TimelineQuery): Promise<TimelineQueryResult>;
  mark(label: string): { markId: string; buffered: number };
  clear(): { cleared: number; marks: number };
  /** 为已注册的应用补订阅 router（桥注入晚于 app 挂载时的兜底；正常路径由 app:init 覆盖） */
  attachRouters(): void;
  dispose(): void;
}

/** 内部记录：t 在查询时才算，存储用绝对时间 */
interface StoredRecord extends Omit<TimelineRecord, "t"> {
  at: number;
}

interface PendingOperation {
  name: string;
  /** 解析不出可靠 nodeId 时为 undefined —— 宁可没有，也不给一个用不了的 id */
  nodeId?: string;
  at: number;
}

interface ComponentStat {
  name: string;
  nodeId?: string;
  added: number;
  updated: number;
  removed: number;
  lastAt: number;
}

interface TimelineMark {
  id: string;
  label: string;
  at: number;
}

const MAX_COMPONENTS = 200;
const MAX_MARKS = 20;
const PENDING_TTL_MS = 5000;
/** pending 表超过该规模才做 TTL 清理（正常并发渲染远低于它，避免每个事件都遍历） */
const PENDING_PRUNE_THRESHOLD = 64;
/** pending 硬上限：大量 start 拿不到 end 时也不能无界增长（超出按最早丢弃并计入 prunedStarts） */
const MAX_PENDING = 5000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const TREE_CACHE_TTL_MS = 2000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/**
 * 组件名必须是字符串：返回非字符串会让 `component` 过滤的 toLowerCase() 在查询期抛错，
 * 也可能让 agent 看到数字/符号这类无意义的名字。
 */
function readName(instance: unknown): string {
  const type = (instance as { type?: { name?: unknown; __name?: unknown } } | null)?.type;
  const name = type?.name ?? type?.__name;
  return typeof name === "string" && name ? name : "(anonymous)";
}

function readUid(instance: unknown): number | undefined {
  const uid = (instance as { uid?: unknown } | null)?.uid;
  return typeof uid === "number" ? uid : undefined;
}

function readRoutePath(route: unknown): string {
  const value = route as { fullPath?: unknown; path?: unknown } | null;
  if (typeof value?.fullPath === "string") return value.fullPath;
  if (typeof value?.path === "string") return value.path;
  return String(route ?? "");
}

function readEventName(data: unknown): string {
  const event = (data as { event?: unknown } | null)?.event;
  return typeof event === "string" ? event : "(unknown)";
}

/** 递归收集组件树里的 nodeId → 源码文件（file 为空的框架组件不参与） */
function collectFiles(nodes: unknown, files: Map<string, string>): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const { id, file, children } = (node ?? {}) as {
      id?: unknown;
      file?: unknown;
      children?: unknown;
    };
    if (typeof id === "string" && typeof file === "string" && file) files.set(id, file);
    collectChildren(children, files);
  }
}

function collectChildren(children: unknown, files: Map<string, string>): void {
  collectFiles(children, files);
}

/** 装箱：回调抛错不能影响宿主（页面渲染 / vue-router 导航链 / 桥初始化） */
function safely<Args extends unknown[]>(handler: (...args: Args) => void): (...args: Args) => void {
  return (...args: Args) => {
    try {
      handler(...args);
    } catch {
      // 采集失败不影响宿主；宁可不记也不抛
    }
  };
}

export function createTimelineRecorder(options: TimelineRecorderOptions = {}): TimelineRecorder {
  const capacity = options.capacity ?? VUE_DEVTOOLS_TIMELINE_DEFAULTS.capacity;
  const now = options.now ?? (() => performance.now());
  const getAppRecords = options.getAppRecords ?? (() => []);
  const resolveRouter = options.resolveRouter ?? (() => undefined);
  const hook = options.hook;

  /** 取时钟：注入的 now 可能抛错或返回非数字，查询路径与构造都必须能兜住（构造抛错会打断桥初始化） */
  function readNow(): number {
    try {
      const value = now();
      return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  }

  const bootId = Math.random().toString(36).slice(2, 10);
  let startedAt = readNow();

  let records: StoredRecord[] = [];
  let marks: TimelineMark[] = [];
  const pending = new Map<string, PendingOperation>();
  /** uid 维度累计计数（LRU：访问后重新插入到 Map 末尾） */
  const components = new Map<string, ComponentStat>();
  /** app → 它当前订阅的 router（WeakMap 不持有 app）：用于重复 app:init 去重与"换了 router"时退旧的 */
  const appRouters = new WeakMap<object, object>();
  /** router → { 退订函数, 订阅它的 app 数 }：多个 app 可能共用同一个 router，必须引用计数 */
  const routerSubscriptions = new Map<object, { off: () => void; apps: number }>();
  /** hook 事件的退订函数（页面存活期间一直有效，dispose 时统一清） */
  const unsubscribers: Array<() => void> = [];

  /**
   * 生命周期**精确累计**。不能只靠 components（有 200 上限）：组件多于一页时，
   * 逐组件表会淘汰，若总数也从表里求和就会静默少报——判断"是否过度渲染"最怕这个。
   */
  const lifecycleTotals = { added: 0, updated: 0, removed: 0 };
  /**
   * 逐组件表的淘汰**次数**（不是"不同组件数"：被淘汰的组件再次活跃会重新入表并可能再挤掉别人）。
   * >0 表示 byComponent 只覆盖最近活跃的一部分组件。
   */
  let componentEvictions = 0;

  let dropped = 0;
  /** 已丢弃记录里最新一条的绝对时间（判断窗口是否被丢弃过） */
  let droppedAt: number | null = null;
  let unpaired = 0;
  let prunedStarts = 0;
  let sequence = 0;
  let markSequence = 0;
  let routerCount = 0;
  let treeCache: { at: number; files: Map<string, string> } | null = null;

  function appIdOf(app: unknown, instance?: unknown): string {
    // devtools-kit 自己把记录标识写在 app 上（getAppRecordId/getAppRecord），比按引用比对可靠
    const appLike = app as TimelineAppLike | null;
    const fromApp =
      appLike?.__VUE_DEVTOOLS_NEXT_APP_RECORD_ID__ ?? appLike?.__VUE_DEVTOOLS_NEXT_APP_RECORD__?.id;
    if (typeof fromApp === "string" && fromApp) return fromApp;
    // 挂载早期 app 上还没写标识：退到实例的 appContext.app（与 devtools-kit getComponentId 同一条退路），
    // 否则这些记录会落到 "?" 分组、在 byComponent 里表现为同名重复行
    const fromInstance = (instance as TimelineInstanceLike | null)?.appContext?.app;
    const fromInstanceId =
      fromInstance?.__VUE_DEVTOOLS_NEXT_APP_RECORD_ID__ ?? fromInstance?.__VUE_DEVTOOLS_NEXT_APP_RECORD__?.id;
    if (typeof fromInstanceId === "string" && fromInstanceId) return fromInstanceId;
    return getAppRecords().find((record) => record.app === app)?.id ?? "?";
  }

  /** 解析不出可靠 nodeId 时返回 undefined：宁可让 agent 少一个跳转，也不给它一个查不到的 id */
  function nodeIdOf(app: unknown, uid: number, instance?: unknown): string | undefined {
    const instanceLike = instance as TimelineInstanceLike | null;
    // 实例被 devtools-kit 标记过时直接复用它的 nodeId，保证与组件树 id 完全一致
    if (typeof instanceLike?.__VUE_DEVTOOLS_NEXT_UID__ === "string") {
      return instanceLike.__VUE_DEVTOOLS_NEXT_UID__;
    }
    const appId = appIdOf(app, instance);
    if (appId === "?") return undefined;
    const isRoot =
      (instanceLike != null && instanceLike.root === instance) ||
      (app as TimelineAppLike | null)?._instance?.uid === uid;
    return `${appId}:${isRoot ? "root" : uid}`;
  }

  function push(record: Omit<StoredRecord, "seq">): void {
    records.push({ ...record, seq: ++sequence });
    const overflow = records.length - capacity;
    if (overflow > 0) {
      const evicted = records.splice(0, overflow);
      const newest = evicted[evicted.length - 1];
      if (newest) droppedAt = Math.max(droppedAt ?? newest.at, newest.at);
      dropped += overflow;
    }
  }

  function prunePending(nowAt: number): void {
    if (pending.size > PENDING_PRUNE_THRESHOLD) {
      for (const [key, operation] of pending) {
        if (nowAt - operation.at > PENDING_TTL_MS) {
          pending.delete(key);
          // start 没有等到 end：这次渲染的耗时是"缺失"，不是 0
          prunedStarts += 1;
        }
      }
    }
    // 硬上限兜底：TTL 只在超过 5s 后才生效，同一毫秒内的 start 风暴也要有界
    while (pending.size > MAX_PENDING) {
      const oldest = pending.keys().next().value;
      if (oldest === undefined) break;
      pending.delete(oldest);
      prunedStarts += 1;
    }
  }

  function touchComponent(
    app: unknown,
    uid: number,
    instance: unknown,
    field: "added" | "updated" | "removed",
  ): void {
    // key 用 appId:uid（稳定）；nodeId 可能解析不出，不能用它当 key，否则同一组件会分裂成两条
    const key = `${appIdOf(app, instance)}:${uid}`;
    const nodeId = nodeIdOf(app, uid, instance);
    const existing = components.get(key);
    const stat: ComponentStat = existing ?? {
      name: readName(instance),
      ...(nodeId === undefined ? {} : { nodeId }),
      added: 0,
      updated: 0,
      removed: 0,
      lastAt: 0,
    };
    // 先前解析不出、这次解析出来了：补上，避免同一组件长期缺 id
    if (existing && stat.nodeId === undefined && nodeId !== undefined) stat.nodeId = nodeId;
    stat[field] += 1;
    stat.lastAt = readNow();
    // 总数单独精确累计：逐组件表有上限，淘汰后不能连带把总数也报小
    lifecycleTotals[field] += 1;
    if (existing) components.delete(key);
    components.set(key, stat);

    while (components.size > MAX_COMPONENTS) {
      const oldest = components.keys().next().value;
      if (oldest === undefined) break;
      components.delete(oldest);
      componentEvictions += 1;
    }
  }

  function onPerformanceStart(app: unknown, uid: number, vm: unknown, type: string, time: number): void {
    if (typeof uid !== "number" || typeof type !== "string") return;
    prunePending(time);
    const nodeId = nodeIdOf(app, uid, vm);
    pending.set(`${appIdOf(app, vm)}:${uid}:${type}`, {
      name: readName(vm),
      ...(nodeId === undefined ? {} : { nodeId }),
      at: typeof time === "number" ? time : readNow(),
    });
  }

  function onPerformanceEnd(app: unknown, uid: number, vm: unknown, type: string, time: number): void {
    if (typeof uid !== "number" || typeof type !== "string") return;
    const key = `${appIdOf(app, vm)}:${uid}:${type}`;
    const started = pending.get(key);
    pending.delete(key);
    if (!started) {
      unpaired += 1;
      return;
    }
    const endAt = typeof time === "number" ? time : readNow();
    push({
      at: endAt,
      layer: "perf",
      kind: type,
      name: started.name || readName(vm),
      nodeId: started.nodeId,
      dur: round2(Math.max(0, endAt - started.at)),
    });
  }

  function onComponentAdded(app: unknown, uid: number, _parentUid: number, instance: unknown): void {
    if (typeof uid !== "number") return;
    touchComponent(app, uid, instance, "added");
  }

  function onComponentUpdated(app: unknown, uid: number, _parentUid: number, instance: unknown): void {
    if (typeof uid !== "number") return;
    touchComponent(app, uid, instance, "updated");
  }

  function onComponentRemoved(app: unknown, uid: number, _parentUid: number, instance: unknown): void {
    if (typeof uid !== "number") return;
    touchComponent(app, uid, instance, "removed");
  }

  function onComponentEmit(app: unknown, instance: unknown, event: unknown, params: unknown): void {
    const uid = readUid(instance);
    const nodeId = uid === undefined ? undefined : nodeIdOf(app, uid, instance);
    push({
      at: readNow(),
      layer: "emit",
      kind: "emit",
      name: readName(instance),
      ...(nodeId === undefined ? {} : { nodeId }),
      data: { event: typeof event === "string" ? event : String(event), params: sanitizeValue(params) },
    });
  }

  function onNavigated(to: unknown, from: unknown, failure?: unknown): void {
    const toPath = readRoutePath(to);
    // failure 是宿主对象（NavigationFailure 可能是任意形状）：必须走同一套裁剪，
    // 否则 message 里带 bigint/symbol/超长字符串会让整个结果不可序列化或撑破体积上限
    const failureDetail = failure ? sanitizeValue((failure as Error)?.message ?? String(failure)) : undefined;
    push({
      at: readNow(),
      layer: "navigate",
      kind: "navigation",
      name: toPath,
      level: failure ? "warning" : "default",
      data: {
        from: readRoutePath(from),
        to: toPath,
        ...(failureDetail === undefined || failureDetail === null ? {} : { failure: failureDetail }),
      },
    });
  }

  function subscribeRouter(app: unknown): void {
    const router = resolveRouter(app);
    if (!router || typeof router.afterEach !== "function") return;
    const appKey = typeof app === "object" && app !== null ? app : undefined;
    if (appKey) {
      const previous = appRouters.get(appKey);
      // 同一 app 同一 router 且订阅仍在：重复 app:init，忽略
      if (previous === router && routerSubscriptions.has(router)) return;
      // 同一 app 换了 router：先退掉旧的，否则旧 off 永不调用、条目常驻
      if (previous && previous !== router) releaseRouter(previous);
      appRouters.set(appKey, router);
    } else if (routerSubscriptions.has(router)) {
      // 非对象 app 无法按 app 去重，退回按 router 去重（不重复计数）
      return;
    }
    // 多个 app 可能共用同一个 router：引用计数，卸载其中一个不能拆掉另一个的订阅
    const existing = routerSubscriptions.get(router);
    if (existing) {
      existing.apps += 1;
      routerCount += 1;
      return;
    }
    // afterEach 回调跑在 vue-router 的导航链上，抛错会打断导航：必须包住
    const off = router.afterEach(safely(onNavigated));
    if (typeof off !== "function") return;
    routerSubscriptions.set(router, { off, apps: 1 });
    routerCount += 1;
  }

  /** 释放一份 router 订阅；仍被其它 app 引用时只减计数 */
  function releaseRouter(router: object): void {
    const entry = routerSubscriptions.get(router);
    if (!entry) return;
    entry.apps = Math.max(0, entry.apps - 1);
    routerCount = Math.max(0, routerCount - 1);
    if (entry.apps > 0) return;
    safely(entry.off)();
    routerSubscriptions.delete(router);
  }

  function unsubscribeRouter(app: unknown): void {
    // 应用卸载时退订，否则退订闭包会一直持有已卸载应用的 router（微前端反复重建应用时泄漏）
    const appKey = typeof app === "object" && app !== null ? app : undefined;
    if (!appKey) return;
    const router = appRouters.get(appKey);
    // 没有记录说明这个 app 没订阅过（例如共用 router 的另一个 app 从未 init）：不能误减别人的计数
    if (!router) return;
    appRouters.delete(appKey);
    releaseRouter(router);
  }

  function onAppInit(app: unknown): void {
    subscribeRouter(app);
  }

  function onAppUnmount(app: unknown): void {
    unsubscribeRouter(app);
  }

  /** 桥注入晚于应用挂载时的兜底；任何一步失败都不能影响桥初始化（window.__aipanel_vue 必须建起来） */
  function attachRouters(): void {
    let records: TimelineAppRecord[];
    try {
      records = getAppRecords();
    } catch {
      return;
    }
    for (const record of records) {
      try {
        subscribeRouter(record.app);
      } catch {
        // 单个应用解析失败不影响其它应用
      }
    }
  }

  // 订阅失败不能让采集器构造失败：构造抛错会使桥初始化中断，整族 vue-devtools_* 工具全废
  try {
    if (hook && typeof hook.on === "function") {
      const subscribe = <Args extends unknown[]>(event: string, handler: (...args: Args) => void) => {
        try {
          const off = hook.on(event, safely(handler) as unknown as HookListener);
          if (typeof off === "function") unsubscribers.push(off);
        } catch {
          // 单个事件订阅失败只影响该事件
        }
      };
      subscribe(DEVTOOLS_HOOK_EVENTS.performanceStart, onPerformanceStart);
      subscribe(DEVTOOLS_HOOK_EVENTS.performanceEnd, onPerformanceEnd);
      subscribe(DEVTOOLS_HOOK_EVENTS.componentAdded, onComponentAdded);
      subscribe(DEVTOOLS_HOOK_EVENTS.componentUpdated, onComponentUpdated);
      subscribe(DEVTOOLS_HOOK_EVENTS.componentRemoved, onComponentRemoved);
      subscribe(DEVTOOLS_HOOK_EVENTS.componentEmit, onComponentEmit);
      subscribe(DEVTOOLS_HOOK_EVENTS.appInit, onAppInit);
      subscribe(DEVTOOLS_HOOK_EVENTS.appUnmount, onAppUnmount);
    }
  } catch {
    // hook 对象本身不可用时仍返回一个可用（空）的采集器
  }

  async function fileMap(nowAt: number): Promise<Map<string, string>> {
    if (treeCache && nowAt - treeCache.at < TREE_CACHE_TTL_MS) return treeCache.files;
    const files = new Map<string, string>();
    try {
      const tree = await options.getInspectorTree?.();
      collectFiles(tree, files);
    } catch {
      // 组件树不可用时静默跳过 file 补全
    }
    treeCache = { at: nowAt, files };
    return files;
  }

  function mark(label: string): { markId: string; buffered: number } {
    const at = readNow();
    const markId = `m${++markSequence}`;
    // 必须是字符串：非字符串 label 会让记录不可 JSON 序列化（进而让整份结果发不出去）
    const name = typeof label === "string" && label ? label : "mark";
    marks.push({ id: markId, label: name, at });
    while (marks.length > MAX_MARKS) marks.shift();
    push({ at, layer: "agent", kind: "mark", name, data: { markId } });
    return { markId, buffered: records.length };
  }

  function clear(): { cleared: number; marks: number } {
    const cleared = records.length;
    const clearedMarks = marks.length;
    records = [];
    marks = [];
    pending.clear();
    components.clear();
    lifecycleTotals.added = 0;
    lifecycleTotals.updated = 0;
    lifecycleTotals.removed = 0;
    componentEvictions = 0;
    dropped = 0;
    droppedAt = null;
    unpaired = 0;
    prunedStarts = 0;
    treeCache = null;
    startedAt = readNow();
    return { cleared, marks: clearedMarks };
  }

  function dispose(): void {
    for (const off of unsubscribers) safely(off)();
    unsubscribers.length = 0;
    for (const { off } of routerSubscriptions.values()) safely(off)();
    routerSubscriptions.clear();
    routerCount = 0;
  }

  async function get(query: TimelineQuery = {}): Promise<TimelineQueryResult> {
    const nowAt = readNow();
    // 档位取值与默认值都来自 @aipanel/core（单一来源）；非法值退回默认档
    const include: VueDevtoolsTimelineInclude =
      typeof query.include === "string" &&
      (VUE_DEVTOOLS_TIMELINE_INCLUDES as readonly string[]).includes(query.include)
        ? (query.include as VueDevtoolsTimelineInclude)
        : VUE_DEVTOOLS_TIMELINE_DEFAULTS.include;
    const windowMs = clampNumber(query.windowMs, 0, 600000, VUE_DEVTOOLS_TIMELINE_DEFAULTS.windowMs);
    const minDurationMs = clampNumber(
      query.minDurationMs,
      0,
      60000,
      VUE_DEVTOOLS_TIMELINE_DEFAULTS.minDurationMs,
    );
    const limit = Math.floor(
      clampNumber(query.limit, 1, VUE_DEVTOOLS_TIMELINE_DEFAULTS.maxLimit, VUE_DEVTOOLS_TIMELINE_DEFAULTS.limit),
    );
    const layers = normalizeLayers(query.layers);
    const componentFilter = typeof query.component === "string" ? query.component.toLowerCase() : "";
    const notes: string[] = [];
    prunePending(nowAt);

    // ---- 窗口边界：mark 优先于 windowMs ----
    let from = nowAt - windowMs;
    if (query.sinceMark) {
      const target = findMark(query.sinceMark);
      if (target) {
        from = target.at;
      } else {
        notes.push(
          `未找到 mark「${query.sinceMark}」（页面可能已整页刷新，或标记已被丢弃）；已退回 windowMs=${windowMs} 的窗口。`,
        );
      }
    }

    const inWindow = records.filter((record) => record.at >= from && layers.has(record.layer));
    const scoped = inWindow.filter((record) => {
      if (!componentFilter) return true;
      if (record.layer === "navigate" || record.layer === "agent") return true;
      return record.name.toLowerCase().includes(componentFilter);
    });

    // 只有被丢弃的记录落在窗口内，才算窗口不完整（避免把"页面加载前"误报成数据缺失）
    const windowTruncated = droppedAt !== null && droppedAt >= from;

    if (scoped.length === 0) {
      notes.push(
        "窗口内无事件。常见原因：窗口内没有交互或渲染；或页面刚整页刷新——SPA 路由切换保留记录，整页刷新会清空缓冲。",
      );
    }
    if (!hook) {
      notes.push("未取得 Vue DevTools hook：页面可能不是 Vue 项目，或桥未初始化。");
    }
    if (windowTruncated) {
      notes.push(
        `窗口内数据不完整：缓冲容量 ${capacity} 条，最早保留记录起于 -${round2(nowAt - (records[0]?.at ?? nowAt))}ms，窗口起点更早的部分已被丢弃（累计丢弃 ${dropped} 条）。`,
      );
    }
    if (unpaired > 0 || prunedStarts > 0) {
      const parts = [
        unpaired > 0 ? `${unpaired} 次只有 end 没有 start` : "",
        prunedStarts > 0 ? `${prunedStarts} 次 start 未等到 end` : "",
      ].filter(Boolean);
      notes.push(
        `有 ${parts.join("、")}：这些渲染的耗时是"缺失"，不是 0ms（start 被清理后才收到 end 时，同一次渲染会同时计入两处）。`,
      );
    }

    // ---- 明细选择：slow 取最慢的，all 取最近的 ----
    const omitted = { perfBelowThreshold: 0, byLimit: 0, byPayload: 0 };
    let picked: StoredRecord[];
    let eligible: number;
    if (include === VUE_DEVTOOLS_TIMELINE_INCLUDE.SUMMARY) {
      // 摘要档：agent 明确只要摘要，不算"被裁剪"
      picked = [];
      eligible = 0;
    } else if (include === VUE_DEVTOOLS_TIMELINE_INCLUDE.ALL) {
      picked = scoped.slice(-limit);
      eligible = scoped.length;
    } else {
      const perf = scoped.filter((record) => record.layer === "perf");
      omitted.perfBelowThreshold = perf.filter((record) => (record.dur ?? 0) < minDurationMs).length;
      const slow = perf
        .filter((record) => (record.dur ?? 0) >= minDurationMs)
        .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
        .slice(0, limit);
      const rest = scoped.filter((record) => record.layer !== "perf").slice(-limit);
      picked = [...slow, ...rest];
      eligible = perf.length - omitted.perfBelowThreshold + scoped.filter((r) => r.layer !== "perf").length;
    }
    omitted.byLimit = Math.max(0, eligible - picked.length);
    picked.sort((a, b) => a.at - b.at);

    const detail: TimelineRecord[] = picked.map((record) => ({
      seq: record.seq,
      t: round2(record.at - nowAt),
      layer: record.layer,
      kind: record.kind,
      name: record.name,
      ...(record.dur === undefined ? {} : { dur: record.dur }),
      ...(record.nodeId ? { nodeId: record.nodeId } : {}),
      ...(record.level ? { level: record.level } : {}),
      ...(record.data === undefined ? {} : { data: record.data }),
    }));

    if (query.enrich !== false && detail.length > 0 && options.getInspectorTree) {
      const files = await fileMap(nowAt);
      for (const record of detail) {
        if (!record.nodeId) continue;
        const file = files.get(record.nodeId);
        if (file) record.file = file;
      }
    }

    const summary = buildSummary(scoped, layers, componentFilter, minDurationMs, nowAt);
    const result: TimelineQueryResult = {
      // ms 报实际窗口跨度（sinceMark 会覆盖 windowMs，不能谎报成请求值）
      window: {
        from: round2(from - nowAt),
        to: 0,
        ms: round2(nowAt - from),
        ...(query.sinceMark ? { sinceMark: query.sinceMark } : {}),
      },
      buffer: {
        capacity,
        size: records.length,
        dropped,
        ...(droppedAt === null ? {} : { droppedAtMsAgo: round2(droppedAt - nowAt) }),
        windowTruncated,
        unpaired,
        prunedStarts,
        marks: marks.length,
        startedAtMsAgo: round2(nowAt - startedAt),
        bootId,
        capture: { hook: Boolean(hook), routers: routerCount },
      },
      summary,
      records: detail,
      truncated: false,
      detailComplete: true,
      omitted,
      notes,
    };

    // ---- payload 上限：按 JSON 体积裁剪明细（摘要永远保留）----
    // records 已按时间升序：超限时丢**最旧**的（shift），保留最近发生的——与"刚才很卡"的用法一致
    while (result.records.length > 0 && jsonSize(result) > MAX_PAYLOAD_BYTES) {
      result.records.shift();
      omitted.byPayload += 1;
    }
    result.truncated = omitted.byLimit > 0 || omitted.byPayload > 0;
    result.detailComplete =
      omitted.perfBelowThreshold === 0 && omitted.byLimit === 0 && omitted.byPayload === 0;
    if (omitted.perfBelowThreshold > 0 || omitted.byLimit > 0 || omitted.byPayload > 0) {
      notes.push(
        `明细非全量（低于 ${minDurationMs}ms ${omitted.perfBelowThreshold} 条、超出 limit ${omitted.byLimit} 条、超体积 ${omitted.byPayload} 条）；次数与耗时以 summary 为准。`,
      );
    }
    return result;

    function findMark(idOrLabel: string): TimelineMark | undefined {
      for (let index = marks.length - 1; index >= 0; index -= 1) {
        const candidate = marks[index];
        if (candidate && (candidate.id === idOrLabel || candidate.label === idOrLabel)) return candidate;
      }
      return undefined;
    }

    function buildSummary(
      windowRecords: StoredRecord[],
      activeLayers: Set<string>,
      nameFilter: string,
      threshold: number,
      reference: number,
    ): Record<string, unknown> {
      const summary: Record<string, unknown> = {};

      if (activeLayers.has("perf")) {
        const componentsByKey = new Map<
          string,
          { name: string; nodeId?: string; count: number; totalMs: number; maxMs: number }
        >();
        let totalMs = 0;
        const perf = windowRecords.filter((record) => record.layer === "perf");
        for (const record of perf) {
          const dur = record.dur ?? 0;
          totalMs += dur;
          const key = record.nodeId ?? record.name;
          const entry = componentsByKey.get(key) ?? {
            name: record.name,
            ...(record.nodeId ? { nodeId: record.nodeId } : {}),
            count: 0,
            totalMs: 0,
            maxMs: 0,
          };
          entry.count += 1;
          entry.totalMs = round2(entry.totalMs + dur);
          entry.maxMs = Math.max(entry.maxMs, dur);
          componentsByKey.set(key, entry);
        }
        const byComponent = [...componentsByKey.values()]
          .sort((a, b) => b.totalMs - a.totalMs)
          .slice(0, 10);
        const slowest = [...perf]
          .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
          .slice(0, 5)
          .map((record) => ({
            name: record.name,
            kind: record.kind,
            dur: record.dur ?? 0,
            at: round2(record.at - reference),
            ...(record.nodeId ? { nodeId: record.nodeId } : {}),
          }));
        summary.perf = {
          operations: perf.length,
          totalMs: round2(totalMs),
          thresholdMs: threshold,
          byComponent,
          slowest,
        };
      }

      if (activeLayers.has("lifecycle")) {
        const stats = [...components.values()].filter(
          (stat) => !nameFilter || stat.name.toLowerCase().includes(nameFilter),
        );
        summary.lifecycle = {
          sinceMs: round2(reference - startedAt),
          note: "累计计数（自页面加载/上次 clear 起），不受 windowMs 影响；added/updated/removed 为全页精确累计，component 过滤只作用于 byComponent",
          // 用精确累计而不是逐组件求和：逐组件表有上限，淘汰后求和会静默少报
          added: lifecycleTotals.added,
          updated: lifecycleTotals.updated,
          removed: lifecycleTotals.removed,
          trackedComponents: components.size,
          // >0 表示组件数超过逐组件表上限，byComponent 只是其中一部分
          componentEvictions,
          byComponent: stats
            .sort((a, b) => b.updated - a.updated)
            .slice(0, 10)
            .map((stat) => ({
              name: stat.name,
              nodeId: stat.nodeId,
              added: stat.added,
              updated: stat.updated,
              removed: stat.removed,
            })),
        };
      }

      if (activeLayers.has("emit")) {
        const emits = new Map<string, { name: string; event: string; count: number; at: number }>();
        for (const record of windowRecords.filter((record) => record.layer === "emit")) {
          const event = readEventName(record.data);
          const key = `${record.name}|${event}`;
          const entry = emits.get(key) ?? { name: record.name, event, count: 0, at: record.at };
          entry.count += 1;
          entry.at = record.at;
          emits.set(key, entry);
        }
        summary.emit = [...emits.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, 10)
          .map((entry) => ({
            name: entry.name,
            event: entry.event,
            count: entry.count,
            at: round2(entry.at - reference),
          }));
      }

      if (activeLayers.has("navigate")) {
        summary.navigate = windowRecords
          .filter((record) => record.layer === "navigate")
          .slice(-10)
          .map((record) => ({ ...(record.data as Record<string, unknown>), at: round2(record.at - reference) }));
      }

      if (activeLayers.has("agent")) {
        summary.agent = windowRecords
          .filter((record) => record.layer === "agent")
          .slice(-10)
          .map((record) => ({ label: record.name, at: round2(record.at - reference) }));
      }

      return summary;
    }
  }

  return { get, mark, clear, attachRouters, dispose };
}

function normalizeLayers(input?: string[]): Set<string> {
  const allowed = new Set<string>(VUE_DEVTOOLS_TIMELINE_LAYERS);
  if (!Array.isArray(input) || input.length === 0) return allowed;
  const picked = input.filter((layer) => allowed.has(layer));
  return new Set(picked.length > 0 ? picked : allowed);
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    // 序列化失败说明结果里有不可序列化的值：此时"体积未知"，绝不能当成 0 放过上限，
    // 否则 host 侧 JSON.stringify 会抛错。返回 Infinity 让调用方按超限裁剪（并置 truncated）。
    return Number.POSITIVE_INFINITY;
  }
}
