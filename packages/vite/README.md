# vite-plugin-aipanel

在 Vite 开发环境中嵌入 AIPanel AI 助手，边聊天边改代码，HMR 实时预览。

## 快速开始

### 前置条件

安装 [OpenCode CLI](https://opencode.ai)（AI 引擎，必须）：

```bash
curl -fsSL https://opencode.ai/install | bash
```

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

### 3. 启动开发服务器

```bash
npm run dev
```

Vite 插件会自动启动 AIPanel Web 服务并创建当前项目的 AI 会话。

### 4. 安装浏览器扩展

1. [下载扩展包](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/main/packages/extension/aipanel-assistant.zip)
2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 打开右上角**「开发者模式」**开关
4. 解压下载的 `.zip`，点击**「加载已解压的扩展程序」**，选择解压后的文件夹
5. 用 Chrome 打开 `localhost` 开发页面，点击工具栏中的 AIPanel 图标即可开始对话

> Edge / Arc / Brave 操作步骤相同，入口分别是 `edge://extensions/` / `arc://extensions/` / `brave://extensions/`。

## 工作原理

```
┌────────────────┐      ┌────────────────┐      ┌─────────────┐
│  Vite 插件       │      │  浏览器扩展      │      │  OpenCode   │
│  启动 Web 服务   │◀────▶│  侧边栏面板      │◀────▶│  AI 引擎    │
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
