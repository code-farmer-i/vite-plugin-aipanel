# 事件中继继续走宿主插件，不迁官方 `$events`

**Status: accepted**（2026-09-18 评估；迁移被上游阻塞）

dsh 0.1.2+ 移除了旧的全局下推事件流后，本 provider 的 running/thinking/pending/标题事件仍由宿主内
`@aipanel/dsh-plugin`（`events-relay.ts`）监听 cordis 总线四路信号，归一化为 core `ProviderEvent`
后 POST 到 `HOST_EVENTS_API_PATH`。官方的跨进程替代通道（API Gateway 的 `$events` 逻辑流）已评估，
结论是**暂不迁移**：其转发清单由 dsh 应用侧写死，缺我们赖以推导 thinking 与标题的事件。

> 归属：@aipanel/provider-deepseek / dsh-plugin · 原则：优雅干净、单一来源

## 1. 决策

- 保持现状：`events-relay.ts` 的 `agent/status`、`session/event`、`approval/request`、
  `user-questions/request` 四路监听与 HTTP 中继不变。
- 不新增 `$events` 订阅（否则中继被拆成两条通道，代码更多而能力更少，见 §3）。
- 重评触发条件见 §4。

## 2. 事实：官方 `$events` 的转发清单

`$events` 走我们已在用的 `/api/remote.mux`，但**转发哪些事件**由应用侧数组 `API_REMOTE_FORWARDED_EVENTS`
（`@deepseek-ai/dsh-api-remotes` 的 `src/remote-events.ts`，编译于 `lib/types/remote-events.js`）
单点控制，README 明确："Forwarding one more event requires one entry in that array"。

与本 provider 现用信号逐条对照：

| 现用信号                               | 出处               | `$events` 是否转发                                             |
| -------------------------------------- | ------------------ | -------------------------------------------------------------- |
| `approval/request`                     | dsh-user-approval  | ✅ 有（`waterfall` 模式：订阅方必须回结果或 `next()`，非旁观） |
| `user-questions/request`               | dsh-user-questions | ✅ 有（同上）                                                  |
| `agent/status`                         | dsh-agent          | ❌ 无                                                          |
| `session/event`（turn/step/assistant） | dsh-session        | ❌ 无 → thinking 推导断供                                      |
| `session/title`（SessionEvent 之一）   | dsh-session-title  | ❌ 无 → 标题实时刷新断供                                       |

清单里唯一相关的是 `api-session/*`（dsh-api-session-controller 定义）：
`api-session/status(sessionId, running)` 只有 running/idle，`api-session/activity(sessionId, updatedAt)`
只有时间戳（不含标题），`api-session/added/removed/error` 只在列表增删时报信。

## 3. 为什么不迁

1. **能力净损失**：迁走后 thinking（会话列表状态点的核心）、标题实时刷新、子代理计数三项全丢，
   换来 running 与 pending。
2. **补缺口的官方通道代价更高**：能拿到 turn/step/标题的是 `session/follow`，但它按单个会话寻址
   （`SessionFollowRequest.address` + `throughSeq` 游标 + 首帧全量日志 baseline）。覆盖列表中 N 个会话
   就是 N 条 `remote.mux` 长连接加生命周期管理，远重于现在插件里的四个 `ctx.on`。
3. **自注册会破坏 dsh web UI**：`registerRemoteEvents` 是 "the sole Remote Event source"，
   我们注册自己的 source 会挤掉应用自身的订阅面。
4. **转发清单不在我们手里**：cordis overlay 只能改插件 config，改不了模块常量。
   上游 `dsh-api-remotes` 补齐 allowlist 是唯一正解。

## 4. 重评触发条件

满足任一即重新评估整体替换（届时可删除 `events-relay.ts` 整个模块与 overlay 中 events 相关配置）：

- `API_REMOTE_FORWARDED_EVENTS` 增加 `session/event` 或 `agent/status` 条目；
- 官方提供跨会话聚合的会话日志流（替代按会话寻址的 `session/follow`）。

## 5. 若重评，验收点

1. thinking / 标题实时刷新 / 子代理计数三项行为不退化（对照本 ADR §2 的对照表逐项验证）；
2. 中继不再需要 provider 侧的每轮启动令牌与 `HOST_EVENTS_API_PATH` 端点；
3. `events-relay.ts` 与 overlay 的 events 配置可整体删除，无兼容镜像残留。
