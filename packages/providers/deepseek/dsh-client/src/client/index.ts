/**
 * AIPanel 浏览器侧插件（dsh Web Client bundle）
 *
 * 经 dsh 的 dsh.client 契约被 __DSH_BOOT__ 自动激活。AIPanel × dsh 的“页内”
 * 全部行为都由本插件承载（不再向 HTML 注入 bridge 脚本）：
 *
 *  1. @aipanel 引用 source（@ 菜单 chip）：candidates 读本地最近选中元素，
 *     onPick 铸造 appearance:'file' 的 ReferenceInsert，codec 序列化为 `@节点[n<id>]`；
 *     完整节点上下文不进会话文本，由 host 端 dsh-plugin 在 agent/pre-step 反查注入。
 *  2. 会话聚焦（FOCUS_SESSION）：直接走官方 ctx.sessions.open() —— 无 reload、
 *     无 localStorage 握手；激活稳定后把 SESSION_READY 上报父窗（放行 loading）。
 *  3. 主题同步（SET_THEME）：ctx.theme.setTheme()（官方持久化偏好 + 呈现器落 DOM）。
 *  4. AIPanel 布局：嵌入式（iframe）时隐藏 dsh 侧栏，避免与 AIPanel 自带会话列表重复。
 *  5. 键盘转发（Esc / Ctrl+P）：嵌入式时把按键转交父窗（退出/切换选择模式）。
 *  6. 选中元素即时插入：官方 SessionInput.insertReference() 把元素以 chip 插入输入框。
 *
 * 与 AIPanel 挂件的消息协议（WIDGET_MSG）、元素/诊断等共享类型均直接引用
 * @aipanel/core 单一来源，不在此维护副本。
 */
