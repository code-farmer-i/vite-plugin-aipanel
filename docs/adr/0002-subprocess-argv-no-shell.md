# 子进程一律以 argv 直传，不再启用 shell

**Status: accepted**（2026-09-20 审查确立；同日二次审查补入被拒方案、实测语义差异与机械守卫；未决子项见 §6）

所有子进程调用一律不带 shell：execa 的 `shell: true` 会把 `file + args` 用空格拼成**单条命令字符串且不转义**，node `child_process` 同理；任何含外部输入（工作区路径、文件路径、工具入参）的参数都会被 shell 二次解析而拆散或执行，常量参数也白白多一层解释器。Windows 的 npm `.cmd` 垫片解析不需要 shell——execa 内部经 cross-spawn 按 PATHEXT 解析出 `.cmd` 后转 `cmd.exe /d /s /c` 并**逐个转义参数**；原生 `spawn` 做不到这点，因此它也不该出现在启动 CLI 的路径上。

> 归属：@aipanel/core · @aipanel/provider-opencode · @aipanel/provider-deepseek · 原则：优雅干净、单一来源

## 1. 决策

1. 启动 CLI 一律用 execa（默认无 shell）：命令名走 PATH 解析（Windows 垫片由 cross-spawn 处理），参数以 argv 直传。
2. 禁止调用方的 `shell` 选项与 `exec(命令字符串)`，不接受"参数是常量，所以开 shell 无害"。被禁的是**调用方把整条命令交给 shell**；execa / cross-spawn 在 Windows 对 `.cmd` 垫片内部调用 `cmd.exe` 属于**垫片解析**，不在禁止范围。
3. 需要 `timeout` / `maxBuffer` 语义也不要退回 `exec`：execa 的 `timeout` / `maxBuffer` 与结果上的 `timedOut` / `isTerminated` / `isMaxBuffer` 覆盖同样场景（逐场景对照见 §2，两处非等价差异见 §5）。
4. 走 spawn options（`cwd`）或 env 传递的值不属于参数拼接面，不受本约定约束。
5. 仍允许原生 `spawn` 的位置只有一类，判据是**两条可核对的性质**，而不是"命令是否固定"（后者读者无法套用到新场景）：
   - 目标不是 Windows npm 垫片（不需要 PATH + PATHEXT 解析），如 `taskkill` / `ps` / `kill` / `wmic`；
   - 每个参数都不可由外部输入派生（pid 等内部整数/枚举）。
6. 约定由 ESLint 守卫落地（见 §7 验收点 1）：`packages/**` 出现 `shell` 属性、或从 `node:child_process` 导入 `exec` / `execSync` 即报错；`scripts/**`（维护者本地脚本，非产品路径）在规则作用域之外，豁免靠作用域而非人工记忆。

## 2. 事实依据（实测）

- **execa 9 的 shell 语义**：`lib/arguments/shell.js:10` 在 `shell: true` 时执行 `[[file, ...commandArguments].join(' '), [], options]`，不做转义；`lib/arguments/escape.js` 的转义只用于日志展示（`escapedCommand`），不参与实际执行。
- **传参实测（本仓库 execa 9.6.1 / macOS）**：探针参数 `a b/c` 时 `shell: true` 的 stdout 为空（空格被拆成两个参数、`|` 被当作管道执行），`shell: false` 得到 `2|a b/c`（argv 原样到达）。
- **错误与中断语义对照（node `exec` vs execa 9.6.1，2026-09-20 亲测）**：

  | 场景            | node `exec`（旧）                                                           | execa 9（新）                                                                        |
  | --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
  | 命令不存在      | `error.code = "ENOENT"`                                                     | `reject: false` 时不 reject：`failed: true`、`exitCode: undefined`、`code: "ENOENT"` |
  | 超时            | `error.killed = true`、`error.code = null`                                  | `timedOut: true`、`isTerminated: true`、`exitCode: undefined`、`signal: "SIGTERM"`   |
  | maxBuffer 溢出  | `error.killed` 为 `undefined`、`code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"` | `isMaxBuffer: true`、保留子进程真实 `exitCode`（实测 0）                             |
  | 版本打在 stderr | 需自行收 stderr                                                             | `stderr` 可直接读，`getCliVersion` 的 stderr 回退成立                                |

