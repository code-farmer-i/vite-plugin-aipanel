# 快速开始

以默认的 **OpenCode** 引擎跑通全链路只需 4 步。想换 **DeepSeek Harness (dsh)** 引擎？见下方「切换 AI 引擎」。

## 环境要求

| 项        | 要求                                                    |
| --------- | ------------------------------------------------------- |
| 开发环境  | 任一 Vite ≥ 5 的 Node.js 项目（`vite dev`）            |
| 浏览器    | Chrome / Edge / Arc / Brave 等 Chromium 内核浏览器      |
| AI 引擎   | 任选其一：OpenCode CLI（默认）或 DeepSeek Harness (dsh) |

> 插件只对本地开发页面（`localhost` 地址）生效，并需保持 `vite dev` 运行。

## 第一步：安装 AI 引擎

### 方案 A：OpenCode CLI（默认，推荐）

插件已内置 OpenCode 适配，只需安装其 CLI：

```bash
curl -fsSL https://opencode.ai/install | bash
```

验证安装：

```bash
opencode --version
```

### 方案 B：DeepSeek Harness (dsh)

安装 dsh CLI 与对应 provider 包：

```bash
npm install -g @deepseek-ai/dsh
npm install -D @aipanel/provider-deepseek
```

验证安装：

```bash
dsh --version
```

:::tip
需要 dsh ≥ 0.1.2-rc.1。`@aipanel/provider-deepseek` 是插件的可选依赖，使用 dsh 引擎时必须单独安装。
:::

## 第二步：安装并配置 Vite 插件

```bash
npm install -D vite-plugin-aipanel
```

在 `vite.config.ts` 中加入插件（默认使用 OpenCode 引擎，无需额外配置）：

```ts
import { defineConfig } from "vite";
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [aipanelAssistant()],
});
```

## 第三步：启动开发服务器

```bash
npm run dev
```

插件会自动完成以下工作（可在终端日志中看到）：

1. 校验所选 AI 引擎是否已安装
2. 启动 AIPanel Web 服务（默认端口 `5097`，被占用时自动换端口）
3. 启动代理服务（默认端口 `6097`，处理跨域与页面通信）
4. 自动复用或创建当前项目的 AI 会话

## 第四步：安装浏览器扩展并开始使用

1. [下载扩展包](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/main/packages/extension/aipanel-assistant.zip)
2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 打开右上角 **「开发者模式」** 开关
4. 解压下载的 `.zip`，点击 **「加载已解压的扩展程序」**，选择解压后的文件夹
5. 用 Chrome 打开你的 `localhost` 开发页面，点击工具栏中的 **AIPanel 图标**（或按 `Ctrl/Cmd + K`）打开侧边栏

:::tip Edge / Arc / Brave
操作步骤相同，入口分别是 `edge://extensions/` / `arc://extensions/` / `brave://extensions/`。
:::

侧边栏会自动连接当前项目的 AI 服务，直接在对话框中输入你的第一条指令，例如：

> 帮我看看当前页面这个按钮的颜色，改成主色调蓝

结合「使用指南」中的元素选择器，你还可以直接框选页面元素，让 AI 精准定位并修改对应代码。

## 切换 AI 引擎

插件默认 `provider: "default"`（等价 `"opencode"`）。使用 DeepSeek Harness 引擎时，先安装其依赖（第一步·方案 B），再显式指定：

```ts
// vite.config.ts
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [
    aipanelAssistant({
      provider: "deepseek",
      providerOptions: {
        // home: "~/.dsh",                // dsh 数据目录（$DSH_HOME），默认跟随 ~/.dsh
        // profile: "web",               // dsh profile 名（默认 web）
        // agentPreset: "standard",       // 新建会话的默认 Agent 预设
        // permissionPreset: "read-only", // 默认权限预设
        // busyEnter: "queue",            // 繁忙时 Enter 行为
      },
    }),
  ],
});
```

| provider     | 引擎                  | 额外依赖                                   | 说明                       |
| ------------ | --------------------- | ------------------------------------------ | -------------------------- |
| `default`  | OpenCode CLI          | 无（适配已内置，需另装 opencode CLI）      | 默认值，同 `opencode`   |
| `opencode` | OpenCode CLI          | 无（适配已内置，需另装 opencode CLI）      | 显式指定 OpenCode          |
| `deepseek` | DeepSeek Harness (dsh) | `@aipanel/provider-deepseek` + dsh CLI   | DeepSeek 官方 Web 对话界面 |

:::warning 注意
插件**不会自动探测**已安装的引擎，引擎由 `provider` 字段决定。切换前请确认对应 CLI 已安装（见第一步），否则插件会提示安装指引。
:::

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