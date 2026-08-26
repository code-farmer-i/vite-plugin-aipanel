# 常见问题

## 浏览器扩展和 Vite 插件是什么关系？

两个组件缺一不可：

- **Vite 插件** — 安装在项目里，负责启动 AIPanel Web 服务（AI 对话后端）
- **浏览器扩展** — 安装在 Chrome 里，负责提供侧边栏界面，连接到 Vite 插件启动的服务

简单来说：Vite 插件是"发动机"，浏览器扩展是"方向盘"。

## 只装扩展不装 Vite 插件能用吗？

不能。扩展本身不含 AI 引擎，它需要连接到 Vite 插件启动的 AIPanel Web 服务才能工作。装完扩展后打开侧边栏，如果显示「未检测到服务」，说明项目的 Vite 插件还未安装或开发服务器未启动。

## 插件安装后无法使用

**确认 OpenCode CLI 已安装：**

```bash
opencode --version
```

如果提示命令未找到：

```bash
curl -fsSL https://opencode.ai/install | bash
```

**确认项目的 Vite 插件已配置：**

检查 `vite.config.ts` 中是否引入了 `vite-plugin-aipanel`。

**确认开发服务器在运行：**

确保 `npm run dev` 已启动，且浏览器打开的是 `localhost` 地址。

## 侧边栏显示「未检测到服务」

常见原因：

1. OpenCode CLI 未安装或版本过低
2. 当前页面不是 `localhost` 地址（插件仅对本地开发页面生效）
3. Vite 开发服务器未启动
4. 项目未安装 Vite 插件

尝试重启开发服务器后再次打开侧边栏。

## 多个项目同时开发

插件支持同时管理多个项目。每个不同的 `localhost` 域名会被识别为独立项目，切换标签页时自动切换对应会话。

## 端口冲突

如果默认的 AIPanel 服务端口被占用，服务会自动寻找可用端口。也可以手动指定：

```ts
// vite.config.ts
aipanelAssistant({
  webPort: 5001,
  proxyPort: 5002,
});
```

## 元素选择器无法使用

确认以下几点：

1. 项目是 Vue 项目（选择器依赖 `unplugin-vue-inspector`）
2. Vite 插件已正确安装并启动
3. 使用快捷键 `Ctrl/Cmd + P` 进入选择模式

如果选中元素后文件路径显示为空，说明该元素可能是纯 HTML 元素而非 Vue 组件。这不一定是错误，AI 会通过 Chrome DevTools 工具自行定位。

## 支持哪些浏览器

所有 Chromium 内核浏览器：

- Google Chrome
- Microsoft Edge
- Arc Browser
- Brave
- 其他基于 Chromium 的浏览器

Firefox 和 Safari 暂不支持。

## 插件会收集数据吗

不会。插件完全在本地运行，不会将任何代码或数据上传到远程服务器。所有 AI 处理通过本机 OpenCode CLI 完成。

## 如何卸载

在浏览器扩展管理页面（`chrome://extensions/`）找到 AIPanel Assistant，点击「移除」。Vite 插件通过 `npm uninstall vite-plugin-aipanel` 卸载。