- **字段来源**：`isTerminated = signal !== undefined`（`lib/return/result.js:162`，即**任何信号致死**都命中）、`timedOut = terminationReason === 'timeout'`（`lib/methods/main-async.js:172`）、`isMaxBuffer`（同文件 :175）。超时用 `SIGTERM`，`forceKillAfterDelay` 到期再 `SIGKILL`。
- **无 shell 仍能解析全局 CLI**：`execa("dsh", ["--version"], { shell: false })` → exit 0、stdout `0.1.6-alpha.2`（同日复核）。
- **Windows 不退化**：execa `lib/arguments/options.js:23` 走 `crossSpawn._parse`；cross-spawn 7.0.6 `lib/parse.js:27-63` 的 `parseNonShell` 对非 `.exe` 目标包装 `cmd.exe /d /s /c`、逐个转义参数并置 `windowsVerbatimArguments`，PATHEXT 经 `which` 解析（`lib/util/resolveCommand.js:27-30`）。这正是当初加 shell 想解决的跨环境问题，execa 自带且更正确。
- **依赖与产物**：esbuild 实测（只写 /tmp）——保留 `--external:execa` 为 45,439 B，去掉则 298,670 B；仓库内已构建的 `dsh-plugin/dist/index.js` 为 45,457 B 且只留一处 `from "execa"`，无内联 cross-spawn。
- **能力无净损失**：非交互 shell 本就不展开 alias/函数；`cleanup` 杀进程树时无 shell 的 CLI 是直接子进程而非孙进程，生命周期更干净。

> 历史背景：`be21268`「统一在 spawn 子进程时开启 shell 选项，适配不同环境下的命令执行」把 shell 作为跨环境兜底一次性铺开，之后被 provider 与 core 沿用；该兜底对 execa 是多余的，且引入了参数不转义的副作用。

## 3. 被拒方案

| 方案                                              | 被拒原因                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 保留 `node:child_process` + argv 数组（零新依赖） | 能消除注入与拆参，但无法解析 Windows `.cmd` 垫片：Node 对 `.bat` / `.cmd` 直接 spawn 会失败，而 core 需要按 PATH 探测用户安装的 `dsh` / `opencode`。 |
| 只对 Windows 开 shell                             | 把未转义的参数交给 `cmd.exe`，等于把注入面留在最需要防的平台。                                                                                       |
| "参数是常量就可以开 shell"                        | 常量参数同样会被 shell 二次解析（空格、管道、重定向、`~`），且"常量"这一判据会随参数演化而失效——历史上正是以 `be21268` 的兜底一次性铺开的。          |
| `exec` + 手工转义                                 | 转义只应交给依赖（cross-spawn）；自研转义没有单一来源，也覆盖不了 `cmd.exe` 的怪癖。                                                                 |

## 4. 审查清单（2026-09-20）

| 调用点                                                             | 参数含外部输入                                                  | 结论                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| provider-deepseek `deepseek-web.ts` `execa("dsh", …)`              | 是（`--patch` = 工作区缓存内 overlay 路径）                     | 去掉 `shell: true`                                                             |
| provider-deepseek `dsh-install.ts` `execa("dsh", … "add", target)` | 是（dev 模式 `target` = 本仓库本地目录路径）                    | 去掉 `shell: true`                                                             |
| provider-opencode `opencode-web.ts` `execa("opencode", …)`         | 是（`--hostname` 取配置、`--cors` 取 corsOrigins）              | 去掉 `shell: true`（初版表把此格写成"否"，二次审查更正）                       |
| vite `mcp-proxy.ts` `spawn(process.execPath, [binPath, …])`        | 是（`binPath` 为依赖解析路径）                                  | 已合规（argv 直传）                                                            |
| core `node-utils.ts` `checkCliInstalled` / `getCliVersion`         | 否（`bin` 为 `"opencode"` / `"dsh"` 常量）                      | 改 `execa(bin, ["--version"])`：无 shell，Windows 垫片交给 cross-spawn         |
| core `node-utils.ts` taskkill / ps / kill / wmic                   | 否（PID 等内部整数；wmic 插值的 `winName` 亦为内部常量）        | 已合规（argv 直传，命中 §1.5 两条性质）                                        |
| core `diagnostics.ts` oxlint / tsc 两处                            | 是（`pattern` = 诊断工具入参的路径/glob；`bin` = 依赖解析路径） | 改 `execa("node", [bin, …])`：argv 直传，`timeout` / `maxBuffer` 由 execa 承担 |
| `scripts/release.js`、`scripts/deploy-docs.js` 的 `execSync`       | 否（维护者本地脚本，非产品路径）                                | 保持现状（规则作用域外）                                                       |

## 5. 遗留与后果

