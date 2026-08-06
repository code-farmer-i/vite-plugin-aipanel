---
name: guide-js-library
description: "当用户要求创建、开发或构建纯 JS/TS 库（如工具函数、SDK）时使用。提供纯 JS/TS 库的目录结构和构建配置规范。"
---

# 纯 JS/TS 库开发指南

当用户要求开发非 Vue 组件的纯 JS/TS 库（如 utils、SDK）时，请遵循本指南。Pagoda CLI 原生支持纯 JS/TS 库的开发、类型生成与构建。

## 何时使用

- 用户要求创建一个不包含 UI 的纯逻辑库（工具库、SDK 等）。
- 用户询问如何使用 Pagoda CLI 编译纯 JS/TS 模块并生成 `.d.ts` 声明文件。

## 核心规范与执行步骤

### 1. 目录结构规范

**为什么这么做？** 清晰的目录结构有助于模块划分和统一导出。

纯 JS/TS 库的推荐结构：

```text
src/
├── index.ts        # 统一的导出入口
├── utils/          # 具体的逻辑模块
│   ├── index.ts
│   └── format.ts
├── core/           # 核心逻辑模块
│   └── index.ts
└── types/          # TypeScript 类型定义
    └── index.ts
```

### 2. package.json 入口配置（重点）

**为什么这么做？** 必须配置正确的入口字段，以确保构建出的产物（CommonJS 和 ES Module）能被使用方正确解析。

**可执行示例 (`package.json`)：**

```json
{
  "name": "my-utils",
  "version": "1.0.0",
  "main": "lib/index.js",
  "module": "es/index.js",
  "types": "es/index.d.ts",
  "exports": {
    ".": {
      "import": "./es/index.js",
      "require": "./lib/index.js",
      "types": "./es/index.d.ts"
    }
  }
}
```

**字段说明**：

- `main`：CommonJS 规范的入口文件，供 `require()` 引入使用
- `module`：ES Module 规范的入口文件，供 `import` 引入使用
- `types`：TypeScript 类型声明文件入口
- `exports`：现代 Node.js 的条件导出配置，支持不同环境使用不同的入口文件

### 3. 开发与构建命令

**开发模式：**
当需要与本地其他项目联调，或需要实时编译生成类型文件时：

```bash
pagoda-cli dev
```
*注意：此命令使用 esbuild 实时编译，并使用 vue-tsc 生成类型文件。如果是开发包含 UI 的 Vue 组件库，应使用 `pagoda-cli site`。*

**生产构建：**
完成开发后，执行构建命令生成最终产物：

```bash
pagoda-cli build
```
这会在 `es/` 和 `lib/` 目录下生成构建产物。
