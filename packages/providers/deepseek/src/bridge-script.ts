/**
 * Provider 侧桥接脚本资产（DeepSeek Harness）
 *
 * dsh 是 SPA 型无 deepLink 能力 UI：iframe 保持应用壳，切会话由核心层发
 * FOCUS_SESSION 消息，本脚本负责接收并在 dsh 内切换到目标会话。
 * 核心层代理只负责将本脚本注入 dsh 返回的 HTML。
 */
import { WIDGET_MSG } from "@aipanel/core";
import { DSH_STORAGE_KEYS } from "./constants";

export interface BridgeScriptOptions {
  /** 主题模式 */
  theme?: "light" | "dark" | "auto";
  /** 诊断功能开关（provider option enableDiagnostics；写入 localStorage 供 dsh-client 决定是否注册诊断视图） */
  diagnosticsEnabled?: boolean;
}

/**
 * 生成 PostMessage Bridge 脚本。
 * dsh 无正式"切换会话"URL 钩子，选中态持久化在 localStorage(CURRENT_SESSION)，
 * 且 SPA 启动时会据此恢复选中——因此桥接采用"写入选中 + 刷新 iframe"的策略。
 * 若 dsh 后续暴露正式切会话接口，可替换以下 FOCUS_SESSION 分支。
 */