import type { Context } from "@deepseek-ai/cordis";
import type {
  InputTriggerCandidate,
  InputTriggerSource,
  ReferenceInsert,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import { WIDGET_MSG } from "@aipanel/core";
import type { AIPanelSelectedElement, AIPanelWidgetTheme } from "@aipanel/core";
import type { ISessions, SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
  IConversation,
  InputState,
  SessionInput,
  TokenSpan,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ThemePreference, ThemeRuntime } from "@deepseek-ai/dsh-client-ui-theme/client";
import { registerDiagnosticsView } from "./diagnostics-view";

/**
 * AIPanel 挂件 ⇄ dsh iframe 的消息协议：单一来源 @aipanel/core 的 WIDGET_MSG。
 * 本包不再自行维护一份镜像常量，避免协议漂移。
 */
const MSG = WIDGET_MSG;

/** overlay 传入的插件配置（config 段，best-effort；缺失时走默认值） */
export interface AipanelClientPluginConfig {
  /**
   * 诊断功能总开关（provider option enableDiagnostics，对齐 opencode enableLsp）。
   * 缺失时默认开启（与 provider 默认一致）；显式 false 时不注册诊断卡片视图。
   */
  enableDiagnostics?: boolean;
  /**
   * 初始主题偏好（provider applyConfig.theme，见 @aipanel/core AIPanelWidgetTheme）。
   * 缺省不干预：沿用 dsh 用户设置里已持久化的主题偏好。
   */
  theme?: AIPanelWidgetTheme;
}

/**
 * cordis 插件服务注入声明。rc.1 起插件 ctx 只暴露 inject 声明过的服务面：
 *  - slots：诊断卡片视图（官方 ui-tool 同款姿势）
 *  - sessions：会话列表/current/聚焦（sessions.open）与会话就绪探针
 *  - inputTriggers：注册 @aipanel 引用 source
 *  - conversation：选中元素插入当前会话输入框
 */
export const inject = ["slots", "sessions", "inputTriggers", "conversation"];

/** 最近选中元素的本地存储键（插件自持；跨页面刷新保留 @ 菜单候选） */
const SELECTION_STORAGE_KEY = "aipanel.selection";

/** 会话就绪确认所需的最小稳态时长（毫秒）：current 在该窗口内不变视为“已稳定” */
const SESSION_SETTLE_MS = 400;

/** 等待会话列表基线/会员资格就绪后再 open 的最大重试次数 */
const FOCUS_OPEN_MAX_ATTEMPTS = 3;


/**
 * 取（或生成）元素的节点唯一 id：优先复用已赋值的 id（AIPanel App.vue 分配后随
 * 消息下发），否则兜底生成随机 id 并写回元素。id 与核心层 selectedElements 一致，
 * host 端 dsh-plugin 据此反查并注入上下文。
 */
function ensureNodeId(e: AIPanelSelectedElement): string {
  if (e.id) return e.id;
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  e.id = `n${random}`;
  return e.id;
}

/** 短标签（chip / @ 菜单展示，不含完整的 filePath:line 长尾） */
function elementLabel(e: AIPanelSelectedElement): string {
  if (e.description) return e.description;
  const text = e.innerText?.trim();
  if (text) return text.slice(0, 40);
  return "元素";
}

/** 不透明引用：携带完整元素上下文（提交时由 codec.serialize 还原成全文） */
function elementContextRef(e: AIPanelSelectedElement): string {
  return JSON.stringify(e);
}

/** 构造 model 可见的引用文本：只带节点 id（`@节点[n<id>]`）。完整上下文由 host 端按 id 反查注入。 */
function serializeElement(ref: string): string {
  try {
    const e = JSON.parse(ref) as AIPanelSelectedElement;
    if (!e || typeof e !== "object") throw new Error("not an element payload");
    return `@节点[${ensureNodeId(e)}]`;
  } catch {
    return `@${ref}`;
  }
}

/** 把选中元素铸成 ReferenceInsert（label/clipboardText 规则与官方 input-trigger 一致） */
function toReference(e: AIPanelSelectedElement): ReferenceInsert {
  const mark = `节点[${ensureNodeId(e)}]`;
  return {
    source: "aipanel",
    ref: elementContextRef(e),
    label: mark,
    appearance: "file",
    clipboardText: `@${mark}`,
  };
}

/** 把选中元素铸成候选（@ 菜单项） */
function toCandidate(e: AIPanelSelectedElement): InputTriggerCandidate {
  return {
    name: elementLabel(e),
    description: e.description || e.innerText || undefined,
    value: elementContextRef(e),
  };
}

/** 读取本地最近选中元素候选（@ 菜单数据源） */
function readSelectionCandidates(): InputTriggerCandidate[] {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return [];
    const elements = JSON.parse(raw) as AIPanelSelectedElement[];
    if (!Array.isArray(elements)) return [];
    return elements
      .filter((e): e is AIPanelSelectedElement => !!e && typeof e === "object")
      .slice(0, 20)
      .map(toCandidate);
  } catch {
    return [];
  }
}

/** 记录一条最近选中元素（去重，最多 20 条，供 @ 菜单候选与刷新后恢复） */
function pushSelection(element: AIPanelSelectedElement): void {
  if (!element) return;
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    const list: AIPanelSelectedElement[] = raw ? ((JSON.parse(raw) as AIPanelSelectedElement[]) ?? []) : [];
    if (!Array.isArray(list)) return;
    if (!list.some((e) => e.filePath === element.filePath && e.line === element.line)) {
      list.unshift(element);
      if (list.length > 20) list.length = 20;
      localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    /* ignore */
  }
}

/** 是否嵌入在父文档（AIPanel 挂件 iframe）中：仅嵌入式才做 AIPanel 专属 UI 行为 */
function isEmbedded(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return false;
  }
}

/** 把消息投递给父窗（AIPanel 挂件）。非嵌入式不发。 */
function postToHost(type: string, data: Record<string, unknown> = {}): void {
  if (!isEmbedded()) return;
  try {
    window.parent.postMessage({ type, ...data }, "*");
  } catch {
    /* ignore */
  }
}

/**
 * AIPanel 主题 → dsh 主题偏好（ThemePreference）。
 * AIPanel 的 auto 语义即“跟随系统”，映射为 dsh 的 system（单一来源：各自包的类型）。
 */
function mapAipanelTheme(t: AIPanelWidgetTheme | ThemePreference | string): ThemePreference | null {
  if (t === "light" || t === "dark") return t;
  if (t === "system" || t === "auto") return "system";
  return null;
}

