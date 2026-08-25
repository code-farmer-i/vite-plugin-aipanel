/**
 * AIPanel 浏览器侧插件（dsh Web Client bundle）
 *
 * 经 dsh 的 dsh.client 契约被 __DSH_BOOT__ 自动激活。注册 `@aipanel` 文件引用 source：
 *   - candidates 读取 bridge 写入的 localStorage('dsh.bridge.selection') —— 最近选中元素
 *   - onPick 铸造 appearance:'file' 的 ReferenceInsert（输入框高亮）
 *   - codec.serialize 决定模型最终看到的文本（让 agent 自行解析）
 *
 */
import type {
  InputTriggerCandidate,
  InputTriggerSource,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { Context } from "@deepseek-ai/cordis";

const SELECTION_STORAGE_KEY = "dsh.bridge.selection";

/** 桥接层监听的自定义事件：确认目标会话已激活且渲染稳定（detail.sessionId 为当前会话） */
export const SESSION_READY_EVENT = "aipanel:session-ready";

/**
 * 会话就绪确认所需的最小稳态时长（毫秒）。
 * current 在该窗口期内保持不变即视为"已稳定"，此时才通知桥接层放行 loading。
 */
const SESSION_SETTLE_MS = 400;

/** bridge 写入 localStorage 的最近选中元素 */
interface SelectedElement {
  filePath?: string;
  line?: number;
  description?: string;
  innerText?: string;
}

/** 构造 model 可见的引用文本（agent 自行解析） */
function serializeElement(ref: string): string {
  return `@AIPanel 选中元素: ${ref}`;
}

/** 把选中元素铸成候选（name=展示标签，value=不透明 pick 载荷，即 "filePath:line|selector"） */
function toCandidate(e: SelectedElement): InputTriggerCandidate {
  const line = e.line != null ? `:${e.line}` : "";
  const selector = e.description ? `|${e.description}` : "";
  const location = `${e.filePath || ""}${line}`;
  return {
    name: location,
    description: e.description || e.innerText || undefined,
    value: `${location}${selector}`,
  };
}

/** 读 bridge 写入的最近选中元素候选 */
function readSelectionCandidates(): InputTriggerCandidate[] {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return [];
    const elements = JSON.parse(raw) as SelectedElement[];
    if (!Array.isArray(elements)) return [];
    return elements
      .filter((e): e is SelectedElement => !!e && typeof e === "object")
      .slice(0, 20)
      .map(toCandidate);
  } catch {
    return [];
  }
}

export function apply(ctx: Context) {
  const inputTriggers = ctx.get("inputTriggers");
  if (!inputTriggers) return;

  const source: InputTriggerSource = {
    trigger: "@",
    name: "aipanel",
    order: 300,
    showGroupTitle: false,

    // 候选 = 最近选中元素（bridge 写入），按输入查询过滤
    candidates: async (_session, req) => {
      const all = readSelectionCandidates();
      const query = req.query.trim().toLowerCase();
      if (!query) return all;
      return all.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.description ?? "").toLowerCase().includes(query),
      );
    },

    // 选定 → 铸造 file 引用（appearance:'file'）
    onPick: (pick) => ({
      insert: {
        source: "aipanel",
        ref: pick.candidate.value ?? pick.candidate.name,
        label: pick.candidate.name,
        appearance: "file",
        clipboardText: pick.candidate.value ?? pick.candidate.name,
      },
    }),

    // 模型投影
    codec: {
      clipboardText: (ref) => ref,
      serialize: async (ref) => serializeElement(ref),
    },
  };

  ctx.effect(() => inputTriggers.registerSource(source), "aipanel: @ source");

  // === 会话就绪确认：下游 loading 只在目标会话激活且渲染稳定后放行 ===
  // dsh 的选中态随 sessions.list.current（持久化于 dsh.sessions.current）在启动
  // / 切会话后恢复；等 current 落到某个会话并稳定一个窗口期，再通知桥接层上报
  // SESSION_READY，由客户端决定何时隐藏"加载会话"蒙层。
  const sessions = ctx.get("sessions");
  if (sessions && sessions.list) {
    let lastCurrent: string | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const notifyBridge = (sessionId: string) => {
      try {
        window.dispatchEvent(new CustomEvent(SESSION_READY_EVENT, { detail: { sessionId } }));
      } catch {
        /* ignore */
      }
    };

    const probe = () => {
      const snapshot = sessions.list.getSnapshot();
      const current = snapshot?.current;
      // current 变空（列表刷新 / 会话被移除）→ 取消未确认的稳态计时
      if (!current) {
        lastCurrent = undefined;
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        return;
      }
      if (current === lastCurrent) return; // 未变化，等待既有计时到期
      lastCurrent = current;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        // 到期时再核对一次，确认 current 在整个窗口期内未再变化
        if (sessions.list.getSnapshot()?.current === current) {
          notifyBridge(current);
        }
      }, SESSION_SETTLE_MS);
    };

    probe();
    const dispose = sessions.list.subscribe(probe);
    ctx.effect(() => dispose, "aipanel: session-ready watcher");
  }
}
