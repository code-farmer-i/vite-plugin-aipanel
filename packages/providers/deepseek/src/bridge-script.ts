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
}

/**
 * 生成 PostMessage Bridge 脚本。
 * dsh 无正式"切换会话"URL 钩子，选中态持久化在 localStorage(CURRENT_SESSION)，
 * 且 SPA 启动时会据此恢复选中——因此桥接采用"写入选中 + 刷新 iframe"的策略。
 * 若 dsh 后续暴露正式切会话接口，可替换以下 FOCUS_SESSION 分支。
 */
export function generateBridgeScript(options: BridgeScriptOptions = {}): string {
  const { theme = "auto" } = options;
  return `
(function() {
  const CURRENT_SESSION_KEY = ${JSON.stringify(DSH_STORAGE_KEYS.CURRENT_SESSION)};
  const SELECTION_KEY = ${JSON.stringify(DSH_STORAGE_KEYS.SELECTION)};
  const THEME = ${JSON.stringify(theme)};

  // === 记录最近选中元素 ===
  // 供 dsh-client 的 @aipanel source 作为候选读取（可多选，最多保留 20 个）
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
    } catch (e) { /* ignore */ }
  }

  // === 主题同步（UI 呈现；持久化交由 dsh settings「ui-theme.preference」，不在此写 localStorage）===
  // dsh 的暗色由 body[data-ds-dark-theme] + colorScheme 呈现。
  // 注意：bridge 可能被注入到 <head>，此时 document.body 尚不存在，须在 DOM ready 后再执行。
  function applyTheme() {
    if (!document.body) return;
    if (THEME === "dark") {
      document.body.setAttribute("data-ds-dark-theme", "");
      document.documentElement.style.colorScheme = "dark";
    } else if (THEME === "light") {
      document.body.removeAttribute("data-ds-dark-theme");
      document.documentElement.style.colorScheme = "light";
    }
    // auto → 不干预，交给 dsh 原生主题处理
  }

  // === 消息监听 ===
  window.addEventListener("message", function(event) {
    if (!event.data) return;

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
  });

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

  // 主题同步仍须在每次页面加载时生效（与就绪判定解耦，不参与 loading 放行）
  function init() {
    applyTheme();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
`;
}
