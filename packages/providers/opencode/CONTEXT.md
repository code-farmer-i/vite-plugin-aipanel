# Provider: OpenCode（`@aipanel/provider-opencode`）

默认 Provider 的 `WebProvider` 实现：拉起 OpenCode Web 进程、适配其 REST API、注入桥接脚本以对齐它的 DOM 与 localStorage。

## Language

**默认 Provider（`DefaultWebProvider`）**:
`provider` 未指定或为 `"default"` 时选中的 Provider，即 OpenCode 实现。
_Avoid_: opencode provider、内置 Provider

**桥接脚本（`BridgeScript`）**:
注入 OpenCode Web 页面的脚本资产；与页面 DOM / localStorage 键强相关，属 Provider 实现细节，核心层只负责注入。

**OpenCode 内部设置（`OpenCodeSettings`）**:
存放于浏览器 localStorage `settings.v3` 的 OpenCode 设置；本 Provider 负责读写下发。