export function apply(ctx: Context, config: AipanelClientPluginConfig = {}) {
  // 诊断卡片视图：provider option enableDiagnostics 关闭时不注册（默认开启，与 provider 默认一致）。
  registerDiagnosticsView(ctx, config.enableDiagnostics !== false);

  // ============================================================
  // 1) 会话就绪探针 + 聚焦（FOCUS_SESSION → sessions.open，无 reload）
  // ============================================================
  const sessions = ctx.get("sessions") as ISessions | undefined;
  if (sessions) {
    let lastCurrent: SessionId | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    /** 当前聚焦目标：仅在收到 FOCUS_SESSION 时使用 */
    let targetSessionId: SessionId | undefined;
    /** FOCUS_SESSION 在列表基线就绪前到达时排队 */
    let pendingFocusId: SessionId | undefined;
    let focusAttempts = 0;
    let refreshing = false;

    /** 会话已稳定（current 在该窗口内未变）→ 上报父窗放行 loading */
    const notifyReady = (sessionId: SessionId) => {
      postToHost(MSG.SESSION_READY, { sessionId });
    };

    /** 判定列表是否已有基线（非“尚无任何数据”的 loading 态） */
    const hasBaseline = (snap?: SessionListState): boolean => {
      if (!snap) return false;
      return !!snap.current || !!snap.ids?.length || Object.keys(snap.byId ?? {}).length > 0;
    };

    const listContains = (snap: SessionListState | undefined, id: SessionId): boolean => {
      if (!snap) return false;
      return !!snap.byId?.[id] || snap.ids?.includes(id) === true;
    };

    /** 等列表基线到达后把排队的聚焦目标切进去 */
    const drainPendingFocus = () => {
      const id = pendingFocusId;
      if (!id) return;
      const snap = sessions.list.getSnapshot();
      if (!hasBaseline(snap)) return; // 等下一次订阅回调
      pendingFocusId = undefined;
      focusAttempts = 0;
      void tryOpenTarget(id);
    };

    /** 尝试把目标会话设为 current：会员未就绪时刷新重试，上限后放弃（父窗 30s 兜底放行） */
    const tryOpenTarget = async (id: SessionId) => {
      if (focusAttempts >= FOCUS_OPEN_MAX_ATTEMPTS) return;
      focusAttempts += 1;
      const snap = sessions.list.getSnapshot();
      if (snap.current === id) return; // 已就位（探针会负责上报）
      if (!listContains(snap, id) && !refreshing) {
        refreshing = true;
        try {
          await sessions.refresh();
        } catch {
          /* ignore */
        } finally {
          refreshing = false;
        }
        const fresh = sessions.list.getSnapshot();
        if (!listContains(fresh, id)) {
          // 会员仍缺失：稍后重试一次，避免立刻风暴
          setTimeout(() => void tryOpenTarget(id), 500);
          return;
        }
      }
      try {
        sessions.open(id);
      } catch {
        /* open 失败（会话不可达）：放弃本轮，父窗兜底 */
      }
    };

    /** 收到父窗聚焦指令 */
    const handleFocus = (sessionId: SessionId) => {
      targetSessionId = sessionId;
      const snap = sessions.list.getSnapshot();
      if (!hasBaseline(snap)) {
        pendingFocusId = sessionId;
        return;
      }
      focusAttempts = 0;
      void tryOpenTarget(sessionId);
    };

    // current 稳态探针：任何会话稳定即上报（聚焦目标经 open 后由这里放行）
    const probe = () => {
      const snapshot = sessions.list?.getSnapshot?.();
      const current = snapshot?.current;
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
        if (sessions.list?.getSnapshot?.()?.current === current) {
          notifyReady(current);
          if (targetSessionId && targetSessionId !== current) {
            // 目标会话聚焦失败/迟到：当前稳定的是别的会话 → 补一次聚焦
            handleFocus(targetSessionId);
          }
        }
      }, SESSION_SETTLE_MS);
      // 基线刚就绪时若有排队的聚焦目标，立即尝试
      if (hasBaseline(snapshot)) drainPendingFocus();
    };

    probe();
    const unsubscribe = sessions.list.subscribe?.(probe);
    ctx.effect(() => unsubscribe ?? (() => {}), "aipanel: session-ready watcher");

    // ============================================================
    // 2) 主题 / 布局 / 键盘 / 选中元素 —— 页内行为（原 bridge 职责）
    // ============================================================
    const embedded = isEmbedded();
    let selectModeActive = false;

    // ---- 主题（官方 ctx.theme）：SET_THEME → setTheme；偏好由 dsh 持久化 ----
    const applyThemeFromHost = (theme: unknown) => {
      const id = typeof theme === "string" ? mapAipanelTheme(theme) : null;
      if (!id) return;
      try {
        const themeService = ctx.get("theme") as ThemeRuntime | undefined;
        themeService?.setTheme(id);
      } catch {
        /* ignore：主题服务不可用/未知 id 时跳过 */
      }
    };

    // ---- 布局：嵌入式时隐藏 dsh 侧栏（与 AIPanel 自带会话列表去重） ----
    // 与旧 bridge 的 CSS 一致（data-sidebar-collapsed 首列轨道坍缩 + 工作区下拉隐藏）。
    // 不折叠成 dsh 的紧凑控制条：AIPanel 窄 iframe 下完全隐藏以节省横向空间。
    const LAYOUT_STYLE_ID = "aipanel-layout-overrides";
    const injectLayoutOverrides = () => {
      if (!embedded) return;
      try {
        if (document.getElementById(LAYOUT_STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = LAYOUT_STYLE_ID;
        style.textContent = [
          "[data-sidebar-collapsed] {",
          "  grid-template-columns: auto !important;",
          "}",
          "[data-sidebar-collapsed] > :first-child {",
          "  display: none !important;",
          "}",
          '[aria-label="\u9009\u62E9\u5DE5\u4F5C\u533A"] {',
          "  display: none !important;",
          "}",
        ].join("\n");
        document.head.appendChild(style);
      } catch {
        /* ignore */
      }
    };

    // ---- 键盘转发：iframe 内的 keydown 不冒泡到宿主，须捕获后转交 ----
    // Esc：选择模式开启时优先退出（吞掉 dsh 自身的 Esc 处理）；Ctrl+P 切换选择模式。
    const onKeydownCapture = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && !(event.ctrlKey && event.key.toLowerCase() === "p")) return;
      if (selectModeActive) {
        event.preventDefault();
        event.stopPropagation();
      }
      postToHost(MSG.KEYDOWN, {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
    };

    // ---- 选中元素：INSERT_FILE_PART → 记录候选 + 立即以 chip 插入输入框 ----
    // 走官方 SessionInput.insertReference()，避免手写 Lexical/DOM 编辑。
    const focusComposer = () => {
      try {
        const el = document.querySelector<HTMLElement>(
          '[role="textbox"][contenteditable="true"], textarea[data-phase]',
        );
        el?.focus();
      } catch {
        /* ignore */
      }
    };

    /** 计算当前插入点（投影坐标 span）：输入框文本与 draft 一致时取真实光标，否则取文末 */
    const caretSpan = (snapshot: InputState | undefined): TokenSpan | null => {
      if (!snapshot) return null;
      const draft = snapshot.draft;
      const rev = snapshot.draftRev;
      let start = draft.length;
      let end = draft.length;
      try {
        const composer = document.querySelector<HTMLElement>(
          '[role="textbox"][contenteditable="true"], textarea[data-phase]',
        );
        if (composer) {
          if (composer.isContentEditable) {
            const draftInComposer = (composer.innerText ?? "").replace(/\n$/, "");
            if (draftInComposer === draft) {
              const sel = window.getSelection();
              if (
                sel &&
                sel.rangeCount > 0 &&
                sel.anchorNode &&
                sel.focusNode &&
                composer.contains(sel.anchorNode) &&
                composer.contains(sel.focusNode)
              ) {
                const textNodes: Text[] = [];
                const walker = document.createTreeWalker(composer, NodeFilter.SHOW_TEXT);
                let n: Node | null = walker.nextNode();
                while (n) {
                  textNodes.push(n as Text);
                  n = walker.nextNode();
                }
                const posOf = (node: Node, off: number): number | null => {
                  const idx = textNodes.indexOf(node as Text);
                  if (idx < 0) return null;
                  let acc = 0;
                  for (let i = 0; i < idx; i++) acc += textNodes[i].data.length;
                  return acc + Math.min(off, textNodes[idx].data.length);
                };
                const s = posOf(sel.anchorNode, sel.anchorOffset);
                const e = posOf(sel.focusNode, sel.focusOffset);
                if (s !== null && e !== null) {
                  start = Math.min(Math.max(s, 0), draft.length);
                  end = Math.min(Math.max(e, start), draft.length);
                }
              }
            }
          } else {
            const ta = composer as HTMLTextAreaElement;
            if (ta.value === draft) {
              const s = ta.selectionStart ?? draft.length;
              const e = ta.selectionEnd ?? s;
              start = Math.min(s, draft.length);
              end = Math.min(e, draft.length);
            }
          }
        }
      } catch {
        /* ignore */
      }
      return { start, end, draftRev: rev };
    };

    const insertElement = (element: AIPanelSelectedElement) => {
      if (!element) return;
      const current = sessions.list.getSnapshot().current;
      if (!current) return;
      try {
        const actx = sessions.scope(current);
        if (!actx) return;
        const conversation = ctx.get("conversation") as IConversation | undefined;
        if (!conversation) return;
        // 官方 SessionInputResolver：scope 会话 → per-session 输入机
        const inputFor: SessionInput = conversation.input.for(actx as Context);

        const reference = toReference(element);
        const span1 = caretSpan(inputFor.state.getSnapshot());
        if (!span1) return;
        // 官方 insertReference：chip 后自动补分隔空格（如需），无需手工处理
        const applied = inputFor.insertReference(reference, span1);
        if (!applied) {
          // span 校验失败（draftRev 过期 / 输入处于 claimed 等）→ 用最新状态在文末重试一次
          const snap2 = inputFor.state.getSnapshot();
          if (!snap2) return;
          inputFor.insertReference(reference, {
            start: snap2.draft.length,
            end: snap2.draft.length,
            draftRev: snap2.draftRev,
          });
        }
        focusComposer();
      } catch {
        // 注入失败静默：仍可从 @aipanel 菜单手动插入
      }
    };

    // ---- 页内消息监听（替代 bridge 的 window message 处理）----
    const onWindowMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            type?: string;
            theme?: string;
            sessionId?: string;
            selectMode?: boolean;
            element?: AIPanelSelectedElement;
          }
        | undefined;
      if (!data || typeof data.type !== "string") return;
      if (data.type === MSG.SET_THEME && typeof data.theme === "string") {
        applyThemeFromHost(data.theme);
      } else if (data.type === MSG.FOCUS_SESSION && typeof data.sessionId === "string") {
        handleFocus(data.sessionId as SessionId);
      } else if (data.type === MSG.INSERT_FILE_PART && data.element) {
        pushSelection(data.element);
        insertElement(data.element);
      } else if (data.type === MSG.SELECT_MODE_CHANGE) {
        selectModeActive = data.selectMode === true;
      }
    };
    window.addEventListener("message", onWindowMessage);
    ctx.effect(
      () => () => window.removeEventListener("message", onWindowMessage),
      "aipanel: host message listener",
    );

    // 初始化：布局覆盖 + 键盘捕获（嵌入式时）+ 初始主题（config 提供时）
    injectLayoutOverrides();
    if (embedded) {
      window.addEventListener("keydown", onKeydownCapture, true);
      ctx.effect(
        () => () => window.removeEventListener("keydown", onKeydownCapture, true),
        "aipanel: keydown capture",
      );
    }
    if (typeof config.theme === "string") {
      applyThemeFromHost(config.theme);
    }
  }

  // ============================================================
  // 3) @aipanel 引用 source（@ 菜单 chip 高亮）
  // ============================================================
  const inputTriggers = ctx.get("inputTriggers");
  if (!inputTriggers) return;

  const source: InputTriggerSource = {
    trigger: "@",
    name: "aipanel",
    order: 300,
    showGroupTitle: false,

    // 候选 = 最近选中元素（本地存储，由 INSERT_FILE_PART 写入），按输入查询过滤
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
        const parsed = JSON.parse(pick.candidate.value ?? "null") as AIPanelSelectedElement | null;
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
}
