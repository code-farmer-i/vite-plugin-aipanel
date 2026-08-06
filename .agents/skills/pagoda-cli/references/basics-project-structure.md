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

`site/` 目录子结构：
```text
site/
├── desktop/                       # 桌面端文档站
│   ├── views/                     # 文档页面（Markdown/Vue）
│   ├── components/                # 文档站自定义组件
│   ├── style/                     # 文档站样式
│   ├── index.js                   # 桌面端入口配置
│   └── style.js                   # 桌面端样式入口
├── mobile/                        # 移动端文档站（模拟器）
│   ├── components/
│   ├── index.js
│   └── style.js
├── common/                        # 桌面和移动端共享资源
│   ├── components/
│   └── style/
└── static/                        # 静态资源（logo.png 等）
```

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

### 3. 工具函数目录 (src/utils/)

```text
src/utils/
├── dom.ts                        # DOM 操作
│   ├── addClass
│   ├── removeClass
│   └── hasClass
├── helpers.ts                    # 辅助函数
│   ├── debounce
│   ├── throttle
│   └── deepClone
├── format.ts                     # 格式化
│   ├── formatDate
│   └── formatNumber
└── index.ts                      # 导出入口
```

### 4. 组合式函数目录 (src/composables/)

```text
src/composables/
├── useClickOutside.ts            # 点击外部检测
├── useIntersection.ts            # 交叉观察
├── useResize.ts                  # 尺寸监听
├── useStorage.ts                 # 本地存储
└── index.ts                      # 导出入口
```

### 5. 组织全局样式结构

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

> **注意**：Pagoda CLI 默认使用 Less 作为样式预处理器。如需切换到 SCSS，在 `pagoda.config.mjs` 中配置 `build.css.preprocessor: 'scss'`。

### 6. 暴露全局配置 (setup.ts)

如果组件库在通过 `app.use()` 安装时需要注入全局配置、属性或指令，创建 `src/setup.ts`：

```typescript
// src/setup.ts

// 1. 导出其他辅助模块（会被合并到最终产物的入口导出中）
export * from './composables/useClickOutside';
export const version = '1.0.0';

// 2. 默认导出包含 install 方法的对象
export default {
  install(app, options) {
    // 注入全局配置，如 $myLib
    app.config.globalProperties.$myLib = options;
  },
};
```
**何时使用**：Pagoda CLI 会在构建时自动识别此文件，并将其合并到最终产物的入口中。`export *` 可将 composables、utils 等模块也暴露给使用者。适用于提供全局弹窗方法、主题切换配置等场景。

### 7. package.json 关键字段

```json
{
  "name": "my-component-library",
  "version": "1.0.0",
  "main": "lib/index.js",
  "module": "es/index.js",
  "types": "es/index.d.ts",
  "unpkg": "lib/my-lib.min.js",
  "jsdelivr": "lib/my-lib.min.js",
  "files": [
    "es",
    "lib"
  ],
  "exports": {
    ".": {
      "import": "./es/index.js",
      "require": "./lib/index.js",
      "types": "./es/index.d.ts"
    },
    "./*": "./*",
    "./style.css": "./lib/index.css"
  },
  "sideEffects": [
    "**/*.css",
    "**/*.scss",
    "**/*.less"
  ],
  "scripts": {
    "dev": "pagoda-cli dev",
    "build": "pagoda-cli build",
    "site": "pagoda-cli site",
    "build-site": "pagoda-cli build-site",
    "release": "pagoda-cli release",
    "lint": "pagoda-cli lint",
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  }
}
```

**关键字段说明**：`main`/`module`/`types` 定义 npm 入口与类型声明路径；`unpkg`/`jsdelivr` 用于 CDN 访问；`exports` 支持条件导出；`sideEffects` 必须包含 `**/*.css`、`**/*.scss`、`**/*.less`，否则 Tree Shaking 会误删 CSS 文件。

### 8. .gitignore

```gitignore
# Dependencies
node_modules/

# Build outputs
dist/
es/
lib/
site-dist/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment
.env
.env.local
.env.*.local

# Test
coverage/
```
