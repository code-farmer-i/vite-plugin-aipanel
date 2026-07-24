import http from "http";
import {
  createLogger,
  DEFAULT_OPENCODE_SETTINGS,
  OPENCODE_STORAGE_KEYS,
  WIDGET_MSG,
  BRIDGE_SCRIPT_PATH,
  type OpenCodeSettings,
  type OpenCodeLanguage,
} from "@vite-plugin-opencode-assistant/shared";

const log = createLogger("ProxyServer");

export interface ProxyServerOptions {
  /** 主题模式 */
  theme?: "light" | "dark" | "auto";
  /** OpenCode 界面语言 */
  language?: OpenCodeLanguage;
  /** OpenCode 内部设置 */
  settings?: OpenCodeSettings;
  /** 绑定地址，需与端口检查使用的地址族一致，避免 IPv4/IPv6 不匹配 */
  hostname?: string;
}

/**
 * 深度合并设置对象
 * 只合并用户提供的设置，其余让 OpenCode 自己处理
 */
function mergeSettings(
  defaultSettings: typeof DEFAULT_OPENCODE_SETTINGS,
  userSettings?: OpenCodeSettings,
): OpenCodeSettings {
  if (!userSettings) return defaultSettings;

  const result: OpenCodeSettings = { ...defaultSettings };

  // 只合并用户提供的非 undefined 设置
  if (userSettings.general) {
    result.general = { ...defaultSettings.general, ...userSettings.general };
  }
  if (userSettings.appearance) {
    result.appearance = userSettings.appearance;
  }
  if (userSettings.permissions) {
    result.permissions = userSettings.permissions;
  }
  if (userSettings.notifications) {
    result.notifications = userSettings.notifications;
  }
  if (userSettings.sounds) {
    result.sounds = userSettings.sounds;
  }

  return result;
}

/**
 * 生成 PostMessage Bridge 脚本
 * 只处理 DOM 操作和主题同步，SSE 监听已迁移到 client 层
 */
