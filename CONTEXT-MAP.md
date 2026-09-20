# Context Map

本仓是 pnpm monorepo：按"宿主编排 / 适配层契约 / Provider 实现 / 浏览器侧"分层，每层是一个 context。契约类决策进 `docs/adr/`。

## Contexts

- [Core（`@aipanel/core`）](./packages/core/CONTEXT.md)：Provider 无关的适配层契约与共享能力——会话/事件模型、MCP 工具、代码诊断、CLI 探测与进程日志。
- [Provider: OpenCode（`@aipanel/provider-opencode`）](./packages/providers/opencode/CONTEXT.md)：默认 Provider 的实现——OpenCode Web 进程、REST API 适配与桥接脚本。
- [Provider: DeepSeek（`@aipanel/provider-deepseek`）](./packages/providers/deepseek/CONTEXT.md)：DeepSeek Harness (dsh) 的实现——dsh web 进程、启动令牌认证、cordis overlay 与 dsh 侧插件。
- Host（`packages/vite`）：Vite 插件宿主——服务编排、代理、MCP 端点、按配置动态加载 Provider。
- 浏览器挂件与组合层（`packages/ui`、`packages/client`）：侧边栏挂件与跨端组合逻辑。
- 浏览器扩展宿主（`packages/extension`）：在任意 localhost 页面唤起侧边栏。
- 文档站（`packages/docs`）：在线文档。

## Relationships

- **Host → Core**：宿主只依赖 Core 的通用协议（`WebProvider`、`ProviderEvent`、`ChatSession`）做编排与端点。
- **Core ← Providers**：Provider 实现 `WebProvider` 并复用 Core 的通用能力（CLI 探测、进程日志、诊断引擎）；Core 不反向依赖任何 Provider。
- **Host → Providers**：宿主按 `provider` 配置动态加载具体 Provider 包。
- **Host ← 浏览器侧**：浏览器侧只消费归一化后的 `ChatSession` 与 `ProviderEvent`，不感知 Provider 私有协议。
