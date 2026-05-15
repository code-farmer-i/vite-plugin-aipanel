---
name: basics-introduction
description: "介绍 Pagoda CLI 的核心特性、适用场景与优势。当用户询问什么是 Pagoda CLI、它能做什么或是否适合当前项目时调用此 skill。"
---

# Pagoda CLI 简介

Pagoda CLI 是一个专为 Vue 3 组件库开发设计的现代化构建工具链，基于 Vite 构建，提供开箱即用的组件库开发、文档生成与发布体验。

## Usage

当你需要向用户介绍 Pagoda CLI 或评估其适用性时，参考以下核心能力和使用场景：

### 1. 核心能力列表

- **快速开发体验**：基于 Vite 提供热更新的文档站开发服务器，内置完整的 TypeScript 支持。
- **强大的构建能力**：一键生成 ESM、CommonJS、UMD 多种模块格式的产物；支持 Less、Sass、CSS 样式预处理；内置 Tree Shaking 和按需加载支持。
- **一站式文档站**：提供桌面端和内置移动端模拟器的实时预览，支持 Markdown 增强语法（如直接嵌入 Vue 组件 Demo）。
- **完善的发布管理**：提供交互式发布流程，支持自动生成 Changelog、更新版本号、打 Git Tag 以及多包管理器（npm/yarn/pnpm）发布。

### 2. 适用场景分析

#### 场景 A：开发 Vue 3 UI 组件库
如果你需要从零开发一个 Vue 3 组件库，Pagoda CLI 提供了最完整的闭环方案。
```bash
# 开发文档站点及组件
pagoda-cli site

# 构建产物
pagoda-cli build

# 一键发布
pagoda-cli release
```
**原因**：内置了文档站与移动端模拟器，极大降低了组件库工程化配置的成本。

#### 场景 B：开发纯 JavaScript/TypeScript 类库
对于无需 UI 组件的纯函数库，同样适用。
```js
// pagoda.config.mjs
export default defineConfig({
  build: {
    mode: 'lib', // 切换为纯类库构建模式
  },
});
```
**原因**：可以复用其多模块格式打包能力（ESM/CJS/UMD）及快速编译特性。

#### 场景 C：为现有组件库搭建文档站
如果已有代码产物，仅需文档能力：
```bash
# 构建文档静态站点
pagoda-cli build-site
```
**原因**：开箱即用的 Vitepress 替代方案，尤其适合需要移动端模拟器的 UI 库。

### 3. 与其他工具的对比（为什么选择 Pagoda CLI？）

- **对比 Vite Library Mode**：Vite 默认只处理构建，你需要自行搭配 Vitepress 并解决组件注册、样式分离等问题。Pagoda CLI 将构建与文档站高度整合，开箱即用。
- **对比 Vue CLI**：Vue CLI 基于 Webpack，速度较慢，且同样缺乏对组件库文档及多格式构建的原生良好支持。Pagoda CLI 基于 Vite 和 esbuild，速度极快。
