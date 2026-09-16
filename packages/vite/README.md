# vite-plugin-aipanel

在 Vite 开发环境中嵌入 AIPanel AI 助手：浏览器扩展在任意 `localhost` 开发页面唤起 AI 侧边栏，边聊天边改代码，HMR 实时预览。

支持 **OpenCode** 与 **DeepSeek Harness (dsh)** 两种 AI 引擎，通过 `provider` 配置一键切换。

## 环境要求

- 任一 Vite ≥ 5 的 Node.js 项目
- Chrome / Edge / Arc / Brave 等 Chromium 内核浏览器
- 任选其一：OpenCode CLI（默认）或 DeepSeek Harness (dsh) CLI

## 安装

```bash
npm install -D vite-plugin-aipanel
```

## 快速开始

```ts
// vite.config.ts
import { defineConfig } from "vite";
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [aipanelAssistant()],
});
```

启动 `npm run dev` 后，插件自动完成：校验引擎 → 启动 AIPanel Web 服务（默认 5097）与代理（默认 6097，端口占用自动换）→ 复用/创建当前项目会话。

## 切换 AI 引擎

插件默认 `provider: "default"`（等价 `"opencode"`，适配已内置，仅需安装 opencode CLI）。

| provider    | 引擎                   | 额外依赖                                 |
| ----------- | ---------------------- | ---------------------------------------- |
| `default`   | OpenCode CLI           | 无（适配内置；需另装 opencode CLI）      |
| `opencode`  | OpenCode CLI           | 无（适配内置；需另装 opencode CLI）      |
| `deepseek`  | DeepSeek Harness (dsh) | `@aipanel/provider-deepseek` + dsh CLI   |

## 纯净 MCP 模式

`mcpOnly: true` 时插件只暴露 MCP 工具服务（Chrome DevTools 控制、Vue DevTools、日志读取等），不启动 AI 引擎、不注入对话界面，适合作为独立 MCP server 供外部 Agent 消费。

## 文档

完整使用指南（浏览器扩展安装、MCP 客户端配置等）请访问 [在线文档](https://code-farmer-i.github.io/vite-plugin-aipanel/)，仓库见 [code-farmer-i/vite-plugin-aipanel](https://github.com/code-farmer-i/vite-plugin-aipanel)。

## License

MIT
