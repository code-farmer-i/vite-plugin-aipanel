# Core（`@aipanel/core`）

Provider 无关的适配层契约与共享能力：核心层只依赖本 context 定义的通用协议，任何具体 Web UI 的细节都封装在 `WebProvider` 实现内。

## Language

**Provider**:
一个具体 Web UI 的适配器实现——本仓有 OpenCode 与 DeepSeek 两个。
_Avoid_: 引擎（引擎是被 Provider 驱动的 CLI / Web 进程本身）、适配器（ADR-0001 的旧措辞）

**WebProvider**:
Provider 必须实现的契约：环境检查、启动/停止、会话 CRUD、会话 URL、事件订阅、桥接脚本与配置下发。

**ChatSession**:
Provider 私有会话归一化后的通用会话模型，客户端只认这一个形状。
_Avoid_: 对话、conversation

**ProviderEvent**:
Provider 私有事件归一化后的事件；客户端只消费这些事件。
_Avoid_: 消息（"消息"指会话里的聊天内容，不是事件）

**会话待交互（`SessionPendingKind`）**:
会话等待用户介入的三种情形：审批（approval）、计划评审（plan-review）、提问（question）。

**诊断引擎**:
opencode 插件与 dsh 插件共用的同一份代码诊断实现（ESLint + 类型检查），输出统一分区文本。
_Avoid_: lint 工具、类型检查器（那只是引擎里的两个检查项）
