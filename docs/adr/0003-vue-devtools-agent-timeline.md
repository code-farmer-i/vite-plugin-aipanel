# agent 调试时间线由 aipanel 自己采集，不复用 Vue DevTools 的 Timeline

**Status: accepted**（2026-09-21 实测确立；确定过程见 §2 的实测依据，未决项见 §5）

给 agent 的调试时间线由页面侧自己实现：桥脚本直接订阅 `__VUE_DEVTOOLS_GLOBAL_HOOK__` 的原始 Vue 事件，在页面内存里维护一个容量 1000 条的环形缓冲，常驻采集（没有 start/stop），并用 `vue-devtools_get_timeline` / `mark_timeline` / `clear_timeline` 三个 MCP 工具查询与标注；**不**去读 `@vue/devtools-kit` 的 timeline —— 它那份数据既不落盘也读不到。

> 归属：@aipanel/core · vite-plugin-aipanel（Host + 页面侧桥）· 原则：优雅干净、单一来源

## 1. 决策

1. **采集源用原始 devtools hook**（`__VUE_DEVTOOLS_GLOBAL_HOOK__` 的 `perf:start/end`、`component:added/updated/removed/emit`、`app:init`），不用 `devtools.hook.on.*`（类型友好但受 `highPerfModeEnabled` 门控），也不用 `ctx.hooks` 的 `timelineEventAdded`（受 `recordingState` 门控、且跨 devtools-kit 实例时可能收不到）。
2. **存储自己实现**：页面内存单环，容量 1000 条，drop-oldest 并记 `dropped`；不做 host 侧镜像（§5 P3）。
3. **常驻采集，无 armed 状态**：`clear_timeline` 就是"从现在开始录"（等价于经典 start），`mark_timeline` 只插边界不清历史。理由见 §3。
4. **捕获期就降级为 primitive**：perf 的 start 只进 pending 表、end 才产记录（一次跳转 220 条原始 start/end → 110 条配对记录）；生命周期事件只累计计数不产记录（66 条 updated → 25 个组件计数）；绝不持有 `app`/`vm`/`instance` 引用。
5. **一切跑在宿主链路上的回调都必须装箱**：devtools hook 的 `emit` 是同步遍历、vue-router 的 `afterEach` 在导航链上、桥初始化失败会让整族 `vue-devtools_*` 工具报错——三处任一抛错都会伤到宿主，因此每个采集回调与路由回调都包 try/catch（本轮实测踩到过 hook 回调抛错打断渲染）。
6. **不采 mouse / keyboard 层**：挂载时机决定事后开启无效（devtools-kit 在 plugin setup 时就决定是否 `addEventListener`），且会记录用户真实输入、对 agent 调试信号低。
7. **动的是我们自己的东西**：只订阅，不改 `devtoolsState`、不写 `VUE_DEVTOOLS_KIT_TIMELINE_LAYERS_STATE__`，不干扰用户真实打开的 DevTools UI。
8. **不误导 agent，比多给数据重要**（缺失必须显式、宁可缺字段也不给假值）：
   - 明细永远不是全量，所以 `omitted`（低于阈值 / 超 limit / 超体积）必须显式，且摘要计数不受阈值影响（`summary.perf.operations` 是全量）；**判定"明细是否完整"只看 `detailComplete`**，`truncated` 只表示 limit/体积裁剪（否则默认 slow 档会永远为 true，信号失效）；
   - 窗口被缓冲淘汰过才置 `windowTruncated`（用 `droppedAtMsAgo` 与窗口起点比较，避免把"页面加载前"误报成缺失）；
   - `unpaired` / `prunedStarts` > 0 时明确写"耗时缺失，不是 0ms"；
   - 解析不出可靠 nodeId 时**返回 undefined 而不是 `?:uid`**：不给 agent 一个查不到的 id；
   - `sanitizeValue` 必须化掉非 JSON 安全的 primitive（bigint/symbol/function），否则 `JSON.stringify` 抛错——故障注入测试实测抓到。
