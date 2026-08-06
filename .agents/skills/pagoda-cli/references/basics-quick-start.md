---
name: basics-quick-start
description: "提供安装 Pagoda CLI 及从零搭建 Vue 组件库项目的完整步骤。当用户询问如何开始、安装 CLI 或初始化新组件库项目时调用此 skill。"
---

# 快速上手指南

本指南涵盖了如何安装 Pagoda CLI 以及如何从零开始初始化一个标准的 Vue 组件库项目。

## Usage

当用户要求从零搭建组件库，或询问如何安装和配置 Pagoda CLI 时，请按照以下步骤引导：

### 1. 检查环境要求

确保用户的开发环境满足以下条件：
- **Node.js**: ^14.16.0 || >=16.0.0
- **包管理器**: pnpm (推荐) / npm / yarn
- **操作系统**: macOS / Linux / Windows

### 2. 初始化项目与安装依赖

推荐在**项目内部**安装 CLI，以保证团队成员使用相同的版本，避免全局环境差异导致的构建失败。

```bash
# 创建并进入项目目录
mkdir my-ui-lib && cd my-ui-lib
npm init -y

# 安装 Vue 和 Pagoda CLI 核心包
pnpm add vue
pnpm add -D @pagoda-cli/core
```

### 3. 创建核心配置文件

在项目根目录创建 `pagoda.config.mjs`，这是驱动整个工具链的核心。

```javascript
// pagoda.config.mjs
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  name: 'my-ui-lib',
  build: {
    // 指定包管理器用于依赖安装和发布
    packageManager: 'pnpm',
  },
  site: {
    title: 'My UI Lib',
    description: '我的第一个组件库',
    // 配置文档站点左侧导航栏
    nav: [
      {
        title: '组件',
        view: 'components',
        items: [
          { title: 'Button 按钮', view: 'button' }
        ]
      }
    ]
  }
});
```
**原因**：`pagoda.config.mjs` 定义了构建行为和文档站点的结构。使用 `.mjs` 确保以 ES Module 方式加载。

### 4. 创建第一个组件与文档

按照规范在 `src` 下创建组件代码及文档：

1. **组件实现 (`src/button/src/button.vue`)**:
   ```vue
   <template>
     <button class="my-button" :class="type"><slot></slot></button>
   </template>
   <script setup>
   defineProps({ type: { type: String, default: 'default' } });
   </script>
   <style scoped>.my-button { padding: 8px; }</style>
   ```

2. **组件入口 (`src/button/index.ts`)**:
   ```typescript
   import Button from './src/button.vue';
   export default Button;
   ```

3. **组件文档与 Demo (`src/button/README.md`)**:
   ```markdown
   # Button 按钮
   
   ::::demo
   ## 基础用法
   :::demo-preview
   basic
   :::
   ::::
   ```
   *注意：`:::demo-preview basic :::` 会自动寻找并渲染同目录 `demo/basic.vue` 文件。*

### 5. 注册全局组件

为了让文档站能够正确渲染你开发的组件，你需要在文档站入口文件中进行全局注册。

根据你开发的是 PC 端还是移动端组件库，入口文件的位置有所不同：
- **PC 端组件库**：入口为 `site/desktop/index.js`
- **移动端组件库**：需要在 `site/mobile/index.js`（用于右侧移动端模拟器内的真实渲染）中进行注册。

这里以 PC 端为例，**创建桌面端文档入口 `site/desktop/index.js`:**

```javascript
import Button from '../../src/button/src/button.vue';

export default {
  install(app) {
    app.component('my-button', Button);
  }
};
```

### 6. 配置 npm 脚本并启动

在 `package.json` 中添加快捷脚本：

```json
{
  "scripts": {
    "site": "pagoda-cli site",
    "build": "pagoda-cli build",
    "build-site": "pagoda-cli build-site",
    "release": "pagoda-cli release"
  }
}
```

**运行开发服务器**：
```bash
pnpm run site
```
此命令会启动本地文档站（默认 `localhost:5173`），你可以在此实时预览组件修改并编写文档。
