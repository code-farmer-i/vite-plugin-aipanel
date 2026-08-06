---
name: config-overview
description: "提供 Pagoda CLI 的全局配置项概览（pagoda.config.mjs）。当用户需要初始化配置文件、查询配置结构或遇到整体配置冲突时调用此 skill。"
---

# 配置文件概述

Pagoda CLI 使用 `pagoda.config.mjs` 作为核心配置文件，放置在项目根目录，与 `package.json` 同级。

## Usage

当你需要指导用户创建或修改 Pagoda CLI 全局配置时，请参考以下结构和示例：

### 1. 基础配置方式

推荐使用 `@pagoda-cli/core` 提供的 `defineConfig` 函数来获得完整的 TypeScript 类型提示。

```js
// pagoda.config.mjs
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  name: 'my-component-library', // 包或站点名称
  build: {
    // 组件库构建配置
  },
  site: {
    // 文档站内容和行为配置
  },
});
```

### 2. 核心配置分类

配置主要分为三大块：
- **顶级配置**：`name` (项目名), `hooks` (发布等流程钩子)。
- **构建配置 (`build`)**：控制如何将 `src/` 下的代码打包为组件库产物。详见 `config-build` skill。
- **文档站配置 (`site`)**：控制文档站点的展示（导航、Logo、多语言）与构建行为。详见 `config-site` skill。

### 3. TypeScript 支持与环境变量

如果需要强类型检查，可以使用 JSDoc 配合 TypeScript 类型：

```ts
import { defineConfig, type PagodaCliConfig } from '@pagoda-cli/core';

const config: PagodaCliConfig = {
  name: 'my-lib',
  site: {
    title: process.env.SITE_TITLE || 'My Lib', // 支持直接读取 Node 环境变量
  }
};

export default defineConfig(config);
```

### 4. 完整配置结构参考

当用户询问完整的类型结构时：

```ts
interface PagodaCliConfig {
  name?: string;
  hooks?: { beforeRelease?: string[] };
  build?: PagodaCliBuildConfig;
  site?: PagodaCliSiteConfig;
}
```
**优先级**：命令行参数 > 配置文件 > 默认值。
