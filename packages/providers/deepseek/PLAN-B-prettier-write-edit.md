# PLAN B：禁用官方 write/edit，实现“先格式化再写入”的扩展工具

> 状态：设计文档 · 3.3 已查证（沙箱可公开复刻）· 实现未开始· 归属：@aipanel/provider-deepseek / dsh-plugin · 原则：优雅干净、单一来源

## 1. 目标与验收

- 模型调用 write 时，落盘内容与**快照/diff/模型可见文本**一致，且均为 prettier 格式化后的结果；
- 官方 write/edit 不再以“黑盒”方式直接执行（避免快照存格式化前正文）；
- 保留官方语义与能力：路径解析、原子写、fs/observed、与官方同构的 canonical/render/diff；
- 失败可回退：若格式化/沙箱接入不可用，退回方案 A（post-execute 后格式化）。

验收点：
1. 对 .ts/.tsx/.vue/.css 等执行 write 后，tool/result.meta 的 diff 与持久化内容是格式化后的；
2. 模型文本视图不含“格式化前”正文（官方文本本就不回显正文，需确认 diff 卡片不出现旧内容）；
3. 会话回放查看 write 结果时，无未格式化正文。

## 2. 官方机制结论（事实）

| 项 | 结论 | 依据 |
| --- | --- | --- |
| 注册表 | register() 注册到 global 或调用方 **agent 作用域**；同一层内重名失败，但 **scoped 注册 shadow 全局同名**；restrict({deny}) 按作用域隐藏全局工具 | dsh-tools 的 ToolRuntime.register/restrict |
| 包裹钩子 | pre-execute 只 allow/deny/ask，不能改参数；execute around 只能改 signal；post-execute 可改 content，但改不到 canonical/meta | dsh-tools Events + PostToolDecision |
| write 文本 | 官方 formatWriteOutput 只输出 Created/Updated file，不回显正文 | dsh-tool-fs formatWriteOutput |
| write canonical | { path, operation, before, after }，after = 实际写入内容 | dsh-tool-fs write execute |
| 复用官方能力 | 不能按名 tools.execute 调官方（命中自己的 shadow→递归）；正确姿势是复用底层 ctx.fs 服务 + fs/observed | 官方 write 实现内核 |
| apply_patch | dsh 运行时无此工具（全库无注册），无需覆盖 | 本仓库核对 |

## 3. 关键约束与决策点

### 3.1 挂载到 agent 作用域（必须）
插件 apply 在 root ctx，注册到 root 会与官方全局同名冲突；必须在每个 agent 的 agent.ctx 上注册：

```ts
ctx.on('agent/created', ({ agent }) => {
  const tools = agent.ctx.tools;                    // 该 agent 作用域的 ToolRuntime
  const offRestrict = tools.restrict({ deny: ['write', 'edit'] });   // 隐藏官方同名
  const unregWrite = tools.register(createWriteTool(agent.ctx));     // shadow 全局 write
  const unregEdit  = tools.register(createEditTool(agent.ctx));      // shadow 全局 edit
  agent.ctx.effect(() => { offRestrict(); unregWrite(); unregEdit(); },
    'aipanel: formatted write/edit');
});
```

> restrict 只过滤继承的全局层，不会滤掉本作用域自注册的工具；shadow 使 lookup/dispatch 命中我们的定义。

### 3.2 复用官方能力 = 复用 ctx.fs，不是黑盒调用
官方 write 的执行内核（据此复刻）：

```ts
// parseArgs → fs.resolve(filePath) → fs/write-intent waterfall
//   → fs.writeText(target, content, intent, signal, sandboxPolicy)
//   → emit('fs/observed', target, { kind: 'present', version })
//   → return { path, operation, before, after }
```

wrapper 保留同一形状，唯一差异：content 先 prettier 再 fs.writeText，因此 after/diff 即格式化后。

### 3.3 安全/权限/沙箱 —— ✅ 结论：仅靠公开服务即可 1:1 复刻（已查证 dsh 0.1.2-rc.1）

官方 write/edit 的权限链**没有私有实现**，全部落在公开服务上（源码逐行核对 dsh-tool-fs/lib/index.js）：

| 官方调用 | 公开等价物 | 包 |
| --- | --- | --- |
| `new FsSandboxController(ctx)` 内部构造 | 不用复刻：仅做“能力探测 + 组装” | — |
| 能力探测 `ctx.fs.sandboxMode` | **同一公开只读属性**（无后端时为 undefined → 整个沙箱/escalation 分支不存在，与官方一致） | @deepseek-ai/dsh-fs |
| standing policy `this.policy.resolve({session})` | **`ctx.sandboxPolicy.resolve({ session })`** → `SandboxExecutionPolicy`（mode + workspaceRoot） | @deepseek-ai/dsh-sandbox-policy（公开 Service，Context 增强于其 index.d.ts:28-31） |
| 审批 `ctx.get("approval")` | **`ctx.approval`**（`ApprovalService.request` 与 `EscalationApprover` 结构同构） | @deepseek-ai/dsh-user-approval |
| 词表/审批序列（WIDER_MODES、validateEscalationArgs、approveEscalation、sandboxDenialMarker、escalationHintMarker） | **公开导出**，官方与 bash 共用，直接 import | @deepseek-ai/dsh-sandbox（index.d.ts:10-12） |
| cwd → workspace root | `exec.agent.session.header.cwd`（ToolExecution 公开） | dsh-tools/dsh-session |
| 解析/写入/编辑 | `ctx.fs.resolve/writeText/editText`（writeText 第 5 参 sandboxPolicy，裸后端忽略） | @deepseek-ai/dsh-fs |
| 守卫与观察 | 同一事件名 `fs/write-intent`、`fs/edit-intent`、`fs/observed` 走 `ctx.waterfall/emit` —— 已挂载的 dsh-fs-observation-policy 等守卫**自动生效**，无重复实现 | dsh-fs Events |

