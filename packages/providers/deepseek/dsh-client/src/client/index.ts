/**
 * AIPanel 浏览器侧插件（dsh Web Client bundle）
 *
 * 经 dsh 的 dsh.client 契约被 __DSH_BOOT__ 自动激活。注册 `@aipanel` 引用 source：
 *   - candidates 读取 bridge 写入的 localStorage('dsh.bridge.selection') —— 最近选中元素
 *   - onPick 铸造 appearance:'file' 的 ReferenceInsert（输入框高亮）
 *   - codec.serialize 输出 `@节点[n<id>]` 标记（无空格无斜杠，天然满足高亮 token 语法）；
 *     完整节点上下文不进会话文本，由 host 端 dsh-plugin 在 agent/pre-step 按 id
 *     从核心层 context 端点反查后注入（plugin source）。
 */
import type {
  InputTriggerCandidate,
  InputTriggerSource,
  ReferenceInsert,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { Context } from "@deepseek-ai/cordis";
import { registerDiagnosticsView } from "./diagnostics-view";

const SELECTION_STORAGE_KEY = "dsh.bridge.selection";

/** cordis 插件服务注入声明：诊断卡片视图需要访问 ctx.slots（官方 ui-tool 同款姿势） */
export const inject = ["slots"];

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
  /** 插件生成的节点唯一 id（插入引用时赋值，随 ref 持久化；serialize 标记与注入上下文共用） */
  id?: string;
  filePath?: string;
  line?: number;
  description?: string;
  innerText?: string;
  previewPageUrl?: string;
  previewPageTitle?: string;
}

/**
 * 取（或生成）元素的节点唯一 id：优先复用已赋值的 id（client 侧 App.vue 分配后随
 * bridge 写入 localStorage），否则兜底生成随机 id 并写回元素。id 与核心层
 * selectedElements 里的一致，host 端 dsh-plugin 据此反查并注入上下文。
 */
