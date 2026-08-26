# vite-plugin-aipanel

在 Vite 开发环境中嵌入 AIPanel AI 助手，边聊天边改代码，HMR 实时预览。

支持 OpenCode 与 DeepSeek Harness (dsh) 两种 AI 引擎，通过 `provider` 配置一键切换。

## 快速开始

### 1. 安装插件

```bash
npm install -D vite-plugin-aipanel
```

### 2. 配置 Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [aipanelAssistant()],
});
```

默认使用 **OpenCode** 引擎（详见下方「选择 AI 引擎」）。

### 3. 启动开发服务器

```bash
npm run dev
```

Vite 插件会自动启动 AIPanel Web 服务并创建当前项目的 AI 会话。

### 4. 安装浏览器扩展

1. [下载扩展包](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/main/packages/extension/opencode-assistant.zip)
2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 打开右上角**「开发者模式」**开关
4. 解压下载的 `.zip`，点击**「加载已解压的扩展程序」**，选择解压后的文件夹
5. 用 Chrome 打开 `localhost` 开发页面，点击工具栏中的 AIPanel 图标即可开始对话

> Edge / Arc / Brave 操作步骤相同，入口分别是 `edge://extensions/` / `arc://extensions/` / `brave://extensions/`。

## 选择 AI 引擎

插件内置两套 AI 引擎，通过 `providerOptions` 段的 `provider` 字段选择：

| provider     | 引擎                    | 额外依赖                        | 特点                           |
| ------------ | ----------------------- | ------------------------------- | ------------------------------ |
| `opencode`   | [OpenCode CLI](https://opencode.ai) | 无（插件内置）       | 默认引擎，通用 AI CLI         |
| `deepseek`   | DeepSeek Harness (dsh)  | 另装 `@aipanel/provider-deepseek` | DeepSeek 官方 Web 对话界面 |

使用 DeepSeek Harness 引擎需先安装依赖：

```bash
npm install -D @aipanel/provider-deepseek
npm install -g @deepseek-ai/dsh
```

```ts
// 使用 DeepSeek Harness 引擎
aipanelAssistant({
  provider: "deepseek",
  providerOptions: {
    // dsh 专属配置，详见在线文档
    // home: "~/.dsh",          // dsh 数据目录
    // agentPreset: "standard", // 新建会话的默认 Agent 预设
    // permissionPreset: "read-only", // 默认权限预设
    // busyEnter: "queue",      // 繁忙时 Enter 行为
  },
});
```

> 已预装 OpenCode 与 dsh 其中之一的用户，插件会自动检测并使用。

## 纯净 MCP 模式

`mcpOnly: true` 时，插件只暴露 MCP 工具服务（Chrome DevTools 控制、Vue DevTools、日志读取等），不注入挂件、不启动 AI 引擎，适合作为独立 MCP server 供外部 Agent 消费。

```ts
aipanelAssistant({ mcpOnly: true });
```

启动后 MCP 端点挂在 Vite dev server 上，外部 MCP 客户端配置 Streamable HTTP 接入 `http://localhost:5173/__aipanel_mcp__`。

## 工作原理

```
┌────────────────┐      ┌────────────────┐      ┌─────────────┐
│  Vite 插件       │      │  浏览器扩展      │      │ OpenCode/dsh │
│  启动 Web 服务   │◀────▶│  侧边栏面板      │◀────▶│  AI 引擎     │
│  代理跨域        │      │  页面上下文同步   │      │  会话管理    │
└────────────────┘      └────────────────┘      └─────────────┘
```

- Vite 插件在项目启动时自动拉起 AIPanel Web 服务
- 浏览器扩展检测到 `localhost` 页面后自动连接该服务
- 实时同步页面 URL、标题等上下文给 AI
- 多标签页自动切换对应项目的会话

## 文档

完整使用指南请访问 [在线文档](https://code-farmer-i.github.io/vite-plugin-aipanel/)。

## License

MIT
