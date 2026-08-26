# 快速开始

一个完整的接入链路：**AI 引擎是引擎，Vite 插件启动服务，浏览器扩展连接服务**。三步即可完成。

## 选择 AI 引擎

插件内置两套 AI 引擎，任选其一即可：

### 方案 A：OpenCode CLI（默认）

```bash
curl -fsSL https://opencode.ai/install | bash
```

验证安装：

```bash
opencode --version
```

### 方案 B：DeepSeek Harness (dsh)

安装 dsh CLI 与对应的 provider 包：

```bash
npm install -g @deepseek-ai/dsh
npm install -D @aipanel/provider-deepseek
```

> 使用 OpenCode（默认引擎）无需额外安装 provider 包；DeepSeek 引擎需要单独安装 `@aipanel/provider-deepseek`。

验证安装：

```bash
dsh --version
```

> 两种引擎按 `provider` 配置二选一，默认 OpenCode。

## 第一步：安装 Vite 插件

在项目根目录安装：

```bash
npm install -D vite-plugin-aipanel
```

最小配置（默认使用 OpenCode 引擎）：

```ts
// vite.config.ts
import { defineConfig } from "vite";
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [aipanelAssistant()],
});
```

使用 DeepSeek Harness 引擎：

```ts
// vite.config.ts
import { defineConfig } from "vite";
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [
    aipanelAssistant({
      provider: "deepseek",
      providerOptions: {
        // agentPreset: "standard",     // 新建会话的默认 Agent 预设
        // permissionPreset: "read-only", // 默认权限预设
        // busyEnter: "queue",          // 繁忙时 Enter 行为
      },
    }),
  ],
});
```

> Vite 插件负责**启动 AIPanel Web 服务**（AI 对话后端），浏览器扩展通过这个服务与 AI 通信。

## 第二步：启动开发服务器

```bash
npm run dev
```

Vite 插件会在启动时自动：

1. 检查所选 AI 引擎（OpenCode 或 dsh）是否已安装
2. 启动 AIPanel Web 服务（默认端口 `5097`）
3. 启动代理服务（默认端口 `6097`，处理跨域）
4. 自动复用或创建当前项目的 AI 会话

## 第三步：安装浏览器扩展

1. [下载扩展包](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/main/packages/extension/opencode-assistant.zip)
2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 打开右上角**「开发者模式」**开关
4. 解压下载的 `.zip`，点击**「加载已解压的扩展程序」**，选择解压后的文件夹
5. 工具栏出现 AIPanel 图标，安装完成

:::tip Edge / Arc / Brave
操作步骤相同，入口分别是 `edge://extensions/` / `arc://extensions/` / `brave://extensions/`。
:::

## 开始使用

用 Chrome 打开你的 `localhost` 开发页面，点击工具栏中的 AIPanel 图标，侧边栏自动连接当前项目的 AI 服务，即可开始对话。

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