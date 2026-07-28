/**
 * @fileoverview OpenCode 页面上下文插件
 * @description 用于将页面上下文信息注入到 AI 对话中
 */

import type { Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { createLogger } from "@vite-plugin-opencode-assistant/shared/node";

const log = createLogger("OpenCodePluginPageContext");

interface PageContext {
  url: string;
  title: string;
  tabId?: number;
  tabIndex?: number;
  selectedElements?: Array<{
    filePath: string | null;
    line: number | null;
    column: number | null;
    innerText: string;
    description?: string;
  }>;
}

async function fetchPageContext(contextApiUrl: string): Promise<PageContext | null> {
  try {
    const response = await fetch(contextApiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      log.debug("Failed to fetch page context", { status: response.status });
      return null;
    }
    return await response.json();
  } catch (error) {
    log.debug("Error fetching page context", { error });
    return null;
  }
}

export default {
  id: "vite-plugin-opencode-assistant/page-context",
  async server(): Promise<Hooks> {
    log.debug("PageContextPlugin loading...");

    const contextApiUrl = process.env.OPENCODE_CONTEXT_API_URL;
    log.debug("Context API URL:", { contextApiUrl });

    if (!contextApiUrl) {
      log.warn("OPENCODE_CONTEXT_API_URL is not set, page context plugin will not work");
      return {};
    }

    log.debug("Plugin initialized successfully");

    return {
      tool: {
        get_page_context: tool({
          description: `获取用户当前正在浏览的页面信息。

**何时使用此工具**：
- 需要知道用户当前在哪个页面时
- 长对话中需要刷新页面上下文时
- 怀疑用户切换了页面/Tab，需要确认当前所在页面

**返回信息**：
- 页面 URL 和标题`,

          args: {},
          async execute(_args, context) {
            log.debug("get_page_context called", { sessionID: context.sessionID });

            const pageContext = await fetchPageContext(contextApiUrl);

            if (!pageContext) {
              return "无法获取页面上下文，请稍后重试。";
            }

            return [`**页面 URL**: ${pageContext.url}`, `**页面标题**: ${pageContext.title}`].join(
              "\n",
            );
          },
        }),
      },
      "experimental.chat.system.transform": async (_input, output) => {
        log.debug("System transform hook called");

        const PAGE_CONTEXT_MARKER = "[OPENCODE_PAGE_CONTEXT]";
        const systemPrompt =
          PAGE_CONTEXT_MARKER +
          "\n" +
          `
你是专业的前端开发助手，通过 OpenCode iframe 嵌入在用户正在开发的网页中运行。需要用页面上下文时使用 \`get_page_context\` 工具。

> 标题前缀（如 \`p7w\`、\`xw0\`）是区分多窗口/Tab 的**唯一标识**，随窗口切换实时更新。不同前缀意味着用户在不同窗口/Tab，需要用此前缀区分匹配当前页面。

## 工作流程

### 1. 定位节点位置
当用户选中了页面节点时，按以下优先级定位：
1. 使用 \`filePath\` 直接定位（如果存在）
2. 使用 Chrome DevTools MCP 快照获取 DOM 结构、样式等信息
3. 根据 \`innerText\` 或 \`description\` 在项目中搜索匹配的组件

### 2. 理解上下文
将页面 URL、标题和选中节点信息作为用户请求的背景。

### 3. 执行
给出清晰、可执行的方案。

## 排错原则

排查问题时禁止猜测原因，必须收集运行时证据：复现 → 加日志 → 分析 → 修复 → 验证。

## Chrome DevTools MCP 使用规范

> 所有浏览器操作必须针对用户当前所在的页面，禁止操作其他页面！

### 定位正确页面（强制，最先执行）

调用任何 Chrome DevTools MCP 工具前，必须确保操作的是用户当前页面：
1. 调用 \`list_pages\` 获取所有页面
2. 用页面上下文的 URL 和标题匹配目标页面
3. 调用 \`select_page\` 确保后续操作在该页面执行（不要切换前台 tab）

禁止以 \`[selected]\` 标记判断用户当前页面。
禁止在未确认页面的情况下直接操作浏览器。

### 快照获取
使用 \`verbose\` 参数获取详细节点信息，获取不到再考虑其他方案。

### SPA 特性
单页应用大部分情况不需要刷新页面。

### HTTP 请求判断
HTTP 200 不代表业务成功，必须解析响应体检查业务状态码。

### 工具优先级
\`evaluate_script\` 优先级最低，仅在别无选择时使用。`.trim();

        const existingIdx = output.system.findIndex((s) => s.includes(PAGE_CONTEXT_MARKER));
        if (existingIdx >= 0) {
          output.system.splice(existingIdx, 1);
        }
        output.system.unshift(systemPrompt);
      },
    };
  },
};