9. **健壮性由故障注入测试保证**：固定种子伪随机灌入畸形事件（类型错、会抛的 Proxy、循环引用、BigInt、非字符串组件名）与畸形宿主对象（appRecords/router/组件树），断言不抛错、结果可序列化且字段自洽、宿主状态只读、缓冲有界。`safely` 装箱覆盖 hook 回调、路由回调、订阅失败与采集器构造（构造抛错会让桥初始化中断，整族工具报错）。

## 2. 事实依据（实测）

环境：`localhost:5173` 的 docs 站点（Vue 3 + Element Plus），`@vue/devtools-kit@8.2.1`，2026-09-21。

- **官方 timeline 没有存储**：`addTimelineEvent()` 只 `callHook(TIMELINE_EVENT_ADDED)`（dist/index.js:1305），事件经 `SEND_TIMELINE_EVENT_TO_CLIENT` 发给已连接的 DevTools 客户端（:817-830）。aipanel 页面 `clientConnected: false` ⇒ 事件即发即弃；有一份数据的话也在 DevTools UI 进程里，`evaluate_script` 只能跑在页面上下文，读不到。
- **门控在 emitter 侧**：内置层（mouse/keyboard/component-event/performance）在 `addTimelineEvent` 前检查 `recordingState + *Enabled`（:2014/:2044/:2071/:2100/:2104）；`highPerfModeEnabled` 初值为 `true`（:866）并让 `addTimelineEvent` 直接 no-op（:1306）。实测：新加载页面 `highPerfModeEnabled: true`、`recordingState: false`。
- **原始 hook 不受上述门控**：一次 SPA 路由跳转实测 `highPerf=true`、recording off 时仍收到 `perf:start` 110 / `perf:end` 110 / `component:added` 14 / `component:updated` 66；同一场景下 `ctx.hooks` 的 `timelineEventAdded` 收到 0 条（打开 recording 后才收到，含 `router:navigations:0` 2 条）。
- **事件自带 agent 需要的关联信息**：perf 事件带 `(app, uid, vm, type, time)`，`nodeId = ${appId}:${uid}` 与组件树 id 同构（根节点为 `${appId}:root`，见 devtools-kit `getComponentId` dist/index.js:66-75）；组件树节点还带 `file`，可把慢组件直接落到源码路径。
- **噪音画像**（一次跳转）：110 条 perf 配对中 `render` 41 / `patch` 41 / `init` 14 / `mount` 14；时长 p50 0.1ms、最大 11.1ms，<1ms 占 85%、≥4ms 只有 6 条；来源上 Element Plus 内部件占 53%、匿名/`BaseTransition` 等无源码位置的框架件另有若干。⇒ 默认 `minDurationMs: 4` + summary 优先，明细只留有效信息。
- **降级实测（页面内跑构建产物）**：路由跳转后 `get_timeline({windowMs: 5000, minDurationMs: 4})` 返回 6 条明细，`nodeId` 直接喂 `vue-devtools_get_component_state` 拿到组件状态；`file` 补全落到 `.../Qrcode.vue`、`.../guide/quickstart.md`。

## 3. 被拒方案

| 方案 | 被拒原因 |
| --- | --- |
| 读 DevTools UI 的 timeline store | 页面里根本没有；有数据的那份在另一个进程；且是展示用原始流（未配对、无 nodeId 关联、无阈值过滤） |
| 用 `devtools.hook.on.perfStart` 等类型友好的包装 | 经 `subscribeDevToolsHook` 转发，被 `highPerfModeEnabled` 门控（:1172-1198）；实测该门控在新加载页面就是开的 |
| 常驻打开 `recordingState` / 关闭 highPerf 以复用官方 timeline | 会污染用户真实 DevTools UI 的录制状态并写入 localStorage；而原始 hook 不需要这些开关 |
| `start/stop` 做成 armed 状态机 | 只划窗口的话与 `mark` 无差别（同一份环、同一套 schema），却引入"agent 忘了 start 就永久丢失现象"这个最贵的失败模式；`clear` 已能表达"从现在开始录" |
| 生命周期事件也产明细记录 | 一次跳转 66 条 `component:updated`，全是计数噪音；聚合后反而是"过度渲染"的信号，进 summary 更合适 |
| 采 mouse / keyboard 层 | 事后开启无效（监听器在 plugin setup 时挂载）；记录用户真实输入；agent 调试信号低 |
| 让 agent 自己 `evaluate_script` 采集 | 跨调用缓冲、配对、裁剪都要重造，且每个会话重复发明 |

