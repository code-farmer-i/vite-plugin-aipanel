---
name: basics-project-structure
description: "提供 Pagoda CLI 推荐的标准项目、组件及样式目录结构规范。当用户需要新建项目、组织代码目录或询问项目结构规范时调用此 skill。"
---

# 项目结构规范

本指南提供了 Pagoda CLI 推荐的组件库项目目录结构规范，帮助你以更可维护和可扩展的方式组织代码。

## Usage

当你需要指导用户初始化项目、重构现有组件目录，或解答文件放置位置的疑问时，请参考以下规范：

### 1. 标准顶层目录结构

推荐将源码、文档站、脚本和配置文件清晰分离：

```text
my-component-library/
├── src/                          # 源码主目录：存放所有组件、样式、工具函数
├── site/                         # 文档站目录：存放自定义文档、Demo 及定制化页面
├── docs/                         # 额外文档（如 CONTRIBUTING.md）
├── scripts/                      # 构建与辅助脚本
├── pagoda.config.mjs             # CLI 核心配置文件
├── package.json
└── tsconfig.json                 # TypeScript 基础配置
```

**原因**：保持根目录整洁，将业务逻辑 (`src/`) 与文档展示 (`site/`) 严格解耦，便于独立构建与维护。

### 2. 组织组件结构

组件结构分为**简单组件**和**复杂组件**，应根据复杂度灵活调整。

#### 简单组件模式
对于单一功能的组件，采用扁平化结构：
```text
src/icon/
├── src/
│   ├── icon.vue              # 组件模板与逻辑
│   └── icon.ts               # 属性 Props 和类型定义
├── index.ts                  # 组件导出入口
└── README.md                 # 组件文档与 Demo 展示
```
**为什么分离 `.vue` 和 `.ts`**：将 Props 和类型定义提取到单独的 `.ts` 文件中，有利于在其它组件中复用类型，同时保持 `.vue` 文件精简。

#### 复杂组件模式
对于包含子组件、复杂状态管理的组件：
```text
src/table/
├── src/
│   ├── table.vue             # 主组件
│   ├── components/           # 内部子组件 (如 table-header.vue)
│   └── utils.ts              # 专属工具函数
├── composables/              # 专属组合式函数 (如 use-sort.ts)
├── style/                    # 专属样式 (如果未放入全局 style 目录)
├── __tests__/                # 单元测试
├── index.ts                  # 组件导出入口
├── README.md                 # 组件文档
└── demo/                     # 复杂 Demo 拆分为单独的 Vue 文件
    ├── base.vue
    └── sort.vue
```

### 3. 组织全局样式结构

推荐使用 Less（CLI 默认）或 SCSS，并统一放置于 `src/style/` 目录下集中管理：

```text
src/style/
├── common/                       # 公共样式片段
│   ├── base.less                 # 基础全局样式
│   ├── variables.less            # CSS 变量/主题变量
│   └── mixins.less               # 样式混入
├── animations/                   # 动画相关样式
└── index.less                    # 样式总入口
```
**原因**：集中管理有助于生成统一的主题文件，并在构建时正确提取为独立的 CSS 产物，方便按需加载。

### 4. 暴露全局配置 (setup.ts)

如果组件库在通过 `app.use()` 安装时需要注入全局配置、属性或指令，创建 `src/setup.ts`：

```typescript
// src/setup.ts
export const version = '1.0.0';

export default {
  install(app, options) {
    // 注入全局配置，如 $myLib
    app.config.globalProperties.$myLib = options;
  },
};
```
**何时使用**：Pagoda CLI 会在构建时自动识别此文件，并将其合并到最终产物的入口中。适用于提供全局弹窗方法、主题切换配置等场景。
