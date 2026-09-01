# 更新日志

## v1.2.7

`2026-09-01`

### opencode

#### ⚡ 改进

- 重构编辑后诊断插件：移除独立 `@aipanel/opencode-plugins` 包，插件随 provider 包一起编译到 `es/plugins`，统一复用核心层诊断引擎（与 dsh 侧审查工具共用同一实现，保证行为一致）
- 新增 `run_diagnostics` 工具，支持 Agent 主动触发单文件或全量项目诊断（ESLint + vue-tsc）
- 移除 `MIGRATED_TO_MCP_PLUGINS` 过滤逻辑，清理旧插件包残留
- 移除 `enableBlockOnError` 配置项：编辑后不再因错误回滚文件，改为将诊断结果追加到工具输出供 Agent 查看，并同步清理 types / 默认配置 / 环境变量 / 文档速查表中的相关配置

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.2.7/packages/extension/aipanel-assistant.zip)

## v1.2.6

`2026-08-31`

### core

#### ✨ 新增

- 新增代码诊断引擎，封装 ESLint + vue-tsc 检查逻辑，作为审查工具与编辑后自动诊断的统一实现

### deepseek

#### ✨ 新增

- 新增 `enableDiagnostics`（诊断总开关）与 `autoDiagnose`（编辑后自动诊断）配置项，默认开启，对齐 opencode `enableLsp` 的默认行为
- 新增诊断卡片视图，结构化渲染诊断结果：卡片式布局、作用域标识、可点击的文件跳转，兼容 snake_case / camelCase 文件路径参数

### opencode

#### ⚡ 改进

- 重构 block-on-error 插件，移除重复的诊断实现，统一复用核心层诊断引擎

### ui

#### 🐛 修复

- 修复诊断面板展开逻辑，仅在任务完成后才可展开
- 移除样式中的硬编码默认色值，统一使用 CSS 变量引用

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.2.6/packages/extension/aipanel-assistant.zip)

## v1.2.5

`2026-08-28`

### deepseek

#### ✨ 新增

- 实现选中元素上下文精准注入：为选中元素分配稳定的节点 ID（`ensureNodeId`），引用以 `@节点[n<id>]` 标记序列化进会话文本，host 端（dsh-plugin）在 agent/pre-step 按 ID 从核心层 context 端点精确反查并注入用户实际引用的节点上下文，注入后清空已消费元素，避免残留与重复
- 选中元素交互优化：引用以节点标记插入输入框光标处（自动补齐前后空格保证气泡高亮），同一节点（filePath+line）重复选中时复用已分配 ID，保持会话标记与上下文注入一致

### ui

#### 🐛 修复

- 修复元素选择时文本提取不完整的问题：不再只取直接文本节点，改用 `innerText` 获取整棵子树的完整可见文本（SVG 等无 `innerText` 时回退到 `textContent`），避免行内子元素（如 `<span>`/`<b>`）文本丢失

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.2.5/packages/extension/aipanel-assistant.zip)

## v1.2.4

`2026-08-27`

### 🐛 修复

- 回退 MCP 代理的 pageId 路由处理：关闭 `chrome-devtools-mcp` 的 `pageIdRouting`，在转发工具调用前先通过 `select_page` 选中目标页面并剥离 `pageId` 参数，规避底层 schema 强制必填 `pageId` 导致的参数校验失败

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.2.4/packages/extension/aipanel-assistant.zip)

## v1.2.3

`2026-08-27`

### 🐛 修复

- 适配 `chrome-devtools-mcp` 1.8+ 的 `pageIdRouting` 模式：强制开启并按 pageId 原样透传目标参数，由底层工具路由，解决页面级工具调用报「缺失 pageId」校验错误的问题

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.2.3/packages/extension/aipanel-assistant.zip)

## v1.2.2

`2026-08-27`

### ⚡ 优化

- 优化 DeepSeek 引擎选中元素的序列化格式，统一特殊字符转义规则，使用带引号的格式以完整保留类选择器空格并支持整条高亮

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.2.2/packages/extension/aipanel-assistant.zip)

## v1.2.1

