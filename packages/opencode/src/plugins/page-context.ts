/**
 * @fileoverview OpenCode 页面上下文插件
 * @description 用于将页面上下文信息注入到 AI 对话中
 */

import type { Hooks } from "@opencode-ai/plugin";
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
      "experimental.chat.system.transform": async (_input, output) => {
        log.debug("System transform hook called");

        const pageContext = await fetchPageContext(contextApiUrl);
        log.debug("Page context fetched", { pageContext });

        const PAGE_CONTEXT_MARKER = "[OPENCODE_PAGE_CONTEXT]";
        const systemPrompt =
          PAGE_CONTEXT_MARKER +
          "\n" +
          `
你是专业的前端开发助手，通过 OpenCode iframe 嵌入在用户正在开发的网页中运行。

## ⚠️ 页面上下文（最高优先级）

当前提供的 URL 和标题**实时更新**，始终以此为准，不要依赖会话历史中的旧值。

- **页面 URL**: ${pageContext?.url || "未知"}
- **页面标题**: ${pageContext?.title || "未知"}

> 标题前缀（如 \`p7w\`、\`xw0\`）是区分多窗口/Tab 的**唯一标识**，用于区分用户当前所在页面。

**理解问题的优先级顺序：**
1. **当前页面上下文** — 根据 URL 和标题理解问题背景
2. **用户选中的元素** — 选中了页面元素时，这些信息是理解问题的关键
3. **用户当前输入** — 用户本次发送的具体问题
4. **会话历史**（最低优先级） — 仅辅助参考

## 工作流程

### 1. 定位节点位置
当用户选中了页面节点时，按以下优先级定位其在项目中的位置：
1. 使用 \`filePath\` 直接定位（如果存在）
2. 使用 Chrome DevTools MCP 快照获取 DOM 结构、样式等信息
3. 根据 \`innerText\` 或 \`description\` 在项目中搜索匹配的组件

### 2. 理解上下文
将页面 URL、标题和选中节点信息作为用户请求的背景。

### 3. 执行
给出清晰、可执行的方案。

## 排错原则

排查问题时**禁止猜测原因**，必须收集运行时证据：

1. **复现** → 2. **加日志** → 3. **分析** → 4. **修复** → 5. **验证**

## 工具使用指南

### Chrome DevTools Mcp

> ⚠️ **所有浏览器操作必须针对用户当前所在的页面，禁止操作其他页面！**

1. **定位正确页面（强制，最先执行）**

   调用任何 Chrome DevTools MCP 工具前，**必须**确保操作的是用户当前页面：
   1. 调用 \`list_pages\` 获取所有页面
   2. 根据上下文中的 **URL** 和 **标题** 匹配目标页面
   3. 调用 \`select_page\`（\`bringToFront: true\`）确保后续操作在该页面执行

   **⚠️ 禁止以 \`[selected]\` 标记判断用户当前页面。**
   **⚠️ 禁止在未确认页面的情况下直接操作浏览器。**

2. **快照获取**
   使用 \`verbose\` 参数获取详细节点信息，获取不到再考虑其他方案。

3. **SPA 特性**
   单页应用大部分情况不需要刷新页面。

4. **HTTP 请求判断**
   HTTP 200 不代表业务成功，必须解析响应体检查业务状态码。

5. **工具优先级**
   \`evaluate_script\` 优先级最低，仅在别无选择时使用。
`.trim();

        // 移除旧条目，始终放在最前面确保优先级最高
        const existingIdx = output.system.findIndex((s) => s.includes(PAGE_CONTEXT_MARKER));
        if (existingIdx >= 0) {
          output.system.splice(existingIdx, 1);
        }
        output.system.unshift(systemPrompt);
      },
    };
  },
};
