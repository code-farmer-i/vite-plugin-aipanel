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
  ReferenceInsert,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { Context } from "@deepseek-ai/cordis";

const SELECTION_STORAGE_KEY = "dsh.bridge.selection";

/** 桥接层监听的自定义事件：确认目标会话已激活且渲染稳定（detail.sessionId 为当前会话） */
export const SESSION_READY_EVENT = "aipanel:session-ready";

/** 桥接层派发的自定义事件：用户选中了一个元素，需追加到当前会话对话框（detail.element 为选中元素） */
export const INSERT_ELEMENT_EVENT = "aipanel:insert-element";

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
  previewPageUrl?: string;
  previewPageTitle?: string;
}

/** 短标签（chip / @ 菜单展示，不含完整的 filePath:line 长尾） */
function elementLabel(e: SelectedElement): string {
  if (e.description) return e.description;
  const text = e.innerText?.trim();
  if (text) return text.slice(0, 40);
  return "元素";
}

/** 不透明引用：携带完整元素上下文（提交时由 codec.serialize 还原成全文，对标 opencode 的 nodeContext） */
function elementContextRef(e: SelectedElement): string {
  return JSON.stringify(e);
}

/**
 * 构造 model 可见的引用文本。与 opencode 的文件引用标签一致：`@选择器(文本预览)`。
 * dsh 会话显示文本 = 模型收到的序列化文本（同一份），所以这里用短单行，
 * 避免把完整路径/上下文块直接铺进会话。ref 仍是元素上下文 JSON，供此项解析出标签。
 */
function serializeElement(ref: string): string {
  try {
    const e = JSON.parse(ref) as SelectedElement;
    if (!e || typeof e !== "object") throw new Error("not an element payload");
    // 高亮 token 语法（@/[^\s]+/）遇空白即断开、按 [\\/] 取 basename。用 dsh 引号形式
    // @"..."（/[@"[^"\n]+"/）包裹：既保留类选择器里的空格（后代选择器语义），又能整条高亮。
    // 引号内不允许出现 " 和换行，需一并清洗；/ 和 \ 换成全角等价字符，避免被当路径切分。
    const safe = (s: string) =>
      s.replace(/[\\/]/g, (m) => (m === "/" ? "／" : "＼")).replace(/["\n\r]+/g, " ");
    const selector = safe(e.description || "element");
    const text = e.innerText?.trim();
    const textPreview = text ? (text.length > 5 ? text.slice(0, 5) + "..." : text) : "";
    const body = `选中元素:${selector}${textPreview ? `(${safe(textPreview)})` : ""}`;
    return `@"${body}"`;
  } catch {
    return `@${ref}`;
  }
}

/** 把选中元素铸成 ReferenceInsert：label/clipboard 用短标签，ref 携带完整元素上下文 */
function toReference(e: SelectedElement): ReferenceInsert {
  const label = elementLabel(e);
  return {
    source: "aipanel",
    ref: elementContextRef(e),
    label,
    appearance: "file",
    clipboardText: label,
  };
}

/** 把选中元素铸成候选：name 短标签，value 携带完整元素上下文（供 onPick 铸成 ref） */
function toCandidate(e: SelectedElement): InputTriggerCandidate {
  return {
    name: elementLabel(e),
    description: e.description || e.innerText || undefined,
    value: elementContextRef(e),
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

    // 选定 → 铸造 file 引用：ref/label 分离（label 短，ref 携完整上下文）
    onPick: (pick) => ({
      insert: {
        source: "aipanel",
        ref: pick.candidate.value ?? pick.candidate.name,
        label: pick.candidate.name,
        appearance: "file",
        clipboardText: pick.candidate.name,
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

  // === 选中元素 → 立即追加到当前会话对话框 ===
  // 与 opencode 交互一致：用户选中元素（AIPanel 选择模式）后，bridge 派发
  // aipanel:insert-element，这里把元素以 file chip 追加到当前会话的输入框末尾。
  // 走官方 input-trigger 的 insertReference（span 取 draft 末尾 + 当前 draftRev CAS），
  // 提交时由 @aipanel source 的 codec 序列化为模型可见文本。
  const conversation = ctx.get("conversation");
  const insertElementListener = (event: Event) => {
    const detail = (event as CustomEvent).detail as { element?: SelectedElement } | undefined;
    const element = detail?.element;
    if (!element) return;
    const current = sessions?.list?.getSnapshot()?.current;
    if (!current) return;
    try {
      const actx = sessions.scope?.(current);
      const input = conversation?.input?.for?.(actx);
      if (!input || typeof input.insertReference !== "function") return;
      const snapshot = input.state?.getSnapshot?.();
      if (!snapshot) return;
      const at = snapshot.draft.length;
      input.insertReference(toReference(element), {
        start: at,
        end: at,
        draftRev: snapshot.draftRev,
      });
    } catch {
      // 注入失败静默：仍可从 @aipanel 菜单手动插入
    }
  };
  window.addEventListener(INSERT_ELEMENT_EVENT, insertElementListener as EventListener);
  ctx.effect(
    () => () =>
      window.removeEventListener(INSERT_ELEMENT_EVENT, insertElementListener as EventListener),
    "aipanel: insert-element listener",
  );
}