## 4. 后果

- **数据是"最近一段"，不是"某次会话"**：环容量 1000 条约覆盖 9~18 次路由跳转；高频页面（动画/输入）只覆盖最近几秒。`buffer.dropped`、`notes` 负责把"数据不完整"讲清楚，不让 agent 误读。
- **整页刷新会清空**：SPA 路由切换保留，硬刷新/新开页重新开始；`buffer.bootId` 与 `notes` 用于把这种情况和"没有活动"区分开。
- **不含网络与 console**：这两块仍由 `chrome-devtools_*` 工具负责，时间线只做组件/路由/事件维度。
- **`safeStringify` 按"当前路径上的祖先"判环，而不是"出现过的所有对象"**：后者会把**被多处共用的对象**当成循环引用——实测 `routes[0].meta === routes[6].children[0].meta`（同一对象、不是环）被写成 `"[Circular Reference]"`，agent 读 `meta.title` 拿到假值还以为数据有环。改为祖先链判环后：真环照旧标记（序列化不失败），共享引用重复输出（路由表 3588→3788 字节，代价可忽略）。`get_current_route` / `get_routes` 另外各自 `safeStringify`，让两段互不牵连。
- **术语**：本 ADR 的"时间线"指 aipanel 自己的页面侧采集缓冲，**不是** Vue DevTools UI 的 Timeline 面板（后者无存储、也不受我们控制）。
- **单一来源**：层名与默认值定义在 `@aipanel/core` 常量（`VUE_DEVTOOLS_TIMELINE_LAYERS` / `VUE_DEVTOOLS_TIMELINE_DEFAULTS`），工具 schema 与页面侧采集器共用；原始 hook 事件名在采集器里集中定义一次（devtools-kit 的 `DevToolsHooks` 只有 d.ts 声明、运行时未导出，无法 import）。
- 生命周期计数是**累计值**（自页面加载或上次 `clear`），与 `windowMs` 窗口无关，摘要在 `summary.lifecycle.note` 里标注。
- **nodeId 优先复用 devtools-kit 写在实例上的标识**（`instance.__VUE_DEVTOOLS_NEXT_UID__`、`app.__VUE_DEVTOOLS_NEXT_APP_RECORD_ID__`），而不是按引用比对 `appRecords`：实测后者会漏（同一页面出现过 `?:4` 这类没解析出 appId 的 nodeId），前者与组件树 id 同源，可直接喂 `vue-devtools_get_component_state`。挂载早期 app 上尚未写标识时，再退一层到 `instance.appContext.app`（与 devtools-kit `getComponentId` 同一条退路），否则这批记录会落到 `?` 分组、在 `byComponent` 里表现为同名重复行。

## 5. 后续（未决定）

- **P2 第三方 timeline 层**（pinia / 自定义插件 / 多 router）：需要窗口内临时打开 `recordingState` 并快照还原（只改内存、不写 localStorage）。开窗前需要一次 spike：实测同一页面 `__VUE_DEVTOOLS_KIT_TIMELINE_LAYERS` 里没有 vue-router 的层，而 `timelineLayersState` 有 `org.vuejs.router`，跨 devtools-kit 实例的可见性待确认。
- **P3 host 侧镜像**：把记录批量 flush 到 host（复用 `VUE_DEVTOOLS_API_PATH`）以存活整页刷新与跨 tab；`get_timeline` 的返回形状不必变。