export function generateBridgeScript(options: BridgeScriptOptions = {}): string {
  const { theme = "auto", diagnosticsEnabled = false } = options;
  return `
(function() {
  const CURRENT_SESSION_KEY = ${JSON.stringify(DSH_STORAGE_KEYS.CURRENT_SESSION)};
  const SELECTION_KEY = ${JSON.stringify(DSH_STORAGE_KEYS.SELECTION)};
  const DIAGNOSTICS_KEY = ${JSON.stringify(DSH_STORAGE_KEYS.DIAGNOSTICS_ENABLED)};
  const DIAGNOSTICS_ENABLED = ${JSON.stringify(diagnosticsEnabled)};
  const THEME = ${JSON.stringify(theme)};

  // 诊断功能开关：同步写入（不依赖 DOM），保证 dsh-client apply 时即可读到标记。
  // bridge 脚本注入于 <head>，dsh-client 插件在页面脚本/React 初始化后才 apply，
  // 若等 DOMContentLoaded 再写则存在时序竞争，视图可能漏注册。
  try {
    if (DIAGNOSTICS_ENABLED) {
      localStorage.setItem(DIAGNOSTICS_KEY, "1");
    } else {
      localStorage.removeItem(DIAGNOSTICS_KEY);
    }
  } catch (e) { /* ignore */ }

  // 桥接层通知 dsh-client 的选中元素插入事件（与 opencode 一致：选中即追加到对话框）
  const INSERT_ELEMENT_EVENT = "aipanel:insert-element";

  // === 记录最近选中元素 ===
  // 供 dsh-client 的 @aipanel source 作为候选读取（可多选，最多保留 20 个），并派发
  // aipanel:insert-element 让 dsh-client 立即把元素追加到当前会话输入框。
  function pushSelection(element) {
    if (!element) return;
    try {
      var list = [];
      var raw = localStorage.getItem(SELECTION_KEY);
      if (raw) list = JSON.parse(raw) || [];
      if (!Array.isArray(list)) list = [];
      var exists = list.some(function (e) {
        return e && e.filePath === element.filePath && e.line === element.line;
      });
      if (!exists) list.unshift(element);
      if (list.length > 20) list.length = 20;
      localStorage.setItem(SELECTION_KEY, JSON.stringify(list));
      // 通知 dsh-client 追加到对话框（选中即插入，无需再输入 @）
      window.dispatchEvent(new CustomEvent(INSERT_ELEMENT_EVENT, {
        detail: { element: element }
      }));
    } catch (e) { /* ignore */ }
  }

  // === 主题同步（UI 呈现；持久化交由 dsh settings「ui-theme.preference」，不在此写 localStorage）===
  // dsh 的暗色由 body[data-ds-dark-theme] + colorScheme 呈现。
  // 注意：bridge 可能被注入到 <head>，此时 document.body 尚不存在，须在 DOM ready 后再执行。
  // theme 参数："light" | "dark" | "auto"（auto 不干预，交给 dsh 原生主题处理）。
  function applyTheme(theme) {
    if (!document.body) return;
    if (theme === "dark") {
      document.body.setAttribute("data-ds-dark-theme", "");
      document.documentElement.style.colorScheme = "dark";
    } else if (theme === "light") {
      document.body.removeAttribute("data-ds-dark-theme");
      document.documentElement.style.colorScheme = "light";
    }
  }

  // === 布局覆盖 ===
  // 隐藏 dsh 的侧边栏列，避免与 AIPanel 自带会话列表重复。
  // 稳定锚点：AppFrame 根网格在侧边栏折叠时带 data-sidebar-collapsed（AIPanel 窄 iframe 下恒存在），
  // 侧边栏列是根网格的首个子元素。
  // 注意不能只 display:none 元素：显式 gridTemplateColumns（内联样式）轨道不会因子项
  // 隐藏而消失，会留一条空白列，须把首列轨道改成 auto（子项隐藏后坍缩为 0）。
  function applyLayoutOverrides() {
    try {
      if (document.getElementById("aipanel-layout-overrides")) return;
      var style = document.createElement("style");
      style.id = "aipanel-layout-overrides";
      style.textContent = [
        "[data-sidebar-collapsed] {",
        "  grid-template-columns: auto !important;",
        "}",
        "[data-sidebar-collapsed] > :first-child {",
        "  display: none !important;",
        "}",
        '[aria-label="\\u9009\\u62E9\\u5DE5\\u4F5C\\u533A"] {',
        "  display: none !important;",
        "}",
      ].join("\\n");
      document.head.appendChild(style);
    } catch (e) { /* ignore */ }
  }

  // === 选择模式状态 ===
  // 记录宿主是否处于"选择元素"模式：选择模式开启时，iframe 内捕获的 Esc 应优先
  // 转发给宿主退出选择模式，并吞掉本页自身的按键处理（如停止生成/关闭弹层）。
  let isInSelectMode = false;

  // === 消息监听 ===
  window.addEventListener("message", function(event) {
    if (!event.data) return;

    // 核心层通知：切换主题（工具栏主题按钮/跟随系统变化）。动态应用，无需重载。
    if (event.data.type === ${JSON.stringify(WIDGET_MSG.SET_THEME)}) {
      applyTheme(event.data.theme);
    }

    // 核心层通知：聚焦指定会话（无 deepLink 模式）。
    // dsh 的选中态持久化为 JSON.stringify({ sessionId, subagentAddress? })，SPA 启动时据此恢复。
    if (event.data.type === ${JSON.stringify(WIDGET_MSG.FOCUS_SESSION)}) {
      const sessionId = event.data.sessionId;
      if (!sessionId) return;
      try {
        localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify({ sessionId }));
      } catch (e) {
        console.warn("dsh bridge: failed to persist session selection", e);
      }
      // dsh SPA 从持久化选中恢复，刷新以切换到目标会话
      location.reload();
    }

    // 核心层通知：页面选中元素 → 记录，供 @aipanel 菜单筛选后以 reference 插入
    if (event.data.type === ${JSON.stringify(WIDGET_MSG.INSERT_FILE_PART)}) {
      pushSelection(event.data.element);
    }

    // 核心层通知：选择元素模式变化（更新本地状态，供键盘转发判断是否吞掉本页 Esc 处理）
    if (event.data.type === ${JSON.stringify(WIDGET_MSG.SELECT_MODE_CHANGE)}) {
      isInSelectMode = event.data.selectMode === true;
    }
  });

  // === 键盘事件转发（退出/切换选择模式） ===
  // 与 opencode bridge 一致：iframe 内的 keydown 不会冒泡到宿主文档（跨文档事件隔离），
  // 因此当焦点在聊天 iframe 内时，宿主 App 收不到 Esc / Ctrl+P，导致：
  //   - 选择元素模式开启时按 Esc 无法退出（被 dsh 自身按键处理吞掉或直接丢失）；
  //   - 光标在聊天输入框时无法用 Ctrl+P 进入选择元素模式。
  // 此处用捕获阶段监听 Esc / Ctrl+P 并转发为 KEYDOWN 消息给宿主 App（App.vue 据此
  // 退出/切换选择模式）。选择模式开启时优先退出：preventDefault + stopPropagation，
  // 避免 dsh 自身对 Esc 的处理抢走按键。
  window.addEventListener("keydown", function(event) {
    if (event.key === "Escape" || (event.ctrlKey && event.key.toLowerCase() === "p")) {
      if (isInSelectMode) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (window.parent !== window) {
        window.parent.postMessage({
          type: ${JSON.stringify(WIDGET_MSG.KEYDOWN)},
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey
        }, "*");
      }
    }
  }, true);

  // === 就绪通知 ===
  // 不再用 MutationObserver 每帧发 READY（那会在 dsh 刚渲染、目标会话尚未激活时就
  // 提前放行 loading）。改为监听 dsh-client 插件在"目标会话激活且渲染稳定"后派发的
  // aipanel:session-ready 事件，收到后上报 SESSION_READY{sessionId}。
  // 只发 SESSION_READY 而不发 READY：客户端已能凭 sessionId 匹配当前会话决定何时
  // 放行 loading / 补发聚焦；避免与"FOCUS_SESSION → reload → 再就绪"构成刷新死循环。
  const SESSION_READY_EVENT = "aipanel:session-ready";

  function sendSessionReady(sessionId) {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: ${JSON.stringify(WIDGET_MSG.SESSION_READY)},
        sessionId
      }, "*");
    }
  }

  window.addEventListener(SESSION_READY_EVENT, function(e) {
    const sessionId = e && e.detail && e.detail.sessionId;
    if (!sessionId) return;
    sendSessionReady(sessionId);
  });

  // 主题同步/布局覆盖仍须在每次页面加载时生效（与就绪判定解耦，不参与 loading 放行）
  function init() {
    applyTheme(THEME);
    applyLayoutOverrides();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
`;
}
