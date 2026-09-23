# 诊断能力的用户配置：vite 插件 `providerOptions.diagnostics`

**Status: accepted**（2026-09-23 决策并落地；内置 linter 目录与用户自定义检查走同一条执行路径）

需求：用户要能自定义**自动诊断**与 **agent 调用 `run_diagnostics`** 时的行为。具体形状是：
编辑 `.css` 触发 stylelint、编辑 `.js/.ts` 触发 ESLint 与 oxlint、单文件诊断按扩展名选检查、
全量诊断时全部触发；同时**内置一批常见 linter**，又不能因此挡住用户自研工具。

设计要点：`checks` 是有序的检查列表；**内置 linter 是数据目录里的预设**，展开后与用户自定义的
`CommandCheck` **完全同形**（同一条执行 + 适配逻辑），唯一的引擎级内置是 `typecheck`。

> 归属：@aipanel/core（策略与检查契约） · @aipanel/provider-deepseek · @aipanel/provider-opencode · 原则：优雅干净、单一来源

## 1. 用户怎么写

```ts
// vite.config.ts
aipanelAssistant({
  provider: "deepseek", // 或 "default" / "opencode"
  providerOptions: {
    diagnostics: {
      checks: [
        // 内置预设：包名 / bin / 默认 argv / 输出格式 / 匹配扩展名都来自内置目录
        { builtin: "eslint" }, // 默认就吃 .js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts/.vue
        { builtin: "oxlint" },
        { builtin: "stylelint" }, // 默认就吃 .css/.scss/.less
        { builtin: "typecheck" }, // 引擎级内置（tsconfig 归并 + 自带 vue-tsc 兜底）

        // 用户自定义：与内置同形，可任意组合
        {
          name: "自研检查",
          bin: "my-lint", // 项目本地包的 bin（解析不到时明确报出）
          args: ["--json", "{files}"],
          format: "aipanel-json", // 或 adapter: "./tools/my-lint-adapter.mjs"
          extensions: [".ts", ".tsx"],
          projectArgs: ["--json", "src"],
        },
      ],

      // 触发与投递
      auto: true, // 编辑后自动诊断
      exposeTool: true, // 是否把 run_diagnostics 暴露给模型
      severity: "error", // "error" 只报错误；"warning" 错误 + 警告
      maxFindingsPerSection: 3, // 自动诊断每分区条数上限（不动手动工具输出）
      maxMessageChars: 4000, // 自动诊断注入字符上限
    },
  },
});
```

**不列入策略**：`ignore` / 排除规则 —— 那是底层工具的事（ESLint 自身 ignore、tsconfig `exclude`、
命令自己的 glob），不复刻一套 glob 语义，也就不会出现"两处 ignore 谁生效"。

## 2. 契约（`@aipanel/core`）

```ts
export type DiagnosticsPhase = "edit" | "manual";
export type DiagnosticsRun = DiagnosticsPhase | "both";

/** 引擎级内置：唯一需要 tsconfig 感知归并与自带引擎兜底的检查 */
export interface TypecheckCheck {
  builtin: "typecheck";
  run?: DiagnosticsRun;
  extensions?: string[];
}

/** 内置 linter 预设：只写 id，其余取内置目录，可局部覆盖 */
export type LinterPresetCheck = {
  builtin: BuiltinLinterId; // "eslint" | "oxlint" | "stylelint" | …
  args?: string[];
  projectArgs?: string[];
  extensions?: string[];
  format?: DiagnosticsFormat;
  cwd?: string;
  run?: DiagnosticsRun;
  timeoutMs?: number;
};

/** 用户自定义检查：跑一条命令（或项目本地某个包的 bin） */
export interface CommandCheck {
  name: string;
  command?: string; // argv[0]（PATH/路径）
  bin?: string; // 项目本地包名（同时用作 bin 名）
  args?: string[]; // 可含 {file} / {files}
  projectArgs?: string[]; // 全量诊断时的 argv
  extensions?: string[]; // 只吃这些扩展名；缺省不限
  targets?: DiagnosticsTargetKind[]; // 只在这些目标形态下跑（["project"] = 仅全量诊断）；缺省不限
  cwd?: string;
  run?: DiagnosticsRun;
  format?: DiagnosticsFormat;
  adapter?: string; // 用户适配器模块（相对项目根，default export）
  timeoutMs?: number;
}

export type DiagnosticsCheck = TypecheckCheck | LinterPresetCheck | CommandCheck;

export interface DiagnosticsPolicy {
  checks: DiagnosticsCheck[]; // 缺省 = [eslint, oxlint, typecheck]
  auto: boolean;
  exposeTool: boolean;
  severity: "error" | "warning";
  maxFindingsPerSection: number;
  maxMessageChars: number;
}
```

