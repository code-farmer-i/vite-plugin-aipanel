# 快速开始

一个完整的接入链路：**CLI 是引擎，Vite 插件启动服务，浏览器扩展连接服务**。三步即可完成。

## 前置条件

安装 [OpenCode CLI](https://opencode.ai)（AI 引擎，必须）：

```bash
curl -fsSL https://opencode.ai/install | bash
```

验证安装：

```bash
opencode --version
```

## 第一步：安装 Vite 插件

在项目根目录安装：

```bash
npm install -D vite-plugin-aipanel
```

最小配置：

```ts
// vite.config.ts
import { defineConfig } from "vite";
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [aipanelAssistant()],
});
```

> Vite 插件负责**启动 AIPanel Web 服务**（AI 对话后端），浏览器扩展通过这个服务与 AI 通信。

## 第二步：启动开发服务器

```bash
npm run dev
```

Vite 插件会在启动时自动：

1. 检查 OpenCode CLI 是否已安装
2. 启动 AIPanel Web 服务（默认端口 `5097`）
3. 启动代理服务（默认端口 `6097`，处理跨域）
4. 自动复用或创建当前项目的 AI 会话

## 第三步：安装浏览器扩展

1. [下载扩展包](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/main/packages/extension/aipanel-assistant.zip)
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
│  Vite 插件       │      │  浏览器扩展      │      │  OpenCode   │
│  启动 Web 服务   │◀────▶│  侧边栏面板      │◀────▶│  AI 引擎    │
│  代理跨域        │      │  页面上下文同步   │      │  会话管理    │
└────────────────┘      └────────────────┘      └─────────────┘
```

- Vite 插件在项目启动时自动拉起 AIPanel Web 服务
- 浏览器扩展检测到 `localhost` 页面后自动连接该服务
- 实时同步页面 URL、标题等上下文给 AI
- 多标签页自动切换对应项目的会话

<PagodaDocLinkToView view="guide/usage">查看使用指南 →</PagodaDocLinkToView>