function ensureNodeId(e: SelectedElement): string {
  if (e.id) return e.id;
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  e.id = `n${random}`;
  return e.id;
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
 * 构造 model 可见的引用文本：只带节点 id（`@节点[n<id>]`）。
 * 标记无空格无斜杠，天然满足高亮 token 语法（@/[^\s]+/），无需格式化转义；
 * id 可区分同 selector 的多个实例。完整节点上下文不进会话文本，由 host 端
 * dsh-plugin 在 agent/pre-step 按 id 反查核心层 context 端点后注入（plugin source）。
 */
function serializeElement(ref: string): string {
  try {
    const e = JSON.parse(ref) as SelectedElement;
    if (!e || typeof e !== "object") throw new Error("not an element payload");
    return `@节点[${ensureNodeId(e)}]`;
  } catch {
    return `@${ref}`;
  }
}

/**
 * 把选中元素铸成 ReferenceInsert。
 * label 不带 @（chip 的 title / 完整标签）；clipboardText 必须以 @ 开头——
 * dsh 输入框 backdrop 用 clipboardText[0] 作为 chip 的触发字符 glyph、slice(1) 作为名字，
 * 去掉 @ 会导致 glyph 错乱（显示成"节"字）。
 */
function toReference(e: SelectedElement): ReferenceInsert {
  const mark = `节点[${ensureNodeId(e)}]`;
  return {
    source: "aipanel",
    ref: elementContextRef(e),
    label: mark,
    appearance: "file",
    clipboardText: `@${mark}`,
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
  // 注册 run_diagnostics 诊断卡片视图（host 端 presentationMeta 持久化的结构化诊断）
  registerDiagnosticsView(ctx);

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

    // 选定 → 铸造 file 引用：ref/label 分离（label 短，ref 携带完整元素 + 节点 id）
    onPick: (pick) => {
      try {
        const parsed = JSON.parse(pick.candidate.value ?? "null") as SelectedElement | null;
        if (parsed) {
          ensureNodeId(parsed);
          return {
            insert: {
              source: "aipanel",
              ref: JSON.stringify(parsed),
              label: pick.candidate.name,
              appearance: "file",
              // clipboardText 以 @ 开头（dsh backdrop 取首字符作 chip 触发 glyph）
              clipboardText: `@${pick.candidate.name}`,
            },
          };
        }
      } catch {
        /* ignore */
      }
      return {
        insert: {
          source: "aipanel",
          ref: pick.candidate.value ?? pick.candidate.name,
          label: pick.candidate.name,
          appearance: "file",
          clipboardText: `@${pick.candidate.name}`,
        },
      };
    },

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

  // === 选中元素 → 立即插入当前会话输入框 ===
  // 与 opencode 交互一致：用户选中元素（AIPanel 选择模式）后，bridge 派发
  // aipanel:insert-element，这里把元素以 file chip 插入当前会话输入框（光标处，
  // 必要时前置空格保证气泡高亮），并把焦点与光标移回 chip 之后。
  // 提交时由 @aipanel source 的 codec 序列化为模型可见文本。
  const conversation = ctx.get("conversation");
  const insertElementListener = (event: Event) => {
    const detail = (event as CustomEvent).detail as { element?: SelectedElement } | undefined;
    const element = detail?.element;
    if (!element) return;
    const current = sessions?.list?.getSnapshot()?.current;
    if (!current) return;
    try {
      const actx = sessions?.scope?.(current);
      if (!actx) return;
      const input = conversation?.input?.for?.(actx);
      if (!input || typeof input.insertReference !== "function") return;
      const snapshot = input.state?.getSnapshot?.();
      if (!snapshot) return;
      // dsh（文本机器实现）的 InputState.draft 是纯文本：chip 展开为 `@节点[n<id>]` 完整文本，
      // occurrence.offset/length 与 insertReference 的 span 都直接按该文本坐标切片。
      // 输入框 textarea 的 value 即 draft 投影，selectionStart/End 可直接用作插入位置。
      // 不依赖 activeElement：选中页面元素时输入框会失焦，但 textarea 的 selectionStart
      // 仍保留上次光标位置；用 value 与 draft 一致来确认是当前会话的输入框。
      let start = snapshot.draft.length;
      let end = snapshot.draft.length;
      try {
        const el = document.querySelector("textarea[data-phase]") as HTMLTextAreaElement | null;
        if (el && el.value === snapshot.draft) {
          const s = el.selectionStart ?? 0;
          const e = el.selectionEnd ?? s;
          start = Math.min(s, snapshot.draft.length);
          end = Math.min(e, snapshot.draft.length);
        }
      } catch {
        /* ignore */
      }
      const reference = toReference(element);
      // 插入后新 chip 的文本长度 = clipboardText（`@节点[n<id>]`）+ 分隔空格（尾部已有空格则无）
      const gap = snapshot.draft.slice(end)[0] === " " ? 0 : 1;
      const insertedLen = reference.clipboardText.length + gap;
      // 前置空格：dsh 气泡高亮要求 @ 标记前是行首或空白（/(^|\s)@[^\s]+/），
      // 紧贴文字（如"的@节点[n...]"）不会高亮；插入点前一个字符非空白时先补一个空格。
      let leadingSpace = 0;
      let rev = snapshot.draftRev;
      // rc.2 类型未含 insertText（运行时存在），按运行态形状收窄
      const insertable = input as unknown as {
        insertText?: (
          text: string,
          opts: { start: number; end: number; draftRev: unknown },
        ) => boolean;
      };
      if (start > 0 && !/\s/.test(snapshot.draft[start - 1])) {
        try {
          if (insertable.insertText?.(" ", { start, end, draftRev: rev })) {
            const next = input.state?.getSnapshot?.();
            if (next) {
              leadingSpace = 1;
              start += 1;
              end += 1;
              rev = next.draftRev;
            }
          }
        } catch {
          /* ignore */
        }
      }
      input.insertReference(reference, { start, end, draftRev: rev });
      // 把焦点放回输入框，并把光标定位到新插入 chip 之后（等渲染提交后再设置 selection）
      requestAnimationFrame(() => {
        try {
          const el = document.querySelector("textarea[data-phase]") as HTMLTextAreaElement | null;
          if (!el) return;
          const caret = Math.min(start + insertedLen + leadingSpace, el.value.length);
          el.focus();
          el.setSelectionRange(caret, caret);
        } catch {
          /* ignore */
        }
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
