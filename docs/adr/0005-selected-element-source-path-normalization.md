# 选中元素的源码路径由 Vite 端点归一化为绝对路径

**Status: accepted**（2026-09-24 实测确立；实测依据见 §2，未决项见 §5）

给 agent 的节点上下文里，「源码文件路径」一律是**绝对路径**：浏览器只上报相对路径（各 Inspector 的基准互不相同，且浏览器不知道文件系统），由 **Vite 端点**（`CONTEXT_API_PATH` 的 POST 落库前）按宿主基准探测后归一化；两个 Provider 共用同一条「依赖内部文件」归属声明。

> 归属：vite-plugin-aipanel（Host 端点）· @aipanel/core（路径工具与文案单一来源）· @aipanel/provider-opencode · @aipanel/provider-deepseek · 原则：优雅干净、单一来源

## 1. 决策

1. **归一化收口在 Vite 端点**，不在浏览器、不在 Provider：opencode / deepseek / 扩展模式三条链路都经 `CONTEXT_API_PATH`，且只有宿主同时知道 `process.cwd()`、`server.config.root` 与 git 仓库根。
2. **候选基准按 `cwd → root → gitRoot` 顺序探测**（`fs.existsSync` 命中即取）：分别对应 unplugin-vue-inspector 标记、react-dev-inspector 兼容属性、code-inspector `pathType: "relative"` 三种来源。
3. **契约是「恒为绝对路径」**：已是绝对路径幂等返回；三个基准都不存在时回退 cwd 基准，**不回退成相对值**（相对值的基准对消费方不可知，只会把问题推给下游）。
4. **依赖内部文件的归属显式化**：判定依据与文案定义在 `@aipanel/core`（`DEPENDENCY_DIR_NAME` / `DEPENDENCY_SOURCE_NOTE`），dsh 注入文本加一行「源码归属：…」，opencode chip 的 `nodeContext` 加 `sourceKind` 字段。
5. **文件名提取单一来源 `fileNameOf`**：宿主落库的是绝对路径，Windows 上会带 `\`，UI 侧原来的 `split("/").pop()` 会把整条路径当文件名。
6. **依赖真身形态（`.pnpm`）与软链形态并存时取 realpath**：与 MCP 组件树通道给出的 `file` 一致，agent 在同一会话里不会看到同一文件的两个路径形态。

## 2. 事实依据（实测）

环境：`localhost:5173` 的 docs 站点（`packages/docs`，`pnpm --filter @aipanel/docs dev`），Vue 3 + Element Plus，2026-09-24。

- **标记基准是 Vite 进程 cwd**：`unplugin-vue-inspector@6.0.0` `dist/index.mjs:30,46` 注入 `data-v-inspector="${path.relative(process.cwd(), id)}:${line}:${column}"`；docs dev 的进程 cwd 是 `packages/docs`。两条真实节点上下文的值与 `path.relative(cwd, abs)` **逐字符相等**：
  - `site/desktop/views/index.vue:139:9`
  - `../../node_modules/.pnpm/@pagoda-cli+core@1.0.23_<hash>/node_modules/@pagoda-cli/core/site/desktop/components/Header.vue:65:7`
- **基准错位的代价**：把上面第二条按 agent cwd（仓库根）解析得到 `/Users/ksen/项目/node_modules/.pnpm/...`——文件不存在，且落在工作区之外，在 workspace-write 沙箱下会被拒；按 `packages/docs` 解析则命中真实文件。⇒ 相对路径在跨目录布局里是「看起来能用、实际指错」。
- **`__file` 在 dev 下是绝对路径**：`@vitejs/plugin-vue` `dist/index.mjs:1380` 注入 `__file = filename`（非生产环境）。实测同页面的组件树通道返回 `/Users/.../packages/docs/site/desktop/views/index.vue`，即两条 agent 通道当时基准不一致。
- **React 侧 marker 是 git 仓库根相对**：`packages/vite/src/inspectors/react.ts:49` 用 `@code-inspector/core` 的 `pathType: "relative"`（注释即写明以 git 仓库根为基准，非 git 仓库回退绝对路径）⇒ 端点候选必须包含 gitRoot，否则 React 项目仍然错位。
- **同一文件有两个都存在的形态**：`<repo>/node_modules/.pnpm/<pkg>@<ver>_<hash>/node_modules/<pkg>/...`（realpath）与 `<repo>/node_modules/@pagoda-cli/core/...`（软链，realpath 指向前者）；`packages/docs/node_modules/@pagoda-cli/core` 不存在（该依赖是根级 devDependency）。

## 3. 被拒方案

| 方案 | 被拒原因 |
| --- | --- |
| Provider 侧按 agent cwd 解析 | monorepo 里 agent cwd（仓库根）≠ Vite cwd（`packages/docs`），`../..` 形态会静默拼出一个位于工作区外、不存在的绝对路径——比相对路径更有害（错得看不出来） |
| 只在 Vue 侧改用 `__file`（dev 即绝对） | React 的 marker 是 git 根相对，跨框架仍需要一处解析 ⇒ 变成两套机制，违反单一来源 |
| 浏览器侧拼绝对路径 | 页面不知道文件系统根；要走就得把 root 从构建期注入页面，耦合比端点收口更重 |
| 改第三方 marker 的生成逻辑 | `unplugin-vue-inspector` 没有可配的路径基准选项；自造 marker 会丢掉行列信息（`__file` 无行列） |
| 展示层把 `.pnpm` 真身缩短成软链形态 | 会与 MCP 组件树通道的 `file` 不一致；两个形态指向同一文件，缩短只是观感，收益不值一次路径映射 |
| 保留相对路径、只给 agent 一个「项目根」提示 | 每个消费方仍要自己拼、自己猜基准；已有的相对路径已经导致「agent 读不到文件」这个实际故障 |

## 4. 后果

- **`SelectedElement.filePath` 的契约是绝对路径**（`packages/core/src/common/types.ts` 已注明）；消费方不再需要知道基准。
- **依赖内部文件带归属**：agent 拿到 `node_modules` 路径时不会再顺着它去改第三方实现，而是回到项目源码（Header 这类「整块由依赖渲染」的元素尤其明显）。
- **文件已删除 / HMR 后失效时**：三个基准探测全失败 ⇒ 回退 cwd 基准，结果仍是绝对路径（可能不存在），agent 拿到的是可读的「文件不存在」而不是一个无法定位的相对值。
- **Windows**：绝对路径带 `\`；UI 文件名提取改走 `fileNameOf`（core 单一来源，兼容两种分隔符）。
- **测试形态**：端点用例通过注入 `fs.existsSync` 探测来归一化断言，不依赖真实文件系统；`setupContextEndpoint` 需要 `server.config.root`，相关 stub 与真实 `ViteDevServer` 对齐。

## 5. 后续（未决定）

- **是否在节点上下文里补一行 `Vite 项目根`**：对「其它相对路径来源」（日志、MCP 工具输出）能给 agent 一个基准，但会让注入文本再增一行；当前归一化已覆盖选中元素本身，故未做。
- **是否为 `.pnpm` 真身提供展示层缩短**（只改 UI 展示、不动注入值）：需要一次「软链路径 ↔ realpath」映射与存在性探测，收益仅是观感。
