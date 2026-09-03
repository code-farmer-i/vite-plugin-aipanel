/**
 * 宿主 → core 事件中继（恢复 thinking / running 事件指示，对齐旧 events.mux/host 下推能力）。
 *
 * dsh 0.1.2+ 移除了全局下推事件流，但宿主侧仍保留 Cordis 总线事件 `session/event`
 * （签名 (session, event)，event = { type, seq, time, data }，与持久化会话日志同源）。
 * 本模块监听该总线，把 turn/step/assistant 等事件归一化为 ProviderEvent：
 *   - turn/start / step/start / assistant/chunk → thinking=true（会话在产出）；
 *   - assistant/message / turn/end → thinking=false；
 *   - turn/end 后若无新活动（去抖窗口）→ session.status idle；turn/start → running。
 * 状态只发送"迁移"（按 session 去重 + 批量节流），并携带 core 每轮启动的随机令牌
 * POST 到 HOST_EVENTS_API_PATH；core 校验后按 SESSION_EVENT 广播给 AIPanel 挂件。
 *
 * 取舍：推送失败静默降级（不影响会话/诊断）；无令牌或 vitePort 缺失时不启用；
 * 定时器全部 unref + 自调度，事件静止后无残留定时器。
 */
import type { Context } from "@deepseek-ai/cordis";
import { createLogger } from "@aipanel/core/node";

const log = createLogger("DshEventRelay");

/** 事件推送路径兜底（与 @aipanel/core 的 HOST_EVENTS_API_PATH 保持一致；优先取 config 注入值） */
const DEFAULT_EVENTS_API_PATH = "/__aipanel_host_events__";

/** session/event 总线的最小对象形态（避免引入 @deepseek-ai/dsh-session 运行时依赖） */
interface RelaySession {
  readonly id: string;
}

interface RelaySessionEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
}

/** 归一化后的界面状态（running 与 thinking 分开跟踪，均只外发迁移） */
interface SessionUiState {
  running: boolean;
  thinking: boolean;
}

type RelayEventType =
  | { type: "session.status"; sessionId: string; status: "idle" | "running" }
  | { type: "thinking"; sessionId: string; thinking: boolean };

/** 批量节流窗口（ms）：chunk 高频事件在窗口内合并成一次推送 */
const FLUSH_DELAY_MS = 120;
/** turn/end 后判定会话真正进入 idle 的去抖窗口（ms） */
const IDLE_DEBOUNCE_MS = 1200;

/** 事件类型 → 需要外发的状态迁移（返回 null 表示无需变更） */
function transitionOf(type: string): { running?: boolean; thinking?: boolean } | null {
  switch (type) {
    case "turn/start":
      return { running: true, thinking: true };
    case "step/start":
    case "assistant/chunk":
      return { thinking: true };
    case "assistant/message":
      return { thinking: false };
    case "turn/end":
      // running 由 idle 去抖器判定（避免连续 turn 的闪烁），这里只停 thinking
      return { thinking: false };
    default:
      return null;
  }
}

/** 启动宿主事件中继；配置不满足（无令牌/无端口）时为空操作。 */
export function setupEventRelay(
  ctx: Context,
  config: {
    vitePort?: number;
    eventsPath?: string;
    eventsToken?: string;
  },
): void {
  const vitePort = config.vitePort ?? 0;
  const token = config.eventsToken;
  if (!token || vitePort <= 0) return;
  const eventsPath = config.eventsPath ?? DEFAULT_EVENTS_API_PATH;
  const eventsUrl = `http://127.0.0.1:${vitePort}${eventsPath}`;

  const states = new Map<string, SessionUiState>();
  const lastSent = new Map<string, SessionUiState>();
  const dirty = new Set<string>();
  const idleTimers = new Map<string, NodeJS.Timeout>();

  let flushTimer: NodeJS.Timeout | null = null;
  let lastPostErrorAt = 0;

  const scheduleFlush = () => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_DELAY_MS);
    flushTimer.unref?.();
  };

  const markDirty = (sessionId: string) => {
    dirty.add(sessionId);
    scheduleFlush();
  };

  /** turn/end 后延迟判 idle：窗口内有新活动则取消（连续 turn 不闪烁） */
  const scheduleIdleCheck = (sessionId: string) => {
    const existing = idleTimers.get(sessionId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      idleTimers.delete(sessionId);
      const s = states.get(sessionId);
      if (s !== undefined && s.running) {
        s.running = false;
        markDirty(sessionId);
      }
    }, IDLE_DEBOUNCE_MS);
    timer.unref?.();
    idleTimers.set(sessionId, timer);
  };

  const handleSessionEvent = (session: RelaySession, event: RelaySessionEvent) => {
    const sessionId = session?.id;
    if (!sessionId || !event || typeof event.type !== "string") return;

    // 任何新活动都会取消"待判 idle"定时器
    const idleTimer = idleTimers.get(sessionId);
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimers.delete(sessionId);
    }

    const tr = transitionOf(event.type);
    if (tr === null) return;
    let s = states.get(sessionId);
    if (s === undefined) {
      s = { running: false, thinking: false };
      states.set(sessionId, s);
    }
    const next = {
      running: tr.running !== undefined ? tr.running : s.running,
      thinking: tr.thinking !== undefined ? tr.thinking : s.thinking,
    };
    const changed = next.running !== s.running || next.thinking !== s.thinking;
    s.running = next.running;
    s.thinking = next.thinking;
    if (event.type === "turn/end") scheduleIdleCheck(sessionId);
    if (changed) markDirty(sessionId);
  };

  /** 只外发与上次已发送状态不同的迁移 */
  const flush = () => {
    const pending = [...dirty];
    dirty.clear();
    for (const sessionId of pending) {
      const s = states.get(sessionId);
      if (s === undefined) continue;
      const last = lastSent.get(sessionId);
      const events: RelayEventType[] = [];
      if (last === undefined || last.running !== s.running) {
        events.push({
          type: "session.status",
          sessionId,
          status: s.running ? "running" : "idle",
        });
      }
      if (last === undefined || last.thinking !== s.thinking) {
        events.push({ type: "thinking", sessionId, thinking: s.thinking });
      }
      if (events.length === 0) continue;
      lastSent.set(sessionId, { running: s.running, thinking: s.thinking });
      for (const event of events) post(event);
    }
  };

  let inflight: Promise<void> = Promise.resolve();
  const post = (event: RelayEventType) => {
    const payload = JSON.stringify({ token, event });
    inflight = inflight.then(async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(eventsUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok && Date.now() - lastPostErrorAt > 5000) {
          lastPostErrorAt = Date.now();
          log.warn("host event relay push failed", { status: res.status });
        }
      } catch {
        // 推送失败静默降级：core 不可达时不影响 dsh 会话运行
      }
    });
  };

  // 与官方消费方一致：root ctx 上注册 global 监听可收到全部会话的 session/event
  const bus = ctx as unknown as {
    on(
      event: "session/event",
      listener: (session: RelaySession, event: RelaySessionEvent) => void,
      options?: { global?: boolean },
    ): () => void;
  };
  bus.on("session/event", handleSessionEvent, { global: true });
}
