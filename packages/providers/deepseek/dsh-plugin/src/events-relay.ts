/**
 * 宿主 → core 事件中继（恢复 thinking / running 事件指示，对齐旧 events.mux/host 下推能力）。
 *
 * dsh 0.1.2+ 移除了全局下推事件流，宿主侧保留两路官方信号：
 *   1. `agent/status`（@deepseek-ai/dsh-agent）：会话运行态的权威来源（idle ⇄ running）；
 *   2. `session/event`（@deepseek-ai/dsh-session 总线）：turn/step/assistant 过程事件与标题。
 *
 * 本模块据此归一化为 core 的 ProviderEvent（session.status / thinking / session.updated）
 * 推送 HOST_EVENTS_API_PATH（带每轮启动随机令牌）：
 *   - agent/status running ⇄ idle → session.status running ⇄ idle；
 *   - session/event turn/start·step/start·assistant/chunk → thinking=true，
 *     assistant/message·turn/end → thinking=false；
 *   - session/title → session.updated（会话列表标题实时刷新）。
 *
 * 取舍：推送失败静默降级（不影响会话/诊断）；无令牌或 vitePort 缺失时不启用；
 * 定时器全部 unref + 自调度，事件静止后无残留定时器。
 * 类型说明：两路信号载荷与出站事件均引用官方单一来源，不在此维护结构副本。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent, AgentStatus } from "@deepseek-ai/dsh-agent";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ProviderEvent } from "@aipanel/core";
import { createLogger, HOST_EVENTS_API_PATH } from "@aipanel/core/node";

const log = createLogger("DshEventRelay");

/** 归一化后的界面状态（running 与 thinking 分开跟踪，均只外发迁移） */
interface SessionUiState {
  running: boolean;
  thinking: boolean;
}

/** 批量节流窗口（ms）：chunk 高频事件在窗口内合并成一次推送 */
const FLUSH_DELAY_MS = 120;

/** session 事件类型 → thinking 迁移（running 由官方 agent/status 权威提供） */
function thinkingOf(type: string): boolean | null {
  switch (type) {
    case "turn/start":
    case "step/start":
    case "assistant/chunk":
      return true;
    case "assistant/message":
    case "turn/end":
      return false;
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
  const eventsPath = config.eventsPath ?? HOST_EVENTS_API_PATH;
  const eventsUrl = `http://127.0.0.1:${vitePort}${eventsPath}`;

  const states = new Map<string, SessionUiState>();
  const lastSent = new Map<string, SessionUiState>();
  /** 已推送的标题（按 session 去重：同名/同内容标题只外发一次） */
  const lastTitles = new Map<string, string>();
  const dirty = new Set<string>();

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

  const ensureState = (sessionId: string): SessionUiState => {
    let s = states.get(sessionId);
    if (s === undefined) {
      s = { running: false, thinking: false };
      states.set(sessionId, s);
    }
    return s;
  };

  /** 官方 agent/status：running/idle 的权威来源（agent.session.id 即会话 id） */
  const handleAgentStatus = ({ agent, status }: { agent: Agent; status: AgentStatus }) => {
    const sessionId = String(agent.session.id);
    if (!sessionId) return;
    const running = status === "running";
    const s = ensureState(sessionId);
    if (s.running === running) return;
    s.running = running;
    // 会话进入 idle 即无任何活动：thinking 一并复位
    if (!running) s.thinking = false;
    markDirty(sessionId);
  };

  /** session/event：标题同步 + thinking 迁移（running 由 agent/status 负责） */
  const handleSessionEvent = (session: Session, event: SessionEvent) => {
    const sessionId = String(session?.id ?? "");
    if (!sessionId) return;
    const type: string = typeof event?.type === "string" ? event.type : "";

    // === 标题变更（自动生成 / 用户改名）：映射为 session.updated 单独推送 ====
    if (type === "session/title") {
      const titleData = (event as { data?: { title?: unknown } }).data;
      const title = typeof titleData?.title === "string" ? titleData.title.trim() : "";
      if (title.length > 0 && title !== lastTitles.get(sessionId)) {
        lastTitles.set(sessionId, title);
        const ts = (event as { time?: unknown }).time;
        post({
          type: "session.updated",
          session: {
            id: sessionId,
            title,
            updatedAt: typeof ts === "number" ? ts : Date.now(),
          },
        });
      }
      return;
    }

    // === thinking 迁移 ====
    const thinking = thinkingOf(type);
    if (thinking === null) return;
    const s = ensureState(sessionId);
    if (s.thinking === thinking) return;
    s.thinking = thinking;
    markDirty(sessionId);
  };

  /** 只外发与上次已发送状态不同的迁移 */
  const flush = () => {
    const pending = [...dirty];
    dirty.clear();
    for (const sessionId of pending) {
      const s = states.get(sessionId);
      if (s === undefined) continue;
      const last = lastSent.get(sessionId);
      const events: ProviderEvent[] = [];
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
  const post = (event: ProviderEvent) => {
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

  // ==== 1) 官方 agent/status：running/idle（root ctx 监听全部 agent） ====
  ctx.on("agent/status", handleAgentStatus);

  // ==== 2) session/event：thinking 迁移 + 标题同步 ====
  ctx.on("session/event", handleSessionEvent, { global: true });
}
