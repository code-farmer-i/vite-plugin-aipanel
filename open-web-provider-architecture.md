# 开放 Web 接入架构设计

> 目标：核心框架与具体的 Web UI 解耦，未来可接入任意 Web UI（Provider）。核心层只依赖通用协议，具体 Web UI 的一切细节沉入 Provider 实现。

## 1. 背景与目标

当前框架从进程管理、后端 API、前端桥接、事件协议到数据模型，全链路绑定默认 Web UI。本方案引入 **Provider 适配器模式**，把绑定关系收敛到单个适配层：

- 核心层（provider 无关）：插件入口、服务编排、通用端点、客户端组合逻辑、共享协议
- 适配器层：`WebProvider` 接口
- 具体 Provider：默认 Provider（现有实现迁入）+ 未来其他 Web

## 2. 现状耦合点分析

对任意具体 Web UI 的集成，耦合通常分布在以下层：

| 层              | 耦合内容                                                           |
| --------------- | ------------------------------------------------------------------ |
| 进程管理        | 直接 spawn 特定 CLI、生成 provider 专属配置文件、绑定安装/版本检查 |
| 后端 API        | provider 私有 REST 接口、私有会话 URL 路由                         |
| 代理 + 桥接脚本 | 桥接脚本绑定 provider 专属 DOM 结构与 localStorage 键              |
| 事件协议        | 私有 SSE/WS 端点 + 私有事件 schema                                 |
| 数据模型与过滤  | provider 专属会话字段、专属过滤语义（如内部预热会话）              |
| 配置模型        | 配置项语义绑定 provider                                            |

> 依赖 provider 插件系统的 agent 侧能力（上下文注入、日志工具等）随 Provider 一起下沉。

## 3. 目标架构

```
┌────────────────── 核心层（provider 无关）──────────────────┐
│ 插件入口 / 服务编排(WebService) / 通用端点(sessions/sse/...) │
│ 客户端: useSessions / useSessionEvents / 主题 / 元素选择     │
│ 共享协议: ChatSession / ProviderEvent / 上下文               │
├────────────────── 适配器层（WebProvider 接口）──────────────┤
│ checkEnvironment / start / stop / 会话CRUD / buildSessionUrl │
│ subscribeEvents / bridgeScript / applyConfig                 │
├────────────────── 具体 Provider ────────────────────────────┤
│ 默认 Provider（现有实现迁入: CLI + API 适配 + 桥接脚本）     │
│ FutureProvider（任意 Web UI，按接口实现）                    │
└──────────────────────────────────────────────────────────────┘
```

## 4. 核心接口定义

### 4.1 WebProvider

```ts
// packages/shared/src/provider.ts
export interface WebProvider {
  readonly id: string; // 如 "default"
  readonly displayName: string; // 展示名称

  /** 校验运行环境（CLI 是否安装、版本） */
  checkEnvironment(): Promise<{ ok: boolean; version?: string; message?: string }>;

  /** 启动 Web 服务，返回进程句柄与就绪 URL */
  start(options: ProviderStartOptions): Promise<ProviderStartResult>;

  /** 停止服务 */
  stop(): Promise<void>;

  /** 会话管理（归一化到 ChatSession，过滤逻辑在此内部完成） */
  listSessions(projectDir: string): Promise<ChatSession[]>;
  createSession(projectDir: string, title?: string): Promise<ChatSession>;
  /** 可选：部分 provider 无删除语义（如会话为 append-only log）；core 不支持时隐藏删除入口 */
  deleteSession?(sessionId: string): Promise<void>;

  /** 会话打开 URL（iframe src） */
  buildSessionUrl(projectDir: string, sessionId: string): string;

  /** 事件订阅：把提供方私有事件归一化为 ProviderEvent */
  subscribeEvents(handler: (e: ProviderEvent) => void): () => void;

  /** 代理注入到 HTML 的 provider 侧桥接脚本（可选） */
  bridgeScript?: string;

  /** provider 初始化配置（主题/语言/设置，schema 由 provider 定义） */
  applyConfig?(config: ProviderConfig): void;
}
```

### 4.2 归一化数据模型

```ts
export interface ChatSession {
  id: string;
  title: string;
  createdAt?: number;
  updatedAt?: number;
  archived?: boolean;
  parentId?: string;
  url?: string; // 由 buildSessionUrl 填充
}

export type SessionStatus = "idle" | "running" | "streaming" | "completed";

export type ProviderEvent =
  | { type: "connected" }
  | { type: "session.updated"; session: ChatSession } // 标题/摘要变化
  | { type: "session.status"; sessionId: string; status: SessionStatus }
  | { type: "thinking"; sessionId: string; thinking: boolean }; // 由 adapter 自己推导
```

### 4.3 Provider 注册表

```ts
type ProviderFactory = (ctx: ProviderContext) => WebProvider;
registerProvider("default", (ctx) => new DefaultWebProvider(ctx));
// 使用: { provider: "default" } 或用户自定义 provider id
```

## 5. 关键设计决策

### 5.1 事件归一化（服务端归一化 + 单通道）

**现状**：浏览器直连 provider 的私有事件端点，客户端解析 provider 私有事件，并靠私有推断规则推导 thinking 状态。

**方案**：Provider 适配器在服务端（vite 插件侧）消费 provider 事件流，翻译为 `ProviderEvent`，复用现有事件通道推给浏览器。浏览器只消费归一化事件，双 SSE 通道合并为一条。