- **依赖归属与产物**：`@aipanel/core` 因此新增运行时依赖 `execa`（此前只有 `vue-tsc`）。provider 包 `bundle: false`，运行时按各自 node_modules 解析；`dsh-plugin` 是 esbuild 单文件包，故在 `scripts/build-dsh-assets.mjs` 与包内 build 脚本中把 execa 列为 external，并按 `vue-tsc` 的既成规矩写进该包 `dependencies`（由 `dsh plugin add` 装入 profile node_modules）。不这样做会把 execa 及其依赖内联，产物由 45KB 涨到 298KB（§2 实测）。`pnpm-lock.yaml` 仅新增 core 与 dsh-plugin 两个 importer 条目，`execa@9.6.1` 快照已存在。
- **破坏性后果：core 的 CJS 产物在 Node < 20.19 不可加载（未决，见 §6）**。`packages/core/lib/node/node-utils.cjs:43`、`diagnostics.cjs:45` 顶层 `require("execa")`，而 execa 9 是 ESM-only。实测：Node 16.20.2 `require("@aipanel/core/node")` → `ERR_REQUIRE_ESM`；Node 20.20.2 正常（`require(esm)` 自 20.19 / 22.12 起默认可用）。发布产物 `vite-plugin-aipanel` 的 `lib/index.cjs` 顶层 `require("@aipanel/core/node")`，因此 CJS 宿主（CJS 配置的 Vite 项目、按 `require` 条件解析的消费者）在 Node 18 会中招。本仓没有任何 `engines` 字段或 CI 版本固定。
- **两处非等价 delta（有意保留，文案待修，见 §6）**：`isTerminated` 是"任何信号致死"，不等于"超时"——被外部 SIGSEGV / OOM kill 也会让诊断报"检查超时"；maxBuffer 溢出在 `runOxlintFiles` 被并入失败路径并报"检查超时"（旧代码对 maxBuffer 的 `killed` 为 `undefined`，会解析**截断后**的输出返回部分诊断），而 `runTypeCheck` 因 execa 保留了真实 `exitCode`（0）仍与旧行为一致。另外 execa 的 `maxBuffer` 是**每流各 50MB**，Node `exec` 是合并 50MB，实际放宽约一倍。
- **版本单一来源**：`execa` 现由 5 个 `package.json`（core / provider-opencode / provider-deepseek / dsh-plugin / vite 插件）各自声明 `^9.6.1`。按 AGENTS.md 规则 2 应收敛为 `pnpm-workspace.yaml` 的 `catalog:` 引用；属独立变更，未在本轮一并做。
- **验收点 4 尚无自动化测试**：`core/tests/node-utils.test.ts` 明确排除 `checkCliInstalled` / `getCliVersion`（真实 I/O 耦合），该条验收目前靠人工实测。

## 6. 未决问题（需 owner 决策，不影响 §1）

1. **Node 支持策略 vs 恢复惰性加载**（对应 §5 破坏性后果）：
   - (a) 保持现状，改为显式声明 `engines: { node: ">=20.19" }`，把 CJS 破坏作为一次明确的破坏性变更发布——代价是 Vite 5/6 的 Node 18 用户被挡在门外。
   - (b) 恢复 core 原有的"零静态运行时依赖"性质：把 execa 改成调用点 `await import("execa")`（4 个调用点全是 async），顶层不再 require ESM——Node 18 的 CJS 消费者继续可用，也不需要 engines 提升。需实测 esbuild 在 cjs 输出下保留动态 `import()`。
2. **诊断失败文案**：区分"超时 / 信号致死 / 输出超限"三者，别把 `isTerminated` 直接说成"超时"。

## 7. 验收点

1. `pnpm lint` 通过且守卫有效：`packages/**` 内出现 `shell` 属性或 `exec` / `execSync` 导入即报错（已用探针文件验证报错，探针已删）。注意不要再用 `grep "shell: true"` 当判据——gitignored 的陈旧 coverage HTML 里有历史命中。
2. 工作区路径含空格时 dsh / opencode 可正常启动（`packages/providers/deepseek/tests/deepseek-web.test.ts` 的 `--patch` 用例与各 provider 的参数断言守护）。
3. 诊断引擎在含空格路径下可用：`runTypeCheck` 以 argv 直传 `node <bin>`；`core/tests/diagnostics.test.ts` 断言传参数组为 `[bin, "--build", "--noEmit", "--pretty", "false"]`。
4. CLI 探测无 shell 可用：`checkCliInstalled("dsh")` / `getCliVersion("dsh")` 实测 `true` / `0.1.6-alpha.2`，不存在的命令返回 `false` / `null` 而不抛错（`reject: false` 覆盖 spawn 失败）；该项目前无自动化测试（§5）。
