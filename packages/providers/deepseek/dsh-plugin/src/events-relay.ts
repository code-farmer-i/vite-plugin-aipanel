/**
 * 宿主 → core 事件中继（恢复 thinking / running 事件指示，对齐旧 events.mux/host 下推能力）。
 *
 * dsh 0.1.2+ 移除了全局下推事件流，宿主侧保留四路官方信号：
 *   1. `agent/status`（@deepseek-ai/dsh-agent）：会话运行态的权威来源（idle ⇄ running）；
 *   2. `session/event`（@deepseek-ai/dsh-session 总线）：turn/step/assistant 过程事件与标题；
 *   3. `approval/request`（@deepseek-ai/dsh-user-approval）：工具审批等待用户；
 *   4. `user-questions/request`（@deepseek-ai/dsh-user-questions）：提问/计划评审等待用户。
 *
 * 本模块据此归一化为 core 的 ProviderEvent（session.status / thinking / session.updated /
 * session.pending）推送 HOST_EVENTS_API_PATH（带每轮启动随机令牌）：
 *   - agent/status running ⇄ idle → session.status running ⇄ idle；
 *   - session/event turn/start·step/start·assistant/chunk → thinking=true，
 *     assistant/message·turn/end → thinking=false；
 *   - session/title → session.updated（会话列表标题实时刷新）；
 *   - approval/request、user-questions/request 在途 → session.pending（旁观透传，不改结果）。
 *
 * 取舍：推送失败静默降级（不影响会话/诊断）；无令牌或 vitePort 缺失时不启用；
 * 定时器全部 unref + 自调度，事件静止后无残留定时器。
 * 类型说明：两路信号载荷与出站事件均引用官方单一来源，不在此维护结构副本。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent, AgentStatus } from "@deepseek-ai/dsh-agent";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import type { ApprovalRequestEvent } from "@deepseek-ai/dsh-user-approval/types";
import type { AskUserQuestionAnswer } from "@deepseek-ai/dsh-user-questions";
import type { AskUserQuestionRequestEvent } from "@deepseek-ai/dsh-user-questions/types";
import type { ProviderEvent, SessionPendingKind } from "@aipanel/core";
import { createLogger, HOST_EVENTS_API_PATH } from "@aipanel/core/node";

const log = createLogger("DshEventRelay");

/** 归一化后的界面状态（running / thinking / pending 分开跟踪，均只外发迁移） */
interface SessionUiState {
  running: boolean;
  thinking: boolean;
  /** 是否存在待用户交互（approval/request 或 user-questions/request 在途） */
  pending: boolean;
  /** 待交互类型（pending=true 时有值；单一来源 @aipanel/core SessionPendingKind） */
  pendingKind?: SessionPendingKind;
  /** 进行中的子代理会话数（父会话自身 idle 但子代理在跑时 >0） */
  subagentRunning: number;
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
    viteHost?: string;
    eventsPath?: string;
    eventsToken?: string;
  },
): void {
  const vitePort = config.vitePort ?? 0;
  const viteHost = config.viteHost;
  const token = config.eventsToken;
  if (!token || vitePort <= 0) return;
  // viteHost 是事件回推地址的单一来源，缺失即配置错误，报错并停用中继，不做 127.0.0.1 向下兼容
  //（跨网络/自定义 host 场景下用默认值会把 running/与标题事件推丢，正是本方要杜绝的回归）。
  if (!viteHost) {
    log.error(`host event relay requires a concrete viteHost; relay disabled`, { viteHost });
    return;
  }
  const eventsPath = config.eventsPath ?? HOST_EVENTS_API_PATH;
  const eventsUrl = `http://${viteHost}:${vitePort}${eventsPath}`;

  const states = new Map<string, SessionUiState>();
  const lastSent = new Map<string, SessionUiState>();
  /** 已推送的标题（按 session 去重：同名/同内容标题只外发一次） */
  const lastTitles = new Map<string, string>();
  const dirty = new Set<string>();

  /** 子代理会话归属：子会话 id → 父会话 id（session.header.parentSession，运行期惰性学习） */
  const childOf = new Map<string, string>();
  /** 每个父会话当前进行中的子代理会话 id 集合（running 计数来源） */
  const subagentRunningByParent = new Map<string, Set<string>>();

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
      s = { running: false, thinking: false, pending: false, subagentRunning: 0 };
      states.set(sessionId, s);
    }
    return s;
  };

  /**
   * 更新父会话的子代理运行计数。
   * 子代理 agent 状态迁移（running⇄idle）时调用：running +1、idle -1，
   * 使父会话在"自身 idle、子代理在跑"时仍能推送 session.subagents。
   */
  const updateSubagentCount = (parentId: string, childId: string, running: boolean): void => {
    let set = subagentRunningByParent.get(parentId);
    if (running) {
      if (set === undefined) {
        set = new Set();
        subagentRunningByParent.set(parentId, set);
      }
      set.add(childId);
    } else if (set !== undefined) {
      set.delete(childId);
    }
    const count = set === undefined || set.size === 0 ? 0 : set.size;
    if (set !== undefined && set.size === 0) subagentRunningByParent.delete(parentId);
    const s = ensureState(parentId);
    if (s.subagentRunning !== count) {
      s.subagentRunning = count;
      markDirty(parentId);
    }
  };

  /** 设置/清除 pending 状态（同值不重复入队） */
  const setPending = (sessionId: string, pending: boolean, kind?: SessionPendingKind): void => {
    const s = ensureState(sessionId);
    if (s.pending === pending && s.pendingKind === kind) return;
    s.pending = pending;
    s.pendingKind = pending ? kind : undefined;
    markDirty(sessionId);
  };

  /** 官方 agent/status：running/idle 的权威来源（agent.session.id 即会话 id） */
  const handleAgentStatus = ({ agent, status }: { agent: Agent; status: AgentStatus }) => {
    const sessionId = String(agent.session.id);
    if (!sessionId) return;
    const running = status === "running";

    // 子代理会话（origin=subagent）：其运行不计入自身列表（AIPanel 不单列子代理），
    // 而是归并到父会话的 session.subagents 计数（自身 idle 但子代理在跑时父仍显示进行中）。
    const header = agent.session.header;
    if (header?.origin === "subagent" && header.parentSession !== undefined) {
      const parentId = String(header.parentSession);
      childOf.set(sessionId, parentId);
      updateSubagentCount(parentId, sessionId, running);
      return;
    }

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
      if (last === undefined || last.pending !== s.pending || last.pendingKind !== s.pendingKind) {
        events.push({
          type: "session.pending",
          sessionId,
          pending: s.pending,
          ...(s.pendingKind === undefined ? {} : { kind: s.pendingKind }),
        });
      }
      if (last === undefined || last.subagentRunning !== s.subagentRunning) {
        events.push({ type: "session.subagents", sessionId, running: s.subagentRunning });
      }
      if (events.length === 0) continue;
      lastSent.set(sessionId, {
        running: s.running,
        thinking: s.thinking,
        pending: s.pending,
        pendingKind: s.pendingKind,
        subagentRunning: s.subagentRunning,
      });
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
  // scoped（Scoped<Agent>）事件：root ctx 需 global 才能收到所有 agent
  ctx.on("agent/status", handleAgentStatus, { global: true });

  // ==== 2) session/event：thinking 迁移 + 标题同步 ====
  ctx.on("session/event", handleSessionEvent, { global: true });

  // ==== 3) approval/request（scoped waterfall）：旁观不拦截，只转发 pending ====
  // 进入请求即 pending=true；await next() 拿到决定（或调用方取消/无应答）后复位。
  // 不修改返回值，保证不影响 dsh 官方审批链（ACPC 等同款 next() 透传姿势）。
  ctx.on(
    "approval/request",
    async (request: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>) => {
      const sessionId = String(request.agent?.session?.id ?? "");
      if (!sessionId) return next();
      setPending(sessionId, true, "approval");
      try {
        return await next();
      } finally {
        setPending(sessionId, false);
      }
    },
    // scoped（Scoped<Agent>）事件：root ctx 需 global 才能收到所有 agent
    { global: true },
  );

  // ==== 4) user-questions/request（scoped waterfall）：旁观转发 pending ====
  // kind：载荷任一 question 声明 plan-review intent → plan-review，否则 question。
  ctx.on(
    "user-questions/request",
    async (request: AskUserQuestionRequestEvent, next: () => Promise<AskUserQuestionAnswer>) => {
      const sessionId = String(request.agent?.session?.id ?? "");
      if (!sessionId) return next();
      const isPlanReview = request.questions?.some((q) => q.intent?.kind === "plan-review");
      setPending(sessionId, true, isPlanReview ? "plan-review" : "question");
      try {
        return await next();
      } finally {
        setPending(sessionId, false);
      }
    },
    // scoped（Scoped<Agent>）事件：root ctx 需 global 才能收到所有 agent
    { global: true },
  );
}
