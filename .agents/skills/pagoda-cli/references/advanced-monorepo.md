---
name: advanced-monorepo
description: "在 Monorepo (pnpm workspace) 环境下使用 Pagoda CLI 的指南。当用户需要同时维护组件库、工具库和文档站，或需要配置包间依赖时调用。"
---

# Monorepo 支持

该 Skill 提供了在基于 `pnpm workspace` 的 Monorepo 结构下，使用 Pagoda CLI 进行组件库、工具库和文档站协同开发的最佳实践。

## 适用场景

- 需要在一个仓库中同时管理多个包（如 `@my-org/components`、`@my-org/utils`）。
- 需要配置子包间的相互依赖（如组件库依赖工具库）。
- 需要统一管理多个包的开发、构建与发布工作流。

## 核心配置与实现

### 1. 推荐的 Monorepo 目录结构

```text
my-monorepo/
├── packages/
│   ├── components/          # 业务组件库 (构建模式: components)
│   │   ├── src/
│   │   ├── package.json
│   │   └── pagoda.config.mjs
│   ├── utils/               # 纯工具函数库 (构建模式: lib)
│   │   ├── src/
│   │   ├── package.json
│   │   └── pagoda.config.mjs
│   └── site/                # 统一文档站 (只开发不发布)
│       ├── src/
│       ├── package.json
│       └── pagoda.config.mjs
├── pnpm-workspace.yaml      # pnpm 工作区声明
└── package.json             # 根目录依赖与 scripts
```

### 2. 配置工作区与子包

**步骤 1：声明 Workspace**
创建根目录的 `pnpm-workspace.yaml`：
```yaml
packages:
  - 'packages/*'
```

**步骤 2：组件库配置 (`packages/components/pagoda.config.mjs`)**
必须声明构建模式为 `components`：
```javascript
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  name: '@my-org/components',
  build: {
    mode: 'components',
    packageManager: 'pnpm',
  },
});
```

**步骤 3：工具库配置 (`packages/utils/pagoda.config.mjs`)**
必须声明构建模式为 `lib`，纯工具通常不需要 umd：
```javascript
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  name: '@my-org/utils',
  build: {
    mode: 'lib',
    packageManager: 'pnpm',
    umd: false,
  },
});
```

### 3. 处理包间依赖

如果 `components` 依赖 `utils`，在 `packages/components/package.json` 中使用 `workspace:*` 协议：
```json
{
  "dependencies": {
    "@my-org/utils": "workspace:*"
  }
}
```

代码中正常导入：
```ts
// packages/components/src/Button/index.vue
import { debounce } from '@my-org/utils';
```

## 构建与开发工作流

在根目录 `package.json` 中配置统一脚本，利用 `pnpm -r` (递归) 和 `--filter` 选项进行操作。

```json
{
  "scripts": {
    "dev": "pnpm -r run dev",
    "build": "pnpm -r run build",
    "build:utils": "pnpm --filter @my-org/utils build",
    "build:components": "pnpm --filter @my-org/components build"
  }
}
```

> **注意：** 在首次启动组件库的开发或构建前，必须先构建其依赖的工具库，或者使用 `pnpm -r run build` 按依赖树自动排序构建。

## 最佳实践与边界情况

1. **类型提示（TypeScript）**：如果包间依赖在 IDE 中缺少类型提示，确保先对被依赖项（如 `utils`）执行一次构建生成 `es/index.d.ts`，或者在组件库的 `tsconfig.json` 中配置 `paths` 别名指向 `utils/src`。
2. **文档站引用**：在 `packages/site/vite.config.ts` 中配置别名，直接指向源码目录以实现热更新：
   ```js
   export default {
     resolve: {
       alias: {
         '@my-org/components': '../components/src',
         '@my-org/utils': '../utils/src'
       }
     }
   }
   ```
3. **版本发布**：推荐使用 `@changesets/cli` 在根目录统一管理多包的 Changelog 与版本发布。