### 内置 linter 目录（数据表，加一个工具 = 加一行）

| 预设        | 项目本地包 | 默认 argv                                                                 | extensions         | 适配器           |
| ----------- | ---------- | ------------------------------------------------------------------------- | ------------------ | ---------------- |
| `eslint`    | eslint     | `--format json {files}` / 全量 `--format json .`                          | 源码扩展名         | `eslint-json`    |
| `oxlint`    | oxlint     | `--format=json --ignore-pattern node_modules {files}`                     | 源码扩展名         | `oxlint-json`    |
| `stylelint` | stylelint  | `--formatter json {files}` / 全量 `--formatter json **/*.{css,scss,less}` | `.css/.scss/.less` | `stylelint-json` |
| `typecheck` | —（引擎）  | tsconfig 归并，项目本地 tsc/vue-tsc 优先                                  | 源码扩展名         | —                |

预设与自定义的差异**只有一处**：预设走项目本地包解析，**项目没装时视为未安装**——编辑后阶段静默跳过
（`debug` 日志），手动诊断给一条"未运行"说明；用户显式写的 `bin`/`command` 解析不到则明确报错
（那是配置问题，不该沉默）。

## 3. 同一条执行路径

```
TypecheckCheck ─────────────────────────────► 引擎：tsconfig 归并 / 引擎探测 / 自带 vue-tsc 兜底
LinterPresetCheck ──expandLinterPreset()──┐
                                          ├──► runCommandCheck()：项目本地 bin 解析 → execa(argv) → 适配器 → 分区
CommandCheck ─────────────────────────────┘
```

- 内置预设展开后就是 `CommandCheck`，所以"内置"没有第二套底层实现。
- 内置 eslint 也走 spawn（`node <项目本地 eslint bin> --format json …`），与 oxlint/stylelint/自定义一致；
  代价是每步边界多一个进程（tsc/oxlint 本来也是 spawn），换来确定性与单一实现。
- 各检查**并发**执行（`Promise.all` 保序）：输出仍按声明顺序，墙钟时间取最慢的那个。
  一次编辑后收尾通常是 eslint + oxlint + stylelint + tsc 四个进程，串行会白等前三个；
  单个检查内部的逐文件执行仍串行，避免一次批量编辑拉起 N 个同名进程。

### 输出适配器（内置由我们维护；用户可选内置名或用模块）

| `format`            | 产出                                     | 说明                                              |
| ------------------- | ---------------------------------------- | ------------------------------------------------- |
| `text`（默认）      | 原样文本；`diagnostics` 为空             | 任意工具可用，但无结构化条目、severity 门槛不生效 |
| `tsc`               | 结构化 + 原始行（按门槛过滤）            | 复用 tsc 输出解析                                 |
| `eslint-json`       | `LintMessage[]` → 条目 + `ERROR/WARN` 行 | `eslint --format json`                            |
| `oxlint-json`       | 同上                                     | `oxlint --format=json`（复用既有解析器）          |
| `stylelint-json`    | 同上                                     | `stylelint --formatter json`                      |
| `aipanel-json`      | 我们公布的协议（见 §4 路线 2）           | 任意语言可产出                                    |
| `adapter: "<模块>"` | 用户模块 default export 的函数           | 见 §4 路线 3                                      |

