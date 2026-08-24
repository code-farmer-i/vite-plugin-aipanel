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
  provider: "opencode", // Web Provider 标识，默认 "default"（当前仅内置 opencode）
  webPort: 5097, // AIPanel Web 端口，默认 5097
  proxyPort: 6097, // 代理端口，默认 6097
  hostname: "127.0.0.1", // 绑定地址
  verbose: false, // 详细日志

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
    enableBlockOnError: false, // 编辑有错误时回滚文件并拒绝修改，默认 false
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

> 旧写法（顶层 `language` / `settings` / `enableLsp` / `enableBlockOnError` / `enablePrettier`）仍兼容，但已废弃，推荐统一迁移到 `providerOptions` 段。

## 配置项速查表

| 配置项                               | 类型      | 默认值        | 说明              |
| ------------------------------------ | --------- | ------------- | ----------------- |
| `enabled`                            | `boolean` | `true`        | 是否启用          |
| `provider`                           | `string`  | `"default"`   | Web Provider 标识 |
| `webPort`                            | `number`  | `5097`        | AIPanel Web 端口  |
| `proxyPort`                          | `number`  | `6097`        | 代理端口          |
| `hostname`                           | `string`  | `"127.0.0.1"` | 服务地址          |
| `theme`                              | `string`  | `"dark"`      | 主题              |
| `hotkey`                             | `string`  | `"ctrl+k"`    | 快捷键            |
| `verbose`                            | `boolean` | `false`       | 详细日志          |
| `warmupChromeMcp`                    | `boolean` | `true`        | 预热 Chrome MCP   |
| `chromeDevtoolsPort`                 | `number`  | `9222`        | Chrome 调试端口   |
| `providerOptions.language`           | `string`  | -             | 界面语言          |
| `providerOptions.settings`           | `object`  | -             | Provider 内部设置 |
| `providerOptions.enableLsp`          | `boolean` | `true`        | LSP 诊断          |
| `providerOptions.enableBlockOnError` | `boolean` | `false`       | 编辑错误回滚      |
| `providerOptions.enablePrettier`     | `boolean` | `true`        | 代码格式化        |
| `logFiles`                           | `array`   | -             | 自定义日志文件    |

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