**最小依赖清单**（dsh-plugin）：运行时仅新增 `@deepseek-ai/dsh-sandbox`（escalation 词表函数）；类型层加 `dsh-fs`、`dsh-sandbox-policy`、`dsh-user-approval`（service 仅存在于宿主 ctx，类型经 Context 增强注入），均可 peer/dev 声明。

**唯一“私有”部分与对策**：`FsSandboxController` 类、`parseWriteArgs/parseEditArgs`、`formatWriteOutput/formatEditOutput` 不出现在包 exports（exports 仅 "."，files 只含 lib/index.js + types）。对策：
- 控制流（~60 行/tool）在 wrapper 中按官方形状复刻，并在注释标注“mirror of dsh-tool-fs write/edit”，用同款公开服务，随官方升级走同步测试（§7）；
- render 信封文本逐字复刻为模块常量，与官方文案 drift 由测试固定（§7）；
- 沙箱/escalation schema 字段只在校验通过 `ctx.fs.sandboxMode !== undefined` 时附加，缺 `ctx.sandboxPolicy` 时与官方同语义 fail-closed（官方构造器同样 throw）。

**结论**：3.3 不再阻塞 —— shadow write/edit 走同一审批/策略/观察事件，门禁不会被绕过；方案 A 仅作 prettierWrite=false 的等价回退。

## 4. 目标架构

```
agent/created ──▶ agent.ctx 作用域
   ├─ restrict(deny write/edit)          # 官方工具对模型不可见
   ├─ register shadow write              # prettier → ctx.fs.writeText → canonical(after=格式化后)
   ├─ register shadow edit               # 局部替换语义（默认不 prettier，见 4.2）
   └─ disposers 随 agent/disposed 清理

格式化服务：core 统一格式化入口（与 opencode enablePrettier 对齐）
   ├─ 复用 @aipanel/core 已提供的 formatter（若存在）
   └─ 否则 dsh-plugin 内置 prettier（经 core/node 提供，避免插件再拉运行时依赖）
```

### 4.1 shadow write 行为定义
- 参数 schema 与官方一致：file_path（必填）、content（必填，空串合法）、保留 escalation 字段；
- 执行：formatted = format(file_path, content) → fs.resolve → fs.writeText(formatted)；
- canonical：{ path, operation, before, after }（after = formatted）；
- render：复用官方 Created/Updated file 信封文本；
- presentation：presentCall/presentResult 的 diff newText 使用 formatted（非模型原始 content）；
- meta：presentationMeta 记录 formatted 前后 diff，保证持久化历史一致。

### 4.2 shadow edit 行为定义
- edit 是“唯一匹配局部替换”，整体 prettier 会破坏 old_text 定位；
- 建议：edit 保持官方局部替换语义、不 prettier；需要重排格式时让模型先 read 再 write；
- 若产品要求 edit 后也整体格式化：替换后读取全文件 prettier 并整写，但需提示模型“行号可能变化”，并把 canonical 的 before/after 更新为全文件 diff（实现面较大，默认不做）。

## 5. 实施清单与文件落点

| 文件 | 内容 |
| --- | --- |
| dsh-plugin/src/formatted-write.ts（新增） | write/edit shadow：schema、prettier、ctx.fs 写入、canonical/render/presentation |
| dsh-plugin/src/format-service.ts（新增） | prettier 封装：按扩展名选 parser、错误处理、幂等 |
| dsh-plugin/src/index.ts | 挂 agent/created、agent/disposed；作用域 restrict + register + disposer |
| overlay/profile（provider） | 开关 prettierWrite（默认 false，对齐 enablePrettier 显式开启语义）与 parser 透传 |

## 6. 验证清单

- [ ] 重启 dsh 后 tools/list 中 write/edit 仍在（shadow 可见），且官方实现不再执行；
- [ ] 对含未格式化代码的文件执行 write → 落盘已格式化；
- [ ] 会话回放/详情里的 diff 是格式化后（before 旧、after 格式化）；
- [ ] 只读会话/权限预设下 write 仍被正确拒绝（沙箱策略未被绕过）；
- [ ] PTC（run_code）里 write 子调度同样命中格式化后的定义；
- [ ] prettierWrite:false 时行为与官方一致（回退路径）。

## 7. 风险与备选

- 沙箱/审批一致性已由 3.3 查证消解（全部公开服务）；剩余 drift 面是控制流与 render 文案的镜像同步；
- 官方 schema/render 升级需同步 shadow 定义（建议用测试断言固定形状）；
- 格式化会改变行号：write 后应提示模型“已按 prettier 格式化，行号可能变化”；
- edit 的格式化语义需产品确认（本方案默认不格式化局部替换）。

## 8. 关联文件

- 官方证据：dsh-tools（ToolRuntime.register/restrict、Events）、dsh-tool-fs（write/edit 实现与 canonical）；
- 现有接入点：dsh-plugin/src/index.ts 的 agent/pre-step、tools/post-execute、applyProviderSettings。
