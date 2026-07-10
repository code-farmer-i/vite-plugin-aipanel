# 常见问题排查

## 安装问题

### OpenCode 未安装

插件启动后如果检测不到 OpenCode CLI，会显示错误提示：

```
OpenCode is not installed!
Please install OpenCode first...
```

**解决方案：**

```bash
# 推荐方式
curl -fsSL https://opencode.ai/install | bash

# 或使用包管理器
npm i -g opencode-ai@latest
brew install anomalyco/tap/opencode

# 验证安装
opencode --version
```

## 端口问题

### 端口被占用

插件会自动寻找可用端口（端口号递增，最多尝试 10 次）。如果仍然失败：

```ts
// 方案1：手动指定端口
opencodeAssistant({ webPort: 5001, proxyPort: 5002 });

// 方案2：检查哪些端口被占用
lsof -i :5097
lsof -i :6097
```

**通过 API 查看实际端口：**

```bash
curl http://localhost:5173/__opencode_start__
# → { "proxyPort": 6098, "webPort": 5098, ... }
```

## Chrome DevTools MCP 问题

### 预热失败

面板显示 Chrome MCP 连接错误，常见原因：

#### `CHROME_NOT_CONNECTED` - Chrome 远程调试未开启

```bash
# macOS - 以调试模式启动 Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# 确认端口可访问
curl http://localhost:9222/json/version
```

#### `AI_TIMEOUT` - AI 响应超时

- AI 模型未在 60 秒内响应
- 检查 OpenCode 的模型配置是否正确
- 检查网络连接

#### `AI_RESPONSE_ERROR` - AI 响应不正确

- AI 未返回包含 "ready" 的响应
- 可能是模型不支持 tool 调用
- 尝试换一个模型

### 手动重试预热

预热失败后在面板中点击"重试"，或通过 API：

```bash
# 查看可用模型
curl http://localhost:5173/__opencode_warmup__

# 用指定模型重试
curl -X POST http://localhost:5173/__opencode_warmup__ \
  -H "Content-Type: application/json" \
  -d '{"providerID":"openai","modelID":"gpt-4o"}'
```

## 元素选择问题

### "Vue Inspector 未加载" 提示

元素选择器依赖 `unplugin-vue-inspector`，插件已内置。如果不可用：

- 确保项目是 Vue 项目
- 检查 `vite.config.ts` 是否正常加载了插件

### 选中元素的文件路径为空

如果选中元素后 `filePath` 为 `null`：

- 该元素可能是纯 HTML 元素而非 Vue 组件
- 不一定是错误，AI 会通过 Chrome DevTools 工具来定位

## 页面同步问题

### SPA 路由切换后 AI 不知道当前页面

页面上下文会自动同步，监听 `history.pushState` / `replaceState` / `popstate` / `hashchange`。如果没同步：

- 检查路由库是否使用标准的 History API
- 查看 `__opencode_context__` 端点确认当前上下文是否正确

## 面板问题

### 面板不显示 / 悬浮按钮消失

- 检查 `displayMode` 配置，扩展模式下悬浮按钮默认隐藏
- 确认插件 `enabled` 为 `true`
- 使用快捷键 `Ctrl+K` 尝试打开面板
- 检查浏览器控制台是否有 JavaScript 错误

### iframe 白屏或加载失败

- 确认 OpenCode Web 服务端口可访问：`curl http://127.0.0.1:5097`
- 检查代理端口是否正确：`curl http://127.0.0.1:6097`
- 查看日志排查：`curl "http://localhost:5173/__opencode_logs__?level=error"`

## 日志查看

### 如何查看插件日志

```bash
# 查看最近的错误日志
curl "http://localhost:5173/__opencode_logs__?level=error&limit=20"

# 或在 AI 对话中直接问
"帮我看看 Vite 开发服务器有没有错误"
```

## 生产构建

### 插件会不会影响生产代码

**不会。** 插件仅在 `vite serve`（开发模式）下工作，`vite build` 时自动跳过，不影响生产构建。