`severity` 门槛只在有结构化条目时生效；`text` 无法判级（文档写明）。

## 4. 用户自研工具怎么对接（三条路线）

| 路线              | 用户要做什么                                       | 我们的支持                                                               | 适用                        |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------- |
| 1. 复用内置适配器 | 让工具输出主流格式                                 | `format: "tsc"` / `"eslint-json"` / `"oxlint-json"` / `"stylelint-json"` | 输出能对上                  |
| 2. 协议对接       | 工具往 stdout 打我们公布的 JSON（任意语言、零 JS） | `format: "aipanel-json"`                                                 | 自研工具、Go/Rust/Python    |
| 3. 代码适配器     | 写一个 `.mjs`，default export 一个函数（可 async） | `adapter: "./tools/xxx.mjs"`                                             | 输出奇特 / 需要后处理、聚合 |

路线 2 的协议直接复用既有的 [`AIPanelDiagnosticEntry`](../../packages/core/src/common/types.ts)
（1-based 行列，也是 client 诊断卡片用的类型）；也可接受裸数组，1-based → 内部 0-based 的换算由我们做：

```json
{
  "diagnostics": [
    { "file": "src/a.ts", "line": 12, "column": 5, "severity": "error", "message": "禁止 any" }
  ]
}
```

路线 3 的模块路径相对**项目根**解析，由执行方在运行时 `import()`（适配器可 import 项目依赖）；
模块缺失 / 抛错 / 返回形状非法都转成该分区的明确文案。**为什么不能在 `vite.config` 里直接传函数**：
配置要跨进程（vite host → dsh / opencode 宿主进程）经 overlay YAML 或 env 序列化，函数过不去。

## 5. 目标、占位符与扩展名

```ts
export type DiagnosticsTarget =
  | { kind: "file"; file: string; cwd: string } // run_diagnostics({filePath})
  | { kind: "project"; cwd: string } // run_diagnostics() 全量
  | { kind: "edited"; files: string[]; cwd: string }; // 编辑后自动诊断
```

| 规则          | 行为                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `extensions`  | 目标文件先按该 check 的扩展名筛（内置 lint 缺省 = 源码扩展名，命令检查缺省 = 不限）；筛空则跳过该 check（不 spawn） |
| `{file}`      | 每个目标文件一次调用（编辑后多文件时逐文件跑，分区带各自 `target`）                                                 |
| `{files}`     | 一次调用，展开成**多个独立 argv 项**（嵌入写法如 `--files={files}` 退化为空格连接）                                 |
| 无占位符      | 三种目标都跑同一个 argv（项目级命令，如 `pnpm run check`）                                                          |
| `projectArgs` | 全量诊断（无目标文件）时用它；含占位符又没写它 → 全量时跳过该 check                                                 |
| 宿主登记      | diff 后的编辑登记**不再按扩展名预过滤**，由各 check 的 `extensions` 决定跑不跑（否则 `.css` 永远到不了 stylelint）  |

## 6. 与现有诊断全量能力的对接

| 能力面                                       | 设计后                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `run_diagnostics` 单文件 / 全量              | 同一份 `checks`，目标 `{kind:"file"}` / `{kind:"project"}`                                      |
| canonical 输出                               | 形状不变（`{title, sections[], diagnostics[]}`），`sections` 由 checks 驱动                     |
| `presentationMeta.diagnostics` → client 卡片 | 汇总各 check 的结构化条目（内置预设与自定义同路径）                                             |
| 编辑后自动诊断                               | 同一份 `checks` 按 `run` 过滤 + 目标 `{kind:"edited"}`；预算/截断语义不变，保留 `### 文件` 结构 |
| opencode 插件                                | 同一份策略（env 下发 JSON）；工具注册受 `exposeTool`、after-hook 受 `auto`                      |
| 工具描述                                     | 通用措辞（"按项目配置运行的检查"），两 provider 共用                                            |

## 7. 触发与投递

