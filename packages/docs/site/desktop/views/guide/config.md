# Vite 插件配置

Vite 插件负责启动 AIPanel Web 服务，是浏览器扩展正常工作所必需的。默认配置即可满足大多数场景，以下配置用于高级定制。

## 安装

```bash
npm install -D vite-plugin-aipanel
```

## 最小配置

```ts
import { defineConfig } from "vite";
import aipanelAssistant from "vite-plugin-aipanel";

export default defineConfig({
  plugins: [aipanelAssistant()],
});
```

## 完整配置

```ts
import aipanelAssistant from "vite-plugin-aipanel";

aipanelAssistant({
  // === 基础配置 ===
  enabled: true, // 是否启用，默认 true
  provider: "opencode", // AI 引擎，默认 "default"（别名，解析到 opencode），可选 "deepseek"
  webPort: 5097, // AIPanel Web 端口，默认 5097
  proxyPort: 6097, // 代理端口，默认 6097
  hostname: "127.0.0.1", // 绑定地址
  verbose: false, // 详细日志
  mcpOnly: false, // 纯净 MCP 模式：只暴露 MCP 工具服务，不注入挂件/不启动 Web provider

  // === 主题与行为 ===
  theme: "dark", // light | dark | auto，默认 dark
  hotkey: "ctrl+k", // 面板快捷键
  warmupChromeMcp: true, // 启动时预热 Chrome DevTools
  chromeDevtoolsPort: 9222, // Chrome 调试端口

  // === Provider 专属配置（以 providerOptions 段声明）===
  providerOptions: {
    language: "zh", // AIPanel 界面语言
    settings: {
      general: {
        showReasoningSummaries: true,
        showFileTree: false,
        followup: "suggest",
      },
      appearance: {
        fontSize: 14,
        mono: "JetBrains Mono",
      },
      permissions: {
        autoApprove: false,
      },
      notifications: {
        agent: true,
        permissions: true,
        errors: true,
      },
    },
    enableLsp: true, // 启用 LSP 诊断（TypeScript + ESLint），默认 true
    enablePrettier: true, // 启用代码格式化，默认 true
  },

  // === 自定义日志文件（让 AI 能读取外部服务日志）===
  logFiles: [
    {
      name: "backend-logs",
      path: "/path/to/backend.log",
      description: "后端服务错误日志",
    },
  ],
});
```

> 旧写法（顶层 `language` / `settings` / `enableLsp` / `enablePrettier`）仍兼容，但已废弃，推荐统一迁移到 `providerOptions` 段。

## 配置项速查表

| 配置项                               | 类型      | 默认值        | 说明              |
| ------------------------------------ | --------- | ------------- | ----------------- |
| `enabled`                            | `boolean` | `true`        | 是否启用          |
| `provider`                           | `string`  | `"default"`   | AI 引擎（"default"→opencode，另可选 "deepseek"） |
| `webPort`                            | `number`  | `5097`        | AIPanel Web 端口  |
| `proxyPort`                          | `number`  | `6097`        | 代理端口          |
| `hostname`                           | `string`  | `"127.0.0.1"` | 服务地址          |
| `theme`                              | `string`  | `"dark"`      | 主题              |
| `hotkey`                             | `string`  | `"ctrl+k"`    | 快捷键            |
| `verbose`                            | `boolean` | `false`       | 详细日志          |
| `mcpOnly`                            | `boolean` | `false`       | 纯净 MCP 模式     |
| `warmupChromeMcp`                    | `boolean` | `true`        | 预热 Chrome MCP   |
| `chromeDevtoolsPort`                 | `number`  | `9222`        | Chrome 调试端口   |
| `providerOptions.language`           | `string`  | -             | 界面语言          |
| `providerOptions.settings`           | `object`  | -             | Provider 内部设置 |
| `providerOptions.enableLsp`          | `boolean` | `true`        | LSP 诊断          |
| `providerOptions.enablePrettier`     | `boolean` | `true`        | 代码格式化        |
| `logFiles`                           | `array`   | -             | 自定义日志文件    |

### 纯净 MCP 模式（mcpOnly）

