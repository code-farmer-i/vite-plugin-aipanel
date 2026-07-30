# 配置参考

## 完整配置示例

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
  open: false, // 页面加载后自动展开
  hotkey: "ctrl+k", // 面板快捷键
  language: "zh", // OpenCode 界面语言

  // === 展示模式 ===
  displayMode: "bubble", // bubble | split | auto | extension

  // === 分屏模式（displayMode: "split" 时生效）===
  splitMode: {
    width: 500, // 面板宽度
    minWidth: 400, // 最小宽度
    maxWidth: 800, // 最大宽度
    resizable: true, // 可拖拽调整宽度
    shrinkPage: true, // 收缩主页面
    defaultOpen: true, // 默认展开
    position: "right", // left | right
  },

  // === Chrome DevTools MCP ===
  warmupChromeMcp: true, // 启动时预热 Chrome DevTools
  chromeDevtoolsPort: 9222, // Chrome 调试端口

  // === OpenCode 内部设置 ===
  settings: {
    general: {
      showReasoningSummaries: true, // 显示推理摘要
      newLayoutDesigns: true, // 使用新版布局
      showFileTree: false, // 显示文件树
      shellToolPartsExpanded: true, // 默认展开 Shell 工具
      followup: "suggest", // steer | suggest | none
      autoSave: false,
    },
    appearance: {
      fontSize: 14,
      mono: "JetBrains Mono",
      sans: "Inter",
    },
    permissions: {
      autoApprove: false, // 自动批准权限
    },
    notifications: {
      agent: true, // Agent 完成通知
      permissions: true, // 权限请求通知
      errors: true, // 错误通知
    },
  },

  // === 自定义日志文件（为 Agent 提供外部服务日志）===
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

| 配置项               | 类型                                                                   | 默认值        | 说明              |
| -------------------- | ---------------------------------------------------------------------- | ------------- | ----------------- |
| `enabled`            | `boolean`                                                              | `true`        | 是否启用          |
| `webPort`            | `number`                                                               | `5097`        | OpenCode Web 端口 |
| `proxyPort`          | `number`                                                               | `6097`        | 代理端口          |
| `hostname`           | `string`                                                               | `"127.0.0.1"` | 服务地址          |
| `theme`              | `"light" \| "dark" \| "auto"`                                          | `"auto"`      | 主题              |
| `open`               | `boolean`                                                              | `false`       | 自动展开面板      |
| `hotkey`             | `string`                                                               | `"ctrl+k"`    | 快捷键            |
| `verbose`            | `boolean`                                                              | `false`       | 详细日志          |
| `displayMode`        | `"bubble" \| "split" \| "auto" \| "extension" \| "extension-selector"` | `"bubble"`    | 展示模式          |
| `warmupChromeMcp`    | `boolean`                                                              | `true`        | 预热 Chrome MCP   |
| `chromeDevtoolsPort` | `number`                                                               | `9222`        | Chrome 调试端口   |
| `language`           | `string`                                                               | -             | 界面语言          |
| `settings`           | `object`                                                               | -             | OpenCode 内部设置 |
| `logFiles`           | `LogFileConfig[]`                                                      | -             | 自定义日志文件    |

## displayMode 选择指南

- **bubble**：最常用。右下角悬浮按钮，不占用页面空间
- **split**：面板固定在页面一侧，适合需要持续查看对话的场景
- **auto**：自动模式，面板内可自由切换 bubble/split/auto
- **extension**：浏览器扩展模式，利用扩展的独立侧边栏
- **extension-selector**：扩展模式+选择器模式，适合需要频繁选中元素的场景
