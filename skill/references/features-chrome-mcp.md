# Chrome DevTools MCP

## 功能说明

Chrome DevTools MCP 让 OpenCode Agent 能够通过浏览器自动化工具来：

- 获取页面 DOM 快照
- 执行 JavaScript
- 模拟用户交互
- 截图和调试

插件在服务启动时会自动**预热** Chrome DevTools MCP，验证连接可用性。

## 前置条件

Chrome 需要以远程调试模式启动：

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Windows
chrome.exe --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

配置插件指定调试端口（如果使用非默认端口）：

```ts
opencodeAssistant({
  chromeDevtoolsPort: 9222, // 默认值
});
```

## 预热验证

插件启动时会自动检查 Chrome DevTools MCP 是否可用。如果验证通过，面板显示"准备完成"，AI 可正常使用浏览器工具。

### 预热失败

如果预热失败，面板会显示错误提示，包含：

| 错误类型               | 含义                  | 解决方案                                      |
| ---------------------- | --------------------- | --------------------------------------------- |
| `CHROME_NOT_CONNECTED` | Chrome 远程调试未开启 | 以 `--remote-debugging-port=9222` 启动 Chrome |
| `AI_TIMEOUT`           | AI 60 秒未响应        | 检查 AI 模型配置和网络                        |
| `AI_RESPONSE_ERROR`    | AI 响应不含 "ready"   | 检查 AI 模型是否支持 tool 调用                |
| `SESSION_ERROR`        | 预热会话创建失败      | 检查 OpenCode 服务状态                        |
| `UNKNOWN`              | 未知错误              | 查看日志                                      |

### 手动重试

预热失败后可以手动重试：

- 面板会显示错误界面和可用模型列表
- 选择一个模型后点击重试
- 也可以使用默认模型直接重试

## 在 AI 对话中使用

预热成功后，AI Agent 在需要时可以自动调用 Chrome DevTools MCP 工具。AI 在以下场景会自动使用：

- 需要查看页面实际 DOM 结构时
- 元素选择器的 `filePath` 为空，需要定位元素时
- 需要截图确认修改效果时
- 需要模拟用户操作测试功能时

## 关闭预热

如果不使用 Chrome DevTools MCP：

```ts
opencodeAssistant({
  warmupChromeMcp: false,
});
```
