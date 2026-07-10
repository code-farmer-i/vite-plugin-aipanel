# 快速开始

## 安装

```bash
# 1. 安装插件
npm install -D vite-plugin-opencode-assistant

# 2. 安装 OpenCode CLI（必需前置条件）
curl -fsSL https://opencode.ai/install | bash

# 验证安装
opencode --version
```

## 最小配置

```ts
// vite.config.ts
import { defineConfig } from "vite";
import opencodeAssistant from "vite-plugin-opencode-assistant";

export default defineConfig({
  plugins: [opencodeAssistant()],
});
```

启动开发服务器后：

```bash
npm run dev
```

## 打开对话面板

有两种方式：

1. **点击悬浮按钮** - 页面右下角的圆形按钮
2. **快捷键** - 默认 `Ctrl + K`（macOS 用 `Cmd + K`）

面板打开后，你就能直接在网页上与 AI 对话、修改代码、即时预览效果。

## 第一次使用

插件启动时会自动：

1. 检查 OpenCode CLI 是否安装
2. 启动 OpenCode Web 服务（默认端口 5097）
3. 启动代理服务（默认端口 6097，解决 iframe 跨域）
4. 预热 Chrome DevTools MCP（如果配置开启）
5. 自动复用或创建当前项目的会话

启动过程中，面板会显示各个步骤的进度提示。全部完成后即可开始对话。
