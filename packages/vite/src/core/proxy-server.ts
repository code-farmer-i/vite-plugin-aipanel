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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(initialConfig.settings));

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
  \`;

  function injectMinimizeStyles() {
    if (document.getElementById('opencode-minimize-styles')) return;
    const style = document.createElement('style');
    style.id = 'opencode-minimize-styles';
    style.textContent = minimizeStyles;
    document.head.appendChild(style);
  }

  // === 最小化状态处理 ===
  let savedMinimizedState = null;
  let savedPromptDockVisibleState = null;

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
  
  // === 应用保存的状态 ===
  function applySavedStates() {
    if (savedMinimizedState !== null) {
      handleMinimizeStateChange(savedMinimizedState);
    }
    if (savedPromptDockVisibleState !== null) {
      handlePromptDockVisibilityChange(savedPromptDockVisibleState);
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
      console.warn('[OpenCode Bridge] Prompt input not found');
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
    span.setAttribute('data-type', 'file');
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
    injectMinimizeStyles();
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
