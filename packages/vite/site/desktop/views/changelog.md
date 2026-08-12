# 更新日志

## v1.1.61

`2026-08-12`

### ⚡ 改进

- 统一页面 ID 校验逻辑，提取 `validatePageId` 公用方法，MCP 代理和 Vue DevTools 端点复用
- Vue DevTools 工具改为显式传入 `pageId` 参数，支持多页面场景下精确定位目标页面
- 移除 Vue DevTools 端点的自动页面解析逻辑（`resolveActivePageId`），简化调用链路

---

## v1.1.60

`2026-08-12`

### ⚡ 改进

- 调整默认配置：默认主题改为 `dark`，默认展示模式改为 `extension`
- `DEFAULT_CONFIG` 补充 `Partial<OpenCodeOptions>` 类型定义

---

## v1.1.59

`2026-08-12`

### 🐛 修复

- 修复 Vue DevTools `toggleApp` 调用返回值异常的问题，添加显式 ok 返回
- 修复获取路由信息的逻辑，改为直接使用 Vue DevTools 提供的全局路由信息对象
- 添加 `safeStringify` 方法处理循环引用导致的序列化问题

---

## v1.1.58

`2026-08-12`

### ✨ 新增

- 新增 Vue DevTools 集成能力
  - 新增 Vue DevTools 桥接脚本，注入页面暴露调试 API
  - 新增 Vue DevTools API 端点，通过 MCP 代理调用浏览器调试能力
  - 新增 Vue DevTools 插件，提供组件树、状态、路由等调试工具
- 新增更新日志页面并添加导航入口

### ⚡ 改进

- 升级 Vite 依赖版本到 8.2.1
- 安装 `@vue/devtools-kit` 依赖包

---

## v1.1.57

`2026-08-10`

### 🐛 修复

- npm 全局安装 OpenCode 时检测不到的问题，子进程调用添加 `shell` 参数

### ⚡ 改进

- 更新 `@pagoda-cli/core` 依赖到 1.0.17