| 阶段                                                    | 跑哪些 check       | 目标                                  |
| ------------------------------------------------------- | ------------------ | ------------------------------------- |
| `edit`（tools/post-execute 登记 → agent/pre-step 收尾） | `run !== "manual"` | `{kind:"edited", files}`              |
| `manual`（agent 调工具）                                | `run !== "edit"`   | `{kind:"file"}` 或 `{kind:"project"}` |

- `auto` 与 `exposeTool` **相互独立**（今天被同一个开关绑死，无法"只自动诊断、不给模型工具"）。
- **没有发现就不投递**：编辑后阶段只把"有发现"的分区算数，判定规则是 `exitCode !== 0`
  或存在结构化条目。命令成功退出（exit 0）且没有条目时，哪怕它打印了 `✓ 0 problems found`
  这类成功信息也不产文本——否则每个 step 都会白注入一段上下文。手动诊断不受此规则影响
  （保留原文，正面回答"有没有问题"）。
- 自动诊断每步投递有界摘要（不做指纹去重），预算由两个 `max*` 控制；手动输出始终完整。
- `severity` 在分区归一化处过滤（文本与条目一起）。

## 8. 执行语义与边界

- **argv 直传、不经 shell**（ADR-0002 是仓库级约定，ESLint 守卫会拦 `shell: true`）；需要管道/`&&`
  时由用户显式选择解释器（`{ command: "bash", args: ["-lc", "…"] }`）。
- 执行器复用 core 的 execa 用法（`reject:false` + `timeout` + `maxBuffer` + `stdin:"ignore"`）。
- 有发现判定：`exitCode !== 0`；失败（命令不存在 / 超时 / 输出超限 / 输出解析失败）给明确文案，不静默假装干净。
- 先把检查按目标类型与 `extensions` 筛一遍再解析命令：不适用于本轮目标的检查直接跳过，
  不会出现「检查压根不跑、却报项目里没装该工具」的误报。
- ESLint 对「被显式传入但不在配置范围内」的文件会回一条 `ruleId=null` 的忽略提示：
  它不是发现，按阶段取舍 —— 编辑后阶段完全不提（否则每步都投递噪音），手动诊断给一行
  「<file> 不在 ESLint 配置范围内，未检查」（全丢会「假装干净」）。
- 适配器解析失败时文案带上命令原始输出摘要；项目外的文件展示用绝对路径；空分区在入口统一丢弃。
- 信任边界：命令与适配器模块来自用户 `vite.config` / 项目目录，与项目自己的 npm scripts 同级。

## 9. 端到端流向

```
vite.config providerOptions.diagnostics
  → resolvePluginConfig（core/options.ts，原样透传）
  → resolveDeepSeekOptions / resolveOpenCodeOptions   ← 这里 resolveDiagnosticsPolicy() 归一化
      ├─ deepseek：buildDshOverlay 写 config.diagnostics（JSON）→ dsh-plugin apply()
      └─ opencode：OPENCODE_ENV.DIAGNOSTICS（JSON）→ edit-diagnostics 插件
  → 消费：exposeTool 闸工具注册 / auto 闸钩子 / runDiagnostics(target, policy, phase)
```

## 10. 迁移（破坏性）

- `providerOptions.enableDiagnostics`、`autoDiagnose`、`enableLsp` **一次删净**，统一写
  `providerOptions.diagnostics`（AGENTS 规则 4：删除即清理，不留兼容镜像）。
- 诊断默认值单一来源 = `@aipanel/core` 的 `DEFAULT_DIAGNOSTICS_POLICY`；provider 只负责把用户的
  `Partial` 归一化成完整策略。
- 非法值（`severity: "warn"`、`maxFindings: 0`、未知 `builtin` id、`checks` 非数组、`bin`/`command`
  都缺失）→ 回退并 `log.warn`，不让配置笔误整体失效。

## 11. 被拒方案

