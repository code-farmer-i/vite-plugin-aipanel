# 内部 API 端点参考

插件在 Vite 开发服务器上注册以下 HTTP 端点。所有端点支持 CORS。

## 端点总览

| 路径 | 方法 | 说明 |
|------|------|------|
| `/__opencode_start__` | GET | 服务状态和端口信息 |
| `/__opencode_sessions__` | GET/POST/DELETE | 会话 CRUD |
| `/__opencode_events__` | GET (SSE) | 服务事件流 |
| `/__opencode_context__` | GET/POST/DELETE | 页面上下文 |
| `/__opencode_logs__` | GET/DELETE | 进程日志 |
| `/__opencode_warmup__` | GET/POST | Chrome MCP 预热 |
| `/__opencode_widget__.js` | GET | 挂件脚本 |
| `/__opencode_widget__.css` | GET | 挂件样式 |

---

## `GET /__opencode_start__`

获取服务启动状态。

```bash
curl http://localhost:5173/__opencode_start__
```

**响应：**
```json
{
  "success": true,
  "proxyPort": 6097,
  "webPort": 5097,
  "projectRoot": "/path/to/project",
  "serviceInstanceId": "uuid-string"
}
```

---

## `/__opencode_sessions__`

### GET - 获取会话列表

```bash
curl http://localhost:5173/__opencode_sessions__
```

**响应：** `SessionInfo[]`
```json
[
  {
    "id": "session-123",
    "slug": "...",
    "projectID": "...",
    "directory": "/path/to/project",
    "title": "优化首页加载速度",
    "version": "v1",
    "url": "http://127.0.0.1:6097/base64path/session/session-123",
    "summary": { "additions": 42, "deletions": 10, "files": 3 },
    "time": { "created": 1720000000000, "updated": 1720000001000 }
  }
]
```

### POST - 创建会话

```bash
curl -X POST http://localhost:5173/__opencode_sessions__
```

**响应：** `SessionInfo` (新会话，包含 url 字段)

### DELETE - 删除会话

```bash
curl -X DELETE "http://localhost:5173/__opencode_sessions__?id=SESSION_ID"
```

---

## `GET /__opencode_events__` (SSE)

Server-Sent Events 事件流，建立长连接接收服务状态更新。

```bash
curl -N http://localhost:5173/__opencode_events__
```

**事件类型：**

| 事件 | 说明 | 数据格式 |
|------|------|----------|
| `CONNECTED` | 客户端连接成功 | `{ "type": "CONNECTED" }` |
| `STATUS_SYNC` | 服务状态同步 | `{ "type": "STATUS_SYNC", "isStarted": true, "task": "ready" }` |
| `TASK_UPDATE` | 任务状态更新 | `{ "type": "TASK_UPDATE", "task": "warming_up_chrome" }` |
| `CLEAR_ELEMENTS` | 清除选中元素 | `{ "type": "CLEAR_ELEMENTS" }` |

**TASK_UPDATE 的 task 可能值：**

| task | 说明 |
|------|------|
| `checking_opencode` | 检查 OpenCode 安装 |
| `allocating_port` | 分配服务端口 |
| `preparing_runtime` | 准备运行环境 |
| `starting_web` | 启动 OpenCode Web |
| `waiting_web_ready` | 等待服务就绪（最长 5 分钟） |
| `starting_proxy` | 启动代理服务 |
| `warming_up_chrome` | 预热 Chrome DevTools MCP |
| `creating_session` | 创建初始会话 |
| `ready` | 全部就绪 |
| `opencode_not_installed` | OpenCode 未安装 |
| `web_start_timeout` | 服务启动超时 |
| `chrome_mcp_failed` | Chrome MCP 预热失败（附 errorType/errorMessage） |

---

## `/__opencode_context__`

### GET - 读取页面上下文

```bash
curl http://localhost:5173/__opencode_context__
```

**响应：**
```json
{
  "url": "http://localhost:5173/products/42",
  "title": "商品详情",
  "selectedElements": [
    {
      "filePath": "/src/components/Button.vue",
      "line": 15,
      "column": 3,
      "innerText": "提交",
      "description": "button.btn-primary"
    }
  ]
}
```

### POST - 更新页面上下文

```bash
curl -X POST http://localhost:5173/__opencode_context__ \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:5173/page","title":"新页面","selectedElements":[]}'
```

### DELETE - 清空选中元素

```bash
curl -X DELETE http://localhost:5173/__opencode_context__
```

清空后通过 SSE 广播 `CLEAR_ELEMENTS` 事件通知所有客户端。

---

## `/__opencode_logs__`

详见 [features-logs](features-logs.md)

---

## `/__opencode_warmup__`

### GET - 获取可用模型列表

```bash
curl http://localhost:5173/__opencode_warmup__
```

**响应：**
```json
{
  "success": true,
  "models": [
    { "providerID": "openai", "modelID": "gpt-4o-mini", "name": "GPT-4o Mini", "inputCost": 0.15, "releaseDate": "..." }
  ]
}
```

模型按 `inputCost` 升序排列。

### POST - 重试 Chrome MCP 预热

```bash
# 默认模型
curl -X POST http://localhost:5173/__opencode_warmup__

# 指定模型
curl -X POST http://localhost:5173/__opencode_warmup__ \
  -H "Content-Type: application/json" \
  -d '{"providerID":"openai","modelID":"gpt-4o-mini"}'
```

**响应（成功）：**
```json
{ "success": true }
```

**响应（失败）：**
```json
{
  "success": false,
  "errorType": "CHROME_NOT_CONNECTED",
  "error": "Chrome DevTools Protocol is not available"
}
```

---

## Widget 端点

- **`/__opencode_widget__.js`**：浏览器端挂件脚本（通过 `transformIndexHtml` 注入到 HTML）
- **`/__opencode_widget__.css`**：挂件样式文件
- **`/__opencode_bridge__.js`**：代理服务注入的 Bridge 脚本（主题同步、输入框操作等）