```
provider 事件流 ──→ Provider.subscribeEvents ──→ ProviderEvent
（服务端直连，无 CORS/鉴权）                          │
                                             ┌──────▼──────┐
    现有服务事件通道（合并推送） ←────────────┘ 归一化事件    │
    浏览器 useServerSSE ←──────────────────────────────────┘
```

- thinking 推导整体沉入 adapter，客户端推断逻辑消失
- 客户端状态机退化为：`session.status` 直接写入、`thinking` 直接写入
- `useServerSSE` 的 `ServerSSEMessage` 为 union + switch，扩展一个 `SESSION_EVENT` 分支即可
- 扩展侧边栏复用同一份 client App，一处改造全端生效
- 服务端订阅需自带断线重连（provider 进程重启场景）

### 5.2 桥接脚本资产化

桥接脚本混合两类内容：

- **通用协议（留在 core）**：`WIDGET_MSG` postMessage 消息（SET_THEME / INSERT_FILE_PART / MINIMIZE_STATE / REVIEW_PANEL_TOGGLE / KEYDOWN / READY）、键盘转发、HTML 注入逻辑
- **provider 专属实现（下沉 provider）**：DOM 选择器、localStorage 键、媒体查询劫持、布局 CSS override

改造：postMessage 协议是"接口"，桥接脚本是"实现"。core 代理只做同源转发 + 注入 `provider.bridgeScript`；provider 专属类型随 `applyConfig` 一并移出 core。

### 5.3 会话模型归一化

- provider 私有会话类型 → `ChatSession` 映射在 provider 内完成
- "按目录匹配当前项目会话"的语义下沉为 provider 内部逻辑
- 客户端会话过滤逻辑移入 `Provider.listSessions`
- 组件层消费的会话类型已泛化，泄漏点为客户端映射时的字段透传，收敛即可

### 5.4 生命周期与配置边界

- **留在 core（编排）**：端口分配、就绪等待、代理启动、SSE 广播、预热编排、服务状态机
- **下沉 provider**：CLI 命令与参数、env、配置文件生成、版本/安装检查、state 目录布局
- `ServiceStartupTask` 中的 provider 专属 task 名泛化为通用命名（如 `checking_provider`/`provider_not_installed`）
- 配置演进：新增 `provider?: string` 选择实现，provider 专属字段收敛到 `providerId?: {...}` 命名空间；旧顶层字段保留读取（标 deprecated）

### 5.5 预热（已确认 provider 无关）

预热仅依赖 MCP 标准协议，不创建 provider 会话；预留的预热会话过滤为遗留代码（无创建方）。因此预热不需要 `warmup?()` 可选方法，预热编排留在 core。

## 6. 可行性核验结论

| 设计点           | 结论            | 关键证据                                                   |
| ---------------- | --------------- | ---------------------------------------------------------- |
| 事件服务端归一化 | ✅ 可行         | provider 事件端点无鉴权、本地直连无 CORS 障碍              |
| SSE 通道合并     | ✅ 可行         | `useServerSSE` 为 union + switch，扩展分支即可             |
| 桥接脚本资产化   | ✅ 可行         | 桥接脚本为纯模板字符串，可整体迁出；postMessage 协议已通用 |
| 会话模型归一化   | ✅ 可行，成本低 | 会话类型消费面小；组件层已泛化                             |
| 生命周期/配置    | ✅ 可行         | task 名消费面小                                            |
| Extension 侧     | ✅ 附带收益     | 侧边栏复用同一份 client App，一处改造全端生效              |

无结构性障碍。

## 7. 落地步骤

- **阶段一｜定契约**：shared 定义 `WebProvider`/`ChatSession`/`ProviderEvent`；把现有 REST 调用、进程管理、桥接脚本迁入默认 Provider；服务编排改为面向接口编程，默认注入默认 Provider → 行为不变
- **阶段二｜客户端归一化**：现有会话 SSE 组合逻辑 → 通用 `useSessionEvents`（消费归一化事件）；端点返回 `ChatSession`；客户端过滤逻辑移入 provider；`useServerSSE` 增加 `SESSION_EVENT` 分支
- **阶段三｜配置解耦**：配置增加 `provider?: string`，provider 专属字段收敛到命名空间，常量与 task 命名泛化
- **阶段四｜验证**：用第二个 provider（任意 Web UI）跑通接口，反推补齐契约缺口

## 8. 风险与对策

| 风险                                                 | 对策                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| 事件时序依赖（部分事件先置 pending、状态事件后收尾） | 服务端归一化时保持顺序消费，thinking 状态由 adapter 单点推导   |
| provider 事件 schema 随版本漂移                      | adapter 容忍未知事件类型；provider 内锁版本；已隔离不影响 core |
| 服务端事件流断线（provider 进程重启）                | 订阅自带重连循环，复用 `waitForServer` 模式                    |
| extension dist 为编译产物                            | task 名改名后需重新构建 extension，发布时同步                  |
| 桥接脚本迁移引入回归                                 | 阶段一保持桥接脚本内容不变仅搬迁，行为不改；阶段二再泛化代理   |

## 9. 向后兼容策略

- 默认 `provider: "default"`，默认行为与现状一致
- 公开端点路径、事件、配置项尽量保持双轨兼容
- 旧顶层配置保留读取（标记 deprecated）
- 桥接脚本与 provider 侧插件保留在 provider 包内
