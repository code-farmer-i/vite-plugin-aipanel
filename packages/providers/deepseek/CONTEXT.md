# Provider: DeepSeek（`@aipanel/provider-deepseek`）

DeepSeek Harness (dsh) 的 `WebProvider` 实现：拉起 `dsh web`、解析启动令牌、把 AIPanel 能力以 dsh 插件形式挂进 dsh profile，再经 RPC 适配会话。

## Language

**dsh**:
DeepSeek Harness 官方 CLI；本 Provider 驱动它的 `web` 界面。
_Avoid_: deepseek-cli

**启动令牌（`LaunchToken`）**:
`dsh web` 启动时打印出的临时凭据；首次访问 Web 界面须携带它换取签名 cookie。本 Provider 从子进程 stdout 里打洞解析。
_Avoid_: token（太泛）

**cordis overlay（`--patch`）**:
不改动用户 profile、只为本会话注入 dsh 插件的叠加配置，由 `--patch` 传入。
_Avoid_: patch 文件、overlay 配置

**dsh profile**:
dsh 安装插件的位置；AIPanel 统一装进 `web` profile。

**dsh 侧插件（host / client）**:
随 dsh 启动装载的两半——宿主插件（审查工具、编辑后自动诊断、事件中继、设置下发）与浏览器插件（`@` 菜单 chip、会话聚焦、主题与布局）。

**权限预设 / 繁忙 Enter 行为**:
本 Provider 对 dsh 官方设置项（`permission.defaultPreset`、`ui-conversation.busyEnter`）的命名，取值域直接引用官方类型，不在本地复刻字面量。