function generateBridgeScript(options: ProxyServerOptions): string {
  const { theme = "auto", language, settings } = options;
  const mergedSettings = mergeSettings(DEFAULT_OPENCODE_SETTINGS, settings);

  return `
(function() {
  // === 劫持 matchMedia，强制桌面端布局以渲染审查面板 ===
  // 只劫持 opencode 判断桌面端的媒体查询 (min-width: 768px)，不影响其他查询
  (function() {
    var _origMatchMedia = window.matchMedia.bind(window);
    var DESKTOP_QUERY = '(min-width: 768px)';
    window.matchMedia = function(query) {
      var result = _origMatchMedia(query);
      if (query === DESKTOP_QUERY) {
        return {
          get matches() { return true; },
          get media() { return result.media; },
          onchange: null,
          addListener: function(cb) { result.addListener(cb); },
          removeListener: function(cb) { result.removeListener(cb); },
          addEventListener: function(t, cb) { result.addEventListener(t, cb); },
          removeEventListener: function(t, cb) { result.removeEventListener(t, cb); },
          dispatchEvent: function(e) { return result.dispatchEvent(e); }
        };
      }
      return result;
    };
  })();

  const STORAGE_KEYS = ${JSON.stringify(OPENCODE_STORAGE_KEYS)};
  const THEME_KEY = STORAGE_KEYS.COLOR_SCHEME;
  const SETTINGS_KEY = STORAGE_KEYS.SETTINGS;

  // === 初始化配置 ===
  const initialConfig = {
    theme: ${JSON.stringify(theme)},
    language: ${JSON.stringify(language || null)},
    settings: ${JSON.stringify(mergedSettings)}
  };

  // 初始化主题
  if (initialConfig.theme && initialConfig.theme !== "auto") {
    localStorage.setItem(THEME_KEY, initialConfig.theme);
    document.documentElement.setAttribute("data-color-scheme", initialConfig.theme);
  }

  // 初始化设置
  // 深度合并 initialConfig.settings 到已有配置：只覆盖插件声明的字段，
  // opencode 自己管理的其他配置不受影响
  function deepMerge(target, source) {
    for (var key in source) {
      if (!{}.hasOwnProperty.call(source, key)) continue;
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
        if (!target[key] || typeof target[key] !== "object") target[key] = {};
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  try {
    var existing = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(deepMerge(existing, initialConfig.settings)));
  } catch {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(initialConfig.settings));
  }

  // === 主题同步函数 ===
  function getTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || "system";
    } catch {
      return "system";
    }
  }

  function setTheme(theme) {
    try {
      const oldTheme = localStorage.getItem(THEME_KEY);
      localStorage.setItem(THEME_KEY, theme);
      document.documentElement.setAttribute('data-color-scheme', theme);

      if (oldTheme !== theme) {
        window.dispatchEvent(new StorageEvent('storage', {
          key: THEME_KEY,
          oldValue: oldTheme,
          newValue: theme,
          url: window.location.href
        }));
      }
    } catch {
      // ignore
    }
  }

  // === 选择模式状态 ===
  let isInSelectMode = false;

  function handleSelectModeChange(selectMode) {
    isInSelectMode = selectMode;
  }

  // === 消息监听 ===
  window.addEventListener("message", function(event) {
    if (event.data && event.data.type === ${JSON.stringify(WIDGET_MSG.SET_THEME)}) {
      setTheme(event.data.theme);
    }

    if (event.data && event.data.type === ${JSON.stringify(WIDGET_MSG.INSERT_FILE_PART)}) {
      insertFilePart(event.data.element);
    }

    if (event.data && event.data.type === ${JSON.stringify(WIDGET_MSG.MINIMIZE_STATE)}) {
      handleMinimizeStateChange(event.data.minimized);
    }

    if (event.data && event.data.type === ${JSON.stringify(WIDGET_MSG.PROMPT_DOCK_VISIBILITY)}) {
      handlePromptDockVisibilityChange(event.data.visible);
    }

    if (event.data && event.data.type === ${JSON.stringify(WIDGET_MSG.SELECT_MODE_CHANGE)}) {
      handleSelectModeChange(event.data.selectMode);
    }

    if (event.data && event.data.type === ${JSON.stringify(WIDGET_MSG.REVIEW_PANEL_TOGGLE)}) {
      handleReviewPanelToggle(event.data.visible);
    }
  });

  // === 键盘事件转发（用于退出选择模式） ===
  window.addEventListener("keydown", function(event) {
    if (event.key === "Escape" || (event.ctrlKey && event.key.toLowerCase() === "p")) {
      // 选择模式开启时，优先退出选择模式，阻止 iframe 内的其他 ESC 处理（如中止会话）
      if (isInSelectMode) {
        event.preventDefault();
        event.stopPropagation();
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
        return;
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

  // === 最小化状态样式 ===
  const minimizeStyles = \`
    #root header {
      display: none !important;
    }
    .opencode-minimized [data-dock-surface="tray"]:not([data-slot="permission-footer"]) {
      display: none !important;
    }
    .opencode-minimized [data-slot="session-turn-list"] {
      padding-bottom: 10px !important;
    }
    .opencode-prompt-dock-hidden [data-component="session-prompt-dock"]:not(:has([data-kind="permission"])) {
      display: none !important;
    }
    button[data-slot="dropdown-menu-trigger"][icon="dot-grid"] {
      display: none !important;
    }
    [data-component="icon-button-v2"][aria-label="更多选项"],
    [data-component="icon-button-v2"][aria-label="More options"] {
      display: none !important;
    }
  \`;

  // === 通用样式 ===
  const generalStyles = \`
    /* 隐藏会话面板标题右侧按钮区 */
    [data-session-title] .shrink-0 {
      display: none !important;
    }
  \`;

  // === 审查面板覆盖样式 ===
  // 审查面板全屏，会话面板浮在右下角（类似插件最小化状态）
  const reviewPanelStyles = \`
    .opencode-review-panel-overlay [data-ref="panel-row"] {
      flex-direction: column !important;
      gap: 8px !important;
      padding: 8px !important;
    }

    /* 审查面板占满剩余空间 */
    .opencode-review-panel-overlay [data-ref="side-panel-container"] {
      flex: 1 !important;
      width: 100% !important;
      transition: none !important;
      min-height: 0 !important;
    }

    /* 会话面板浮在右下角 */
    .opencode-review-panel-overlay [data-ref="session-panel"] {
      position: fixed !important;
      bottom: 16px !important;
      right: 16px !important;
      width: 380px !important;
      max-height: 70vh !important;
      display: flex !important;
      flex-direction: column !important;
      z-index: 600 !important;
      border-radius: 12px !important;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.04),
        0 2px 4px rgba(0, 0, 0, 0.04),
        0 8px 16px rgba(0, 0, 0, 0.08),
        0 16px 40px rgba(0, 0, 0, 0.12) !important;
      overflow: hidden !important;
      transition: none;
    }
    .opencode-review-panel-overlay [data-ref="session-panel"] * {
      max-width: none !important;
    }

    /* 会话浮窗内层背景抬高，与审查面板底色形成层次 */
    .opencode-review-panel-overlay [data-ref="session-panel"] [class*="bg-v2-background-bg-base"] {
      background: color-mix(in srgb, var(--v2-background-bg-base, #1e1e1e) 96%, #fff) !important;
    }

    /* 隐藏会话面板内的标题 */
    .opencode-review-panel-overlay [data-ref="session-panel"] [data-session-title] {
      display: none !important;
    }



    /* 隐藏浮动会话（用 visibility+opacity 避免切换闪烁） */
    .opencode-review-panel-overlay.hide-chat [data-ref="session-panel"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* 审查面板右上角悬浮切换按钮 */
    .opencode-chat-toggle-btn {
      position: fixed !important;
      top: 16px !important;
      right: 16px !important;
      z-index: 700 !important;
      width: 36px !important;
      height: 36px !important;
      border-radius: 8px !important;
      border: none !important;
      background: var(--v2-background-bg-base, #1e1e1e) !important;
      color: var(--v2-icon-icon-base, #ccc) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
      transition: background 0.15s !important;
    }
    .opencode-chat-toggle-btn:hover {
      background: var(--v2-overlay-simple-overlay-hover, #333) !important;
    }
    .opencode-chat-toggle-btn.active {
      background: var(--v2-overlay-simple-overlay-pressed, #444) !important;
    }
  \`;

  function injectMinimizeStyles() {
    if (document.getElementById('opencode-minimize-styles')) return;
    const style = document.createElement('style');
    style.id = 'opencode-minimize-styles';
    style.textContent = minimizeStyles;
    document.head.appendChild(style);
  }

  function injectReviewPanelStyles() {
    if (document.getElementById('opencode-review-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'opencode-review-panel-styles';
    style.textContent = reviewPanelStyles;
    document.head.appendChild(style);
  }

  function injectGeneralStyles() {
    if (document.getElementById('opencode-general-styles')) return;
    const style = document.createElement('style');
    style.id = 'opencode-general-styles';
    style.textContent = generalStyles;
    document.head.appendChild(style);
  }

  // === 最小化状态处理 ===
  let savedMinimizedState = null;
  let savedPromptDockVisibleState = null;
  let savedReviewPanelState = null;

  function handleMinimizeStateChange(minimized) {
    savedMinimizedState = minimized;
    if (minimized) {
      document.documentElement.classList.add('opencode-minimized');
    } else {
      document.documentElement.classList.remove('opencode-minimized');
    }
  }

  // === 对话框显示状态处理 ===
  function handlePromptDockVisibilityChange(visible) {
    savedPromptDockVisibleState = visible;
    if (!visible) {
      document.documentElement.classList.add('opencode-prompt-dock-hidden');
    } else {
      document.documentElement.classList.remove('opencode-prompt-dock-hidden');
    }
  }

  // === 审查面板覆盖状态处理 ===
  // 策略：纯 CSS class 控制。首次打开时给关键元素打 data-ref 标记，
  // 后续只需 toggle class。关闭时移除 class，CSS 规则自动恢复原始布局。
  // 不修改任何 inline style，避免保存/恢复的时机和 DOM 引用问题。

  function ensureReviewPanelRefs() {
    var reviewPanel = document.querySelector('[data-component="session-review-v2"]')
      || document.querySelector('[data-component="session-review"]');
    if (!reviewPanel) return false;

    // 向上遍历找到 panelRow
    var panelRow = reviewPanel.parentElement;
    while (panelRow) {
      var cls = panelRow.className || '';
      if (cls.indexOf('flex-col') !== -1 && cls.indexOf('md:flex-row') !== -1) break;
      panelRow = panelRow.parentElement;
    }
    if (!panelRow) return false;
    panelRow.setAttribute('data-ref', 'panel-row');

    // 找到会话面板和侧边面板容器
    for (var i = 0; i < panelRow.children.length; i++) {
      var child = panelRow.children[i];
      if (child.nodeType !== 1) continue;
      var c = child.className || '';
      if (c.indexOf('@container') !== -1) {
        child.setAttribute('data-ref', 'session-panel');
      } else if (c.indexOf('min-w-0') !== -1 && c.indexOf('flex-col') !== -1) {
        child.setAttribute('data-ref', 'side-panel-container');
      }
    }

    return true;
  }

  function injectChatToggleBtn() {
    if (document.getElementById('opencode-chat-toggle-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'opencode-chat-toggle-btn';
    btn.className = 'opencode-chat-toggle-btn';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.title = '展开聊天面板';
    // 从 localStorage 恢复上次的展开/收起状态，默认收起
    var chatVisible = localStorage.getItem('opencode-review-chat-visible');
    if (chatVisible === 'true') {
      document.documentElement.classList.remove('hide-chat');
      btn.classList.add('active');
      btn.title = '隐藏聊天面板';
    } else {
      document.documentElement.classList.add('hide-chat');
    }
    btn.onclick = function() {
      document.documentElement.classList.toggle('hide-chat');
      btn.classList.toggle('active');
      var isVisible = btn.classList.contains('active');
      btn.title = isVisible ? '隐藏聊天面板' : '展开聊天面板';
      localStorage.setItem('opencode-review-chat-visible', isVisible ? 'true' : 'false');
    };
    document.body.appendChild(btn);
  }

  function removeChatToggleBtn() {
    var btn = document.getElementById('opencode-chat-toggle-btn');
    if (btn) btn.remove();
  }

  function handleReviewPanelToggle(visible) {
    // 如果状态没有变化，跳过（避免 MutationObserver 重复触发）
    if (savedReviewPanelState === visible) return;
    savedReviewPanelState = visible;

    if (visible) {
      // 先点击原生按钮打开面板，让 DOM 渲染出来
      var reviewBtn = document.querySelector('[aria-controls="review-panel"]');
      if (reviewBtn && reviewBtn.getAttribute('aria-expanded') !== 'true') {
        reviewBtn.click();
      }

      // 等 DOM 就绪后打标记并应用 CSS
      var attempts = 0;
      function tryApply() {
        if (ensureReviewPanelRefs()) {
          document.documentElement.classList.add('opencode-review-panel-overlay');
          injectChatToggleBtn();
          return;
        }
        attempts++;
        if (attempts < 20) requestAnimationFrame(tryApply);
      }
      requestAnimationFrame(tryApply);
    } else {
      // 关闭前先将会话面板宽度设为 100%，避免 SolidJS 异步渲染的宽度跳变
      var sessionPanel = document.querySelector('[data-ref="session-panel"]');
      if (sessionPanel) sessionPanel.style.width = '100%';
      document.body.offsetHeight; // 强制回流

      document.documentElement.classList.remove('opencode-review-panel-overlay');
      document.documentElement.classList.remove('hide-chat');
      removeChatToggleBtn();

      // 等一帧让 CSS 布局变化先渲染，再关闭原生面板
      // 避免 SolidJS 异步 DOM 变化和 CSS 布局变化发生在同一帧导致视觉跳动
      requestAnimationFrame(function() {
        var reviewBtn = document.querySelector('[aria-controls="review-panel"]');
        if (reviewBtn && reviewBtn.getAttribute('aria-expanded') === 'true') {
          reviewBtn.click();
        }
      });
    }
  }
  
  // === 应用保存的状态 ===
  function applySavedStates() {
    if (savedMinimizedState !== null) {
      handleMinimizeStateChange(savedMinimizedState);
    }
    if (savedPromptDockVisibleState !== null) {
      handlePromptDockVisibilityChange(savedPromptDockVisibleState);
    }
    if (savedReviewPanelState !== null) {
      handleReviewPanelToggle(savedReviewPanelState);
    }
  }

  // === 保存输入框光标位置 ===
  let savedRange = null;

  function setupPromptInputListener() {
    const promptInput = document.querySelector('[data-component="prompt-input"]');
    if (!promptInput) return;

    promptInput.addEventListener('blur', function() {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (promptInput.contains(range.commonAncestorContainer)) {
          savedRange = range.cloneRange();
        }
      }
    });

    promptInput.addEventListener('focus', function() {
      savedRange = null;
    });
  }

  // === 插入 File Part 到输入框 ===
  function insertFilePart(element) {
    const promptInput = document.querySelector('[data-component="prompt-input"]');
    if (!promptInput) {
      log.warn('Prompt input not found');
      return;
    }

    const { filePath, line, column, description, innerText, previewPageUrl, previewPageTitle } = element;

    const selector = description || 'element';
    let textPreview = '';
    if (innerText && innerText.trim()) {
      const trimmed = innerText.trim();
      textPreview = trimmed.length > 5 ? trimmed.substring(0, 5) + '...' : trimmed;
    }
    const displayText = '@' + selector + (textPreview ? '(' + textPreview + ')' : '');

    const jsonStr = JSON.stringify({
      nodeContext: {
        "filePath": {
          "value": filePath ?? '未知',
          "desc": "源码文件路径"
        },
        "line": {
          "value": line ?? '未知',
          "desc": "代码所在行号"
        },
        "column": {
          "value": column ?? '未知',
          "desc": "代码所在列号"
        },
        "description": {
          "value": description ?? '未知',
          "desc": "DOM 元素选择器"
        },
        "innerText": {
          "value": innerText ? innerText.substring(0, 500) : '',
          "desc": "DOM 元素内部文本"
        },
        "selectAt": {
          "value": previewPageUrl || '未知',
          "desc": "用户选中节点时的页面 URL"
        }
      }
    });

    const span = document.createElement('span');
    span.setAttribute('data-mention', 'file');
    span.setAttribute('data-path', jsonStr);
    span.setAttribute('contenteditable', 'false');

    span.textContent = displayText;

    if (savedRange) {
      const range = savedRange;
      range.collapse(false);
      range.insertNode(span);

      const space = document.createTextNode('\\u00A0');
      span.parentNode.insertBefore(space, span.nextSibling);

      const newRange = document.createRange();
      newRange.setStartAfter(space);
      newRange.collapse(true);

      promptInput.focus();

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
      savedRange = null;

      promptInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);

      if (promptInput.contains(range.commonAncestorContainer)) {
        range.collapse(false);
        range.insertNode(span);

        const space = document.createTextNode('\\u00A0');
        span.parentNode.insertBefore(space, span.nextSibling);

        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);

        promptInput.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    promptInput.appendChild(span);
    const space = document.createTextNode('\\u00A0');
    promptInput.appendChild(space);

    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);
    const newSelection = window.getSelection();
    if (newSelection) {
      newSelection.removeAllRanges();
      newSelection.addRange(newRange);
    }

    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    promptInput.focus();
  }

  // === 就绪通知 ===
  function init() {
    // 清理残留的 session tabs 存储，避免加载已过期的 session 产生 404
    // localStorage 按 origin 隔离，每次 iframe 重新加载时清掉旧的 tab 记录
    (function cleanupTabsStorage() {
      try {
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && (key.indexOf('opencode.window') === 0 || key.indexOf('opencode.workspace') === 0)) {
            keysToRemove.push(key);
          }
        }
        for (var j = 0; j < keysToRemove.length; j++) {
          localStorage.removeItem(keysToRemove[j]);
        }
      } catch (e) {
        // localStorage 不可用时忽略
      }
    })();

    injectMinimizeStyles();
    injectReviewPanelStyles();
    injectGeneralStyles();
    if (window.parent !== window) {
      window.parent.postMessage({ type: ${JSON.stringify(WIDGET_MSG.READY)} }, "*");
    }
    setupPromptInputListener();
    applySavedStates();
    
    const observer = new MutationObserver(function(mutations) {
      const promptInput = document.querySelector('[data-component="prompt-input"]');
      if (promptInput && !promptInput._opencodeListenerAttached) {
        setupPromptInputListener();
        promptInput._opencodeListenerAttached = true;
      }
      
      // 当目标元素出现时应用保存的状态
      const promptDock = document.querySelector('[data-component="session-prompt-dock"]');
      const dockSurface = document.querySelector('[data-dock-surface="tray"]');
      if (promptDock || dockSurface) {
        applySavedStates();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
}

export interface ProxyServerResult {
  server: http.Server;
  actualPort: number;
}

export function startProxyServer(
  targetUrl: string,
  port: number,
  options: ProxyServerOptions = {},
): Promise<ProxyServerResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const bridgeScript = generateBridgeScript(options);

    const server = http.createServer((req, res) => {
      if (req.url === BRIDGE_SCRIPT_PATH) {
        const body = bridgeScript;
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }

      const requestOptions: http.RequestOptions = {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: target.host,
          "accept-encoding": "identity",
        },
        timeout: 0,
      };

      const proxyReq = http.request(requestOptions, (proxyRes) => {
        const rawContentType = proxyRes.headers["content-type"];
        const contentType = Array.isArray(rawContentType)
          ? (rawContentType[0] ?? "")
          : (rawContentType ?? "");

        if (contentType.includes("text/html")) {
          const chunks: Buffer[] = [];

          proxyRes.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          proxyRes.on("end", () => {
            let body = Buffer.concat(chunks).toString("utf-8");

            if (body.match(/<\/head>/i)) {
              body = body.replace(
                /<\/head>/i,
                `<script src="${BRIDGE_SCRIPT_PATH}"></script></head>`,
              );
            } else if (body.match(/<\/body>/i)) {
              body = body.replace(
                /<\/body>/i,
                `<script src="${BRIDGE_SCRIPT_PATH}"></script></body>`,
              );
            } else {
              body += `<script src="${BRIDGE_SCRIPT_PATH}"></script>`;
            }

            const headers: http.OutgoingHttpHeaders = {};
            for (const [key, value] of Object.entries(proxyRes.headers)) {
              if (
                value !== undefined &&
                key !== "content-encoding" &&
                key !== "transfer-encoding" &&
                key !== "content-length"
              ) {
                headers[key] = value;
              }
            }
            headers["content-length"] = Buffer.byteLength(body);

            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(body);
          });
        } else {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        }
      });

      proxyReq.on("error", (err) => {
        log.error("Proxy error", { error: err.message, url: req.url });
        res.writeHead(502);
        res.end("Proxy error");
      });

      proxyReq.on("socket", (socket) => {
        socket.setTimeout(0);
      });

      req.on("socket", (socket) => {
        socket.setTimeout(0);
      });

      req.pipe(proxyReq);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    server.timeout = 0;
    server.keepAliveTimeout = 0;

    server.listen(port, options.hostname || undefined, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      log.debug(`Proxy server started on port ${actualPort} -> ${targetUrl}`);
      resolve({ server, actualPort });
    });
  });
}
