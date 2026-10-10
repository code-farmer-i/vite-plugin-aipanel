# vite-plugin-aipanel

在 Vite 开发环境中嵌入 AIPanel AI 助手：浏览器扩展在任意 `localhost` 开发页面唤起 AI 侧边栏，边聊天边改代码，HMR 实时预览。

支持 **OpenCode** 与 **DeepSeek Harness (dsh)** 两种 AI 引擎，通过 `provider` 配置一键切换。

## 环境要求

- 任一 Vite ≥ 5 的 Node.js 项目
- Chrome / Edge / Arc / Brave 等 Chromium 内核浏览器
- 任选其一：OpenCode CLI（默认）或 DeepSeek Harness (dsh) CLI

## 快速开始

### 1. 安装 AI 引擎

**默认引擎 OpenCode CLI：**

```bash
curl -fsSL https://opencode.ai/install | bash
opencode --version # 验证
```

> 使用 DeepSeek Harness 请改装：`npm i -g @deepseek-ai/dsh` + `npm i -D @aipanel/provider-deepseek`，并配置 `provider: "deepseek"`（见下）。

### 2. 安装并配置 Vite 插件

```bash
npm install -D vite-plugin-aipanel
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [aipanelAssistant()],
});
```

### 3. 启动开发服务器

```bash
npm run dev
```

插件自动完成：校验引擎 → 启动 AIPanel Web 服务（默认 5097）与代理（默认 6097，端口占用自动换）→ 复用/创建当前项目会话。

### 4. 安装浏览器扩展

1. [下载扩展包](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/main/packages/extension/aipanel-assistant.zip)
2. Chrome 打开 `chrome://extensions/`，开启右上角**「开发者模式」**
3. 解压 `.zip` → **「加载已解压的扩展程序」** → 选择解压目录
4. 打开 `localhost` 开发页面，点击工具栏 **AIPanel 图标**（或 `Ctrl/Cmd + K`）唤起侧边栏

> Edge / Arc / Brave 入口分别是 `edge://extensions/` / `arc://extensions/` / `brave://extensions/`。

## 切换 AI 引擎

插件默认 `provider: "default"`（等价 `"opencode"`，适配已内置，仅需安装 opencode CLI）。

| provider  | 引擎                   | 额外依赖                                   | 说明                        |
| --------- | ---------------------- | ------------------------------------------ | --------------------------- |
| `default` | OpenCode CLI           | 无（适配内置；需另装 opencode CLI）        | 默认值，同 `opencode`    |
| `opencode` | OpenCode CLI         | 无（适配内置；需另装 opencode CLI）        | 显式指定 OpenCode           |
| `deepseek` | DeepSeek Harness (dsh) | `@aipanel/provider-deepseek` + dsh CLI   | DeepSeek 官方 Web 对话界面  |

```ts
// 使用 DeepSeek Harness 引擎（先安装其依赖）
aipanelAssistant({
  provider: "deepseek",
  providerOptions: {
    // home: "~/.dsh",                // dsh 数据目录
    // profile: "web",               // dsh profile 名（默认 web）
    // agentPreset: "standard",       // 新建会话的默认 Agent 预设
    // permissionPreset: "read-only", // 默认权限预设
    // busyEnter: "queue",            // 繁忙时 Enter 行为
  },
});
```

> **注意**：插件**不会自动探测**已安装的引擎，引擎由 `provider` 字段决定；切换前请确认对应 CLI 已安装。

## 纯净 MCP 模式

`mcpOnly: true` 时，插件只暴露 MCP 工具服务（Chrome DevTools 控制、Vue DevTools、日志读取等），不启动 AI 引擎、不注入对话界面，适合作为独立 MCP server 供外部 Agent 消费：

```ts
aipanelAssistant({ mcpOnly: true });
```

端点挂在 Vite dev server 上（需保持 `vite dev` 运行），外部 MCP 客户端按 Streamable HTTP 配置：

```json
{
  "mcpServers": {
    "aipanel": {
      "type": "http",
      "url": "http://localhost:5173/__aipanel_mcp__"
    }
  }
}
```

> 端口随 Vite dev server 变化（默认 5173），以启动日志中的 `MCP endpoint` 为准；`Claude Code` / `Cursor` 等客户端配置详见在线文档。

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