`2026-08-26`

### 🐛 修复

- 修复 MCP 进程异常退出（崩溃/启动即退）时错误信息不明确的问题，现在会输出包含退出码、信号与 stderr 的精确原因
- 修复 MCP 启动失败后错误被永久缓存的问题，失败后允许重新拉起进程

### ⚡ 优化

- 升级 `chrome-devtools-mcp` 依赖到 1.8.0
- MCP 进程异常退出时默认在控制台输出 warn 级告警日志，方便定位 Chrome 未启动、CDP 连接失败等问题

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.2.1/packages/extension/aipanel-assistant.zip)

## v1.2.0

`2026-08-26`

### ✨ 新增

- 支持 **DeepSeek Harness (dsh)** AI 引擎，可与 OpenCode 自由切换（需额外安装 `@aipanel/provider-deepseek`）
- 新增 **纯净 MCP 模式**（`mcpOnly`）：只提供 AI 工具能力，不启动对话界面，方便外部 Agent 调用

### 🐛 修复

- 优化会话加载体验，修复对话过程中的加载闪动与卡住问题
- 修复会话标题显示与自动切换不同步的问题

### ⚡ 优化

- 完善 DeepSeek 引擎的会话管理与界面交互
- 隐藏 DeepSeek 界面中无用的「选择工作区」按钮
- 插件整体更名为 AIPanel 品牌，入口更统一

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.2.0/packages/extension/aipanel-assistant.zip)

## v1.1.69

`2026-08-21`

### deps

#### ⚡ 改进

- 升级 `@pagoda-cli/core` 依赖从 1.0.18 到 1.0.20

### mcp

#### ⚡ 改进

- 优化页面会话标识长度，使用 8 位随机字符，避免多 Tab 场景下标识碰撞
- 简化 Chrome 页面匹配策略，仅使用 `sessionId` 匹配并移除 URL 降级逻辑
- 添加页面查询重试机制，规避 Chrome 连接/标签页枚举未完成时的竞态问题
- 完善错误处理，明确返回调用失败原因，透出页面定位失败的具体原因

### docs

#### ⚡ 改进

- 完善主题定制文档，补充三层变量体系架构说明、组件精细定制示例与暗黑模式角色分工细节

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.1.69/packages/extension/opencode-assistant.zip)

## v1.1.68

`2026-08-17`

### deps

#### ⚡ 改进

- 升级 `@pagoda-cli/core` 依赖从 1.0.17 到 1.0.18

### docs

#### ⚡ 改进

- 重构 vite 包 README 文档，精简为快速开始流程，补充浏览器扩展安装步骤与工作原理说明

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.1.68/packages/extension/opencode-assistant.zip)

## v1.1.67

`2026-08-14`

### mcp

#### ✨ 新增

- 新增 `chrome-devtools_new_page` 工具，支持打开新标签页加载页面；仅允许访问当前项目的页面，若项目已有打开的页面则自动复用并返回已有页面信息，避免重复打开

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.1.67/packages/extension/opencode-assistant.zip)

## v1.1.66

`2026-08-13`

### mcp

#### ⚡ 改进

- 统一 DevTools 工具命名规范，改为 `chrome-devtools_` 前缀，移除工具名映射表
- 将 Vue DevTools 调试能力迁移至 MCP 工具体系，以 `vue-devtools_` 前缀提供组件树、组件状态、路由等工具
- 将 Vite 进程日志与服务日志插件迁移为 MCP 工具，以 `logs-devtools_` 前缀提供日志查询能力
- 移除 MCP 令牌校验逻辑，简化端点认证

### vue-devtools

#### ⚡ 改进

- `executeAction` 调整为导出函数，供 MCP 端点复用

### opencode

#### ⚡ 改进

- 重构插件加载逻辑，过滤已迁移到 MCP 的插件（`vue-devtools.js`、`vite-logs.js`、`service-logs.js`），避免工具重复

### docs

#### ⚡ 改进

- 更新页面上下文提示文本中的工具命名规范

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.1.66/packages/extension/opencode-assistant.zip)

## v1.1.65

