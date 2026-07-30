# 日志查看（给 Agent）

## Vite 开发服务器日志

OpenCode Agent 可以查看 Vite 开发服务器的运行日志，帮助排查问题。

### 可用的 Agent 工具

Agent 自动获得以下工具：

#### `get_vite_dev_logs`

获取 Vite 开发服务器进程日志（内存缓冲区，最近 500 条）。

**参数：**

| 参数     | 类型     | 默认值 | 说明                                                                                  |
| -------- | -------- | ------ | ------------------------------------------------------------------------------------- |
| `level`  | `string` | -      | 日志级别：`error`, `warn`, `info`, `debug`, `log`。多个逗号分隔                       |
| `limit`  | `number` | `50`   | 返回条数，最大 200                                                                    |
| `source` | `string` | -      | 来源过滤：`console`(控制台), `opencode-stdout`(服务输出), `opencode-stderr`(服务错误) |

**包含的日志内容：**

- Vite HMR 热更新日志
- 构建编译日志
- OpenCode Web 进程输出
- 插件运行日志

**何时使用：**

- 用户报告"页面没更新"、"HMR 失效"
- 构建报错或编译失败
- 页面白屏、样式丢失、模块加载失败
- 用户提到"开发服务器有问题"

**使用示例（Agent 对话中）：**

```
用户："页面怎么没更新？"
Agent → 调用 get_vite_dev_logs({ level: "error,warn", limit: 30 })
       → 发现 HMR 错误 "circular dependency"
       → 告知用户存在循环依赖问题
```

### HTTP API 查询日志

也可以直接通过 HTTP API 查询：

```bash
# 查询所有日志
curl "http://localhost:5173/__opencode_process_logs__"

# 只查错误和警告，最近 20 条
curl "http://localhost:5173/__opencode_process_logs__?level=error,warn&limit=20"

# 只查 OpenCode 服务输出
curl "http://localhost:5173/__opencode_process_logs__?source=opencode-stdout"

# 按时间过滤
curl "http://localhost:5173/__opencode_process_logs__?since=2026-07-10T10:00:00.000Z"

# 清空日志缓冲
curl -X DELETE http://localhost:5173/__opencode_process_logs__
```

返回格式：

```json
{
  "logs": [
    {
      "timestamp": "2026-07-10T12:00:00.000Z",
      "level": "error",
      "source": "vite",
      "message": "Failed to resolve module..."
    }
  ],
  "meta": {
    "total": 120,
    "returned": 10,
    "filters": { "level": ["error"], "limit": 10 }
  }
}
```

## 自定义日志文件

可以为 Agent 配置外部服务的日志文件，让 Agent 在需要时读取。

### 如何生成本地日志

运行命令时，使用 `tee` 将输出同时写入文件：

```bash
# 将命令输出写入日志文件
FORCE_COLOR=1 npm run dev | tee /tmp/vite-dev.log

# 调试特定工具
FORCE_COLOR=1 slr debug | tee /tmp/cost-of-use-slr-debug.log

# 追加模式（不覆盖已有内容）
npm run build 2>&1 | tee -a /tmp/build-output.log

# 仅捕获错误输出
some-command 2>&1 >/dev/null | tee /tmp/error-only.log
```

> **建议**：使用 `/tmp/` 目录存放临时日志，系统重启后自动清理。

### 配置插件

生成日志文件后，在 `vite.config.ts` 中配置：

```ts
opencodeAssistant({
  logFiles: [
    {
      name: "backend-logs", // 工具名 get_backend-logs_logs
      path: "/path/to/backend/logs/error.log", // 日志文件绝对路径
      description: "后端服务错误日志，排查 API 报错使用", // 告诉 Agent 何时用
    },
    {
      name: "slr-debug", // 工具名 get_slr-debug_logs
      path: "/tmp/cost-of-use-slr-debug.log",
      description: "SLR 调试日志，排查费用计算问题使用",
    },
  ],
});
```

配置后，Agent 会自动获得 `get_{name}_logs` 工具，可以查看指定日志文件的最近 200 行。

## 日志缓冲区

日志保存在**内存缓冲区**中：

- 最大容量：**500 条**
- 超出容量时自动丢弃最早的日志
- 重启开发服务器后缓冲区清空
- 可通过 `DELETE /__opencode_process_logs__` 手动清空