| 方案                                                             | 被拒原因                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 为每个工具内置特判（eslint/stylelint/…各一套）                   | 探测、参数、输出解析、扩展名要写 N 遍；用户自研工具还得再来一遍。改为"数据目录 + 同一命令路径"                 |
| 保留进程内 ESLint Node API 作为内置实现                          | 与 oxlint/stylelint/自定义不同路径，违背"底层逻辑一致"；spawn 代价按步边界收敛（本项目 tsc/oxlint 本就 spawn） |
| 继续加扁平开关（`enableLsp`/`enableDiagnostics`/`autoDiagnose`） | 语义漂移（`enableLsp` 实际只闸 after-hook、不管工具注册），且无法表达"按扩展名选检查/换后端"                   |
| `ignore` / 排除规则进策略                                        | 那是底层工具的事；两套 glob 语义只会互相打架                                                                   |
| core 读 dsh settings 或 vite config                              | core 必须 provider 无关                                                                                        |
| 用环境变量做用户配置                                             | 不可发现、不可持久；env 只承载 provider 归一化后的策略 JSON                                                    |
| dsh 原生设置表单（`Config` + `.volatile()`）                     | 与"entry 由 `--patch` overlay 注入"冲突：设置只写 profile 层，写盘前有覆盖保护，overlay 会拒写；见下           |

### 为什么不用 dsh 原生设置（已评估，本轮不做）

层序为 `bundle ＜ profile ＜ home ＜ CLI --patch`（`@deepseek-ai/dsh-app-boot/lib/index.js:814-825`），
设置表单只写 profile 层，且写盘前比对不通过即抛
`Configuration for "<id>" is overridden by a home patch or command-line overlay`
（`@deepseek-ai/dsh-config-editor/lib/index.js:116`）。用 `composeEntries` 实测：entry 由 overlay insert 时
用户行被 `patch: entry "aipanel" not found` 跳过；改由持久层 insert 后用户行整体替换 `config`（接线丢失）；
两层都 insert 则重复 id ⇒ 表单消失。将来要"用户级 + 热更新"的路径是插件改 `dsh.bundle` + 接线走会话
环境 + 只对 `diagnostics` 标 `.volatile()`——与本设计的策略形状兼容。

## 12. 后续

1. 目录扩充（biome / prettier --check 等）只需加一行 + 可能的适配器。
2. 检查级并发已落地；若单检查内部也要并发（例如 20 个文件的 `{file}` 展开），需要加一个并发上限。
3. 包管理器差异（pnpm/yarn/bun 的 `exec`）目前由 `bin` 解析规避（直接 `node <bin>`）。

## 13. 验收点

1. `resolveDiagnosticsPolicy`：分层覆盖、缺省 checks、非法值回退、`extensions` 归一化。
2. `runDiagnostics`：预设展开与未安装跳过、`extensions` 过滤、`{file}`/`{files}`、`projectArgs`、
   六种 `format` + 模块适配器、`severity` 同时作用于文本与条目、失败文案、并发执行且输出保序。
3. 全量对接：单文件与全量 `run_diagnostics`、canonical 与 `presentationMeta.diagnostics`、
   编辑后收尾（含 `maxFindingsPerSection` / `maxMessageChars`）。
4. opencode 插件：`exposeTool` / `auto` / 预算生效，metadata 条目正确。
5. 端到端：`checks` 配 `{builtin:"stylelint"}` + 自研 `bin` 工具，编辑 `.css` 只跑 stylelint、
   编辑 `.ts` 跑 eslint/oxlint/typecheck、全量诊断全部触发。
6. `pnpm typecheck` / `pnpm test` / `pnpm lint` 全绿；`docs/config.md` 两处速查表同步。
7. 真实进程 e2e（无 mock）：`pnpm e2e:diagnostics`（`scripts/e2e-diagnostics.mjs`，13 个场景：
   真实 ESLint 预设 / extensions 分流 / 三种用户适配器 / 占位符展开 / projectArgs / 并发计时 /
   失败语义 / severity 门槛 / 渲染折叠 / 未安装预设语义 / 真实 tsc）。
