# Vite 插件配置

Vite 插件负责启动 OpenCode Web 服务，是浏览器扩展正常工作所必需的。默认配置即可满足大多数场景，以下配置用于高级定制。

## 安装

```bash
npm install -D vite-plugin-opencode-assistant
```

## 最小配置

```ts
import { defineConfig } from "vite";
import opencodeAssistant from "vite-plugin-opencode-assistant";

export default defineConfig({
  plugins: [opencodeAssistant()],
});
```

## 完整配置

```ts
import opencodeAssistant from "vite-plugin-opencode-assistant";

opencodeAssistant({
  // === 基础配置 ===
  enabled: true, // 是否启用，默认 true
  webPort: 5097, // OpenCode Web 端口，默认 5097
  proxyPort: 6097, // 代理端口，默认 6097
  hostname: "127.0.0.1", // 绑定地址
  verbose: false, // 详细日志

  // === 主题与行为 ===
  theme: "auto", // light | dark | auto
  hotkey: "ctrl+k", // 面板快捷键
  language: "zh", // OpenCode 界面语言

  // === Chrome DevTools MCP ===
  warmupChromeMcp: true, // 启动时预热 Chrome DevTools
  chromeDevtoolsPort: 9222, // Chrome 调试端口

  // === OpenCode 内部设置 ===
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

## 配置项速查表

| 配置项               | 类型      | 默认值        | 说明              |
| -------------------- | --------- | ------------- | ----------------- |
| `enabled`            | `boolean` | `true`        | 是否启用          |
| `webPort`            | `number`  | `5097`        | OpenCode Web 端口 |
| `proxyPort`          | `number`  | `6097`        | 代理端口          |
| `hostname`           | `string`  | `"127.0.0.1"` | 服务地址          |
| `theme`              | `string`  | `"auto"`      | 主题              |
| `hotkey`             | `string`  | `"ctrl+k"`    | 快捷键            |
| `verbose`            | `boolean` | `false`       | 详细日志          |
| `warmupChromeMcp`    | `boolean` | `true`        | 预热 Chrome MCP   |
| `chromeDevtoolsPort` | `number`  | `9222`        | Chrome 调试端口   |
| `language`           | `string`  | -             | 界面语言          |
| `settings`           | `object`  | -             | OpenCode 内部设置 |
| `logFiles`           | `array`   | -             | 自定义日志文件    |

### logFiles 说明

配置后 AI 可获得 `get_{name}_logs` 工具，查看指定日志文件的最近 200 行：

```ts
logFiles: [
  {
    name: "backend-logs", // 生成工具名 get_backend-logs_logs
    path: "/path/to/error.log", // 日志文件绝对路径
    description: "后端错误日志", // 告诉 AI 何时使用
  },
];
```

> 详见 [Vite 插件配置完整参考](https://github.com/opencode-ai/vite-plugin-opencode-assistant) 获取 `settings` 全部子配置项。