`mcpOnly: true` 时插件只暴露 MCP 工具服务（Chrome DevTools 控制、Vue DevTools、日志读取等），
不注入悬浮挂件、不启动 OpenCode/dsh Web 进程，适合作为独立 MCP server 供外部 Agent 消费。
所有工具完整可用：`chrome-devtools_*`（页面操作/截图/网络/控制台）、`vue-devtools_*`（组件树/状态/路由）、
`logs-devtools_*`（日志）。页面会静默注入上下文上报脚本（无 UI 副作用），
因此 `chrome-devtools_current_page` 也能感知当前浏览页面。

```ts
aipanelAssistant({
  mcpOnly: true,
});
```

启动后 MCP 端点固定挂在 Vite dev server 上（需保持 `vite dev` 运行），外部 MCP 客户端配置
Streamable HTTP 即可接入：

```
http://localhost:5173/__aipanel_mcp__
```

> 端口随 Vite dev server 变化（默认 5173），以实际输出日志中的 `MCP endpoint` 地址为准。

#### MCP 客户端接入示例

兼容 `mcpServers` 标准结构的客户端（Claude Code / Cursor 等）均可直接接入，
把 `aipanel` 注册为 Streamable HTTP 类型的 server：

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

- **Claude Code**：写入项目根目录 `.mcp.json`，或在终端执行
  `claude mcp add --transport http aipanel http://localhost:5173/__aipanel_mcp__`；
- **Cursor**：写入项目根目录 `.cursor/mcp.json`；
- 其他客户端：按其文档把上述 `mcpServers` 片段放入对应配置文件即可。

> 端点无需鉴权。URL 端口须与当前 `vite dev` 端口一致（默认 5173），以启动日志中的
> `MCP endpoint` 地址为准。

### logFiles 说明

配置后 AI 可获得 `get_{name}_logs` 工具，查看指定日志文件的最近 50 条（最多 200 条）：

```ts
logFiles: [
  {
    name: "backend-logs", // 生成工具名 get_backend-logs_logs
    path: "/path/to/error.log", // 日志文件绝对路径
    description: "后端错误日志", // 告诉 AI 何时使用
  },
];
```

> 详见 [Vite 插件配置完整参考](https://github.com/code-farmer-i/vite-plugin-aipanel) 获取 `settings` 全部子配置项。

### 选择 AI 引擎

`provider` 字段用于选择 AI 引擎，当前内置两套：

| provider   | 引擎                   | 额外依赖                        |
| ---------- | ---------------------- | ------------------------------- |
| `opencode` | OpenCode CLI（默认）   | 无（插件内置）                  |
| `deepseek` | DeepSeek Harness (dsh) | 需另装 `@aipanel/provider-deepseek` |

使用 **OpenCode** 引擎无需额外操作（插件已内置）。若要用 **dsh** 引擎，需先安装其 provider 包：

```bash
npm install -D @aipanel/provider-deepseek
```

`providerOptions` 段承载各引擎专属配置。**OpenCode** 引擎的配置见上方「完整配置」。切换到 **dsh** 引擎：

```ts
aipanelAssistant({
  provider: "deepseek",
  providerOptions: {
    home: "~/.dsh",                 // dsh 数据目录（$DSH_HOME），默认跟随系统 ~/.dsh
    agentPreset: "standard",        // 新建会话的默认 Agent 预设
    permissionPreset: "read-only",  // 默认权限预设：read-only | workspace-write | danger-full-access
    busyEnter: "queue",             // 繁忙时 Enter 行为：queue | steer
  },
});
```

#### DeepSeek (dsh) 配置项速查

| 配置项                              | 类型     | 默认值     | 说明                                        |
| ----------------------------------- | -------- | ---------- | ------------------------------------------- |
| `providerOptions.home`              | `string` | `~/.dsh`   | dsh 数据目录（`$DSH_HOME`）                 |
| `providerOptions.agentPreset`       | `string` | -          | 新建会话的默认 Agent 预设                   |
| `providerOptions.permissionPreset`  | `string` | -          | 默认权限预设                                |
| `providerOptions.busyEnter`         | `string` | -          | 繁忙时 Enter 行为（`queue` / `steer`）      |