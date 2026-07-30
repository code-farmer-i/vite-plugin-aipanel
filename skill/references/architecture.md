# 架构概览

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     用户浏览器                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Vite Dev Server (localhost:5173)                     │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Widget Client (Vue 3 App)                      │  │  │
│  │  │  - App.vue (主控制器)                            │  │  │
│  │  │  - useServerSSE (SSE 事件)                      │  │  │
│  │  │  - useOpencodeSessionSSE (会话 SSE)             │  │  │
│  │  │  - useSessions (会话管理)                        │  │  │
│  │  │  - usePageContext (上下文同步)                   │  │  │
│  │  │  - useSelectedElements (元素选择)                │  │  │
│  │  │  - useTheme (主题管理)                           │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                              │ iframe                  │  │
│  │                              ▼                         │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Proxy Server (localhost:6097)                   │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  OpenCode Web (localhost:5097)             │  │  │  │
│  │  │  │  - AI Chat UI                              │  │  │  │
│  │  │  │  - Session Management                      │  │  │  │
│  │  │  │  - Plugin System:                          │  │  │  │
│  │  │  │    · Page Context Plugin                   │  │  │  │
│  │  │  │    · Vite Logs Plugin                      │  │  │  │
│  │  │  │    · Service Logs Plugin (可选)             │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 核心组件

### Vite 插件（packages/vite）

- **index.ts** - 插件入口，注册 `configureServer` 和 `transformIndexHtml` 钩子
- **service.ts** - `OpenCodeService`，管理 OpenCode 进程的启动/停止，端口分配
- **api.ts** - `OpenCodeAPI`，封装 OpenCode REST API 调用（会话、模型等）
- **opencode-web.ts** - OpenCode Web 进程管理，准备运行时环境和插件
- **proxy-server.ts** - 代理服务器，注入 Bridge 脚本解决 iframe 跨域
- **injector.ts** - 挂件注入，在 HTML 中插入 widget 脚本和样式
- **endpoints/** - HTTP 端点（start/context/sessions/SSE/logs/warmup/widget）

### 客户端（packages/client）

- **App.vue** - 主控制器，组合所有 composable
- **composables/** - 功能模块：
  - `useServerSSE` - 监听服务事件
  - `useOpencodeSessionSSE` - 监听 OpenCode 会话事件
  - `useSessions` - 会话管理
  - `usePageContext` - 普通模式页面上下文
  - `useExtensionContext` - 扩展模式页面上下文
  - `useSelectedElements` - 元素选择持久化
  - `useTheme` - 主题管理
  - `useServiceStatus` - 服务状态管理
  - `useHotkey` - 快捷键注册
  - `useExtensionMode` / `useExtensionSelectorMode` - 扩展模式

### OpenCode 插件（packages/opencode）

- **page-context.ts** - 将页面上下文注入 AI system prompt
- **vite-logs.ts** - 提供 `get_vite_dev_logs` 工具给 Agent
- **service-logs.ts** - 提供 `get_{name}_logs` 工具给 Agent（自定义日志文件）

### 共享库（packages/shared）

- **types.ts** - 所有类型定义
- **constants.ts** - 常量（路径、端口、超时等）
- **logger.ts** - 日志系统
- **process-logger.ts** - 进程日志缓冲区
- **file-log-watcher.ts** - 文件日志读取

## 启动流程

1. Vite dev server 启动 → `configureServer` 钩子触发
2. 注册中间件（HTTP 端点）
3. `server.httpServer.on("listening")` 事件触发
4. `service.start()` 启动 OpenCode 服务：
   - 清理孤儿 OpenCode 进程
   - 检查 OpenCode CLI ✅
   - 分配可用端口
   - 准备运行时环境（复制插件、生成 MCP 配置）
   - 启动 OpenCode Web 进程
   - 等待 Web 就绪（最多 5 分钟）
   - 启动代理服务器
   - 预热 Chrome DevTools MCP（可选）
   - 创建初始会话
5. `transformIndexHtml` 在 HTML 中注入 Widget 脚本
6. 浏览器加载 Widget → 连接 SSE → 获取会话 → 显示面板

## 数据流

### 页面上下文同步

```
浏览器页面变化 → Widget Client 检测 → POST /__opencode_context__
→ OpenCode PageContextPlugin 读取 → 注入 System Prompt
→ AI 理解用户当前所在页面
```

### 元素选择

```
用户点击页面元素 → Vue Inspector 获取源码位置
→ Widget Client 收集信息 → POST /__opencode_context__
→ postMessage 到 iframe → Bridge Script 插入 File Part 到输入框
→ AI 收到元素上下文
```

### 日志查看

```
AI Agent 调用 get_vite_dev_logs 工具
→ OpenCode ViteLogsPlugin → GET /__opencode_process_logs__
→ 内存缓冲区查询 → 返回格式化日志
```

## 关键技术点

- **iframe 跨域**：通过代理服务器同源化 OpenCode Web，注入 Bridge 脚本实现双向通信
- **SSE 双通道**：Vite Server SSE（服务状态）+ OpenCode Session SSE（会话思考状态）
- **端口自动分配**：端口被占用时递增寻找（10 次），web 和 proxy 避免冲突
- **Chrome MCP 预热**：创建临时会话测试 AI → 验证 tool 可用 → 清理临时会话
- **SPA 路由同步**：拦截 History API + popstate/hashchange，500ms 去抖
- **孤儿进程清理**：启动前检查并 kill PPID=1 的 opencode 进程
