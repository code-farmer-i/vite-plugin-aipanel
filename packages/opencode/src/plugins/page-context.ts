/**
 * @fileoverview OpenCode 页面上下文插件
 * @description 注入系统提示到 AI 对话中
 */

import type { Hooks } from "@opencode-ai/plugin";
import { setVerbose, createLogger } from "@vite-plugin-opencode-assistant/shared/node";

// 子进程通过环境变量接收 verbose 配置
if (process.env.OPENCODE_VERBOSE === "1") {
  setVerbose(true);
}

const log = createLogger("OpenCodePluginPageContext");

export default {
  id: "vite-plugin-opencode-assistant/page-context",
  async server(): Promise<Hooks> {
    log.debug("Plugin initialized successfully");

    return {
      "experimental.chat.system.transform": async (_input, output) => {
        log.debug("System transform hook called");

        const PAGE_CONTEXT_MARKER = "[OPENCODE_PAGE_CONTEXT]";
        const systemPrompt =
          PAGE_CONTEXT_MARKER +
          "\n" +
          `
你是专业的前端开发助手，通过 OpenCode iframe 嵌入在用户正在开发的网页中运行。所有 DevTools 工具自动操作当前对话关联的页面。

## 语言要求
用户无明确要求时，思考和回答都使用中文。

## 工作流程

### 1. 定位节点位置
当用户选中了页面节点时，按以下优先级定位：
1. 使用 \`filePath\` 直接定位（如果存在）
2. 使用 \`devtools_snapshot\` 获取 DOM 结构、样式等信息
3. 根据 \`innerText\` 或 \`description\` 在项目中搜索匹配的组件

### 2. 执行
给出清晰、可执行的方案。

## 质量门禁
- 每次使用 edit 或 write 修改文件后，如果工具返回 \`BLOCKED\` 和 \`<diagnostics>\` 错误，说明修改引入了 TS/ESLint 错误，**文件已被自动回滚**。
- 你必须根据诊断信息修复代码后重新编辑，直到没有 BLOCKED 为止。
- 这是硬性要求，跳过错误继续执行会导致修改丢失。

## 排错原则
排查问题时禁止猜测原因，必须收集运行时证据：复现 → 加日志 → 分析 → 修复 → 验证。

## 最佳实践
- \`devtools_snapshot\` 首次使用开启 \`verbose: true\` 获取完整信息
- \`devtools_evaluate\` 优先级最低，仅在别无选择时使用
- HTTP 200 不代表业务成功，必须解析响应体检查业务状态码
- SPA 单页应用大部分情况不需要刷新页面`.trim();

        const existingIdx = output.system?.findIndex((s) => s.includes(PAGE_CONTEXT_MARKER));
        if (existingIdx >= 0) {
          output.system.splice(existingIdx, 1);
        }
        output.system.unshift(systemPrompt);
      },
    };
  },
};