`2026-08-13`

### vue-devtools

#### 🐛 修复

- 增加 `nodeId` 有效性校验，避免获取已卸载组件的状态
- 统一接口返回格式为 JSON 字符串，补充组件状态获取失败等错误提示

#### ⚡ 改进

- 组件树查询接口新增 `filter` 参数支持，可按组件名过滤缩小查询范围
- 优化 Vue 内部对象识别逻辑，新增 `__isVue` 实例判断

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.1.65/packages/extension/opencode-assistant.zip)

## v1.1.64

`2026-08-13`

### test

#### ⚡ 改进

- 清理测试文件中冗余的导入和测试用例

### utils

#### ⚡ 改进

- 从 shared 包抽离通用的 `createPackageRequire` 与 `resolvePackageDir` 工具函数
- 移除各模块内重复的包目录解析实现，统一复用公共工具

### vue-devtools

#### ⚡ 改进

- 简化 Vue DevTools 桥接文件路径解析逻辑

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.1.64/packages/extension/opencode-assistant.zip)

## v1.1.63

`2026-08-13`

### deps

#### ⚡ 改进

- 升级 `chrome-devtools-mcp` 依赖从 1.6.0 到 1.7.0

### mcp

#### ⚡ 改进

- 默认启动参数新增 `--no-performance-crux`，禁用向 Google CrUX API 上报性能 trace 数据

### 📦 产物

- [Chrome 插件下载](https://github.com/code-farmer-i/vite-plugin-aipanel/raw/v1.1.63/packages/extension/opencode-assistant.zip)

## v1.1.62

`2026-08-12`

### config

#### ✨ 新增

- 新增 `enablePrettier` 配置项，支持控制代码格式化功能的开关，默认开启

### process

#### ⚡ 改进

- 重构 `killOrphanOpenCodeProcesses` 孤儿进程清理逻辑，增加超时处理机制

### vue-devtools

#### ⚡ 改进

- 全面优化 `vue-devtools-bridge` 桥接脚本，增加组件数据裁剪与安全处理
- 删除冗余的 `vue_devtools_find_component` 工具方法，精简 Vue DevTools 插件

## v1.1.61

`2026-08-12`

### mcp

#### ⚡ 改进

- 统一页面 ID 校验逻辑，提取 `validatePageId` 公用方法，MCP 代理和 Vue DevTools 端点复用

### vue-devtools

#### ⚡ 改进

- 工具改为显式传入 `pageId` 参数，支持多页面场景下精确定位目标页面
- 移除端点的自动页面解析逻辑（`resolveActivePageId`），简化调用链路

## v1.1.60

`2026-08-12`

### config

#### ⚡ 改进

- 调整默认配置：默认主题改为 `dark`，默认展示模式改为 `extension`
- `DEFAULT_CONFIG` 补充 `Partial<OpenCodeOptions>` 类型定义

## v1.1.59

`2026-08-12`

### vue-devtools

#### 🐛 修复

- 修复 `toggleApp` 调用返回值异常的问题，添加显式 ok 返回
- 修复获取路由信息的逻辑，改为直接使用 Vue DevTools 提供的全局路由信息对象
- 添加 `safeStringify` 方法处理循环引用导致的序列化问题

## v1.1.58

`2026-08-12`

### deps

#### ⚡ 改进

- 升级 Vite 依赖版本到 8.2.1
- 安装 `@vue/devtools-kit` 依赖包

### docs

#### ✨ 新增

- 新增更新日志页面并添加导航入口

### vue-devtools

#### ✨ 新增

- 新增 Vue DevTools 集成能力
  - 新增桥接脚本，注入页面暴露调试 API
  - 新增 API 端点，通过 MCP 代理调用浏览器调试能力
  - 新增插件，提供组件树、状态、路由等调试工具

## v1.1.57

`2026-08-10`

### deps

#### ⚡ 改进

- 更新 `@pagoda-cli/core` 依赖到 1.0.17

### opencode

#### 🐛 修复

- npm 全局安装 OpenCode 时检测不到的问题，子进程调用添加 `shell` 参数
