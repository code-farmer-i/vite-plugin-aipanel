---
name: faq-faq
description: "当用户在使用 Pagoda CLI 遇到安装失败、构建报错、文档站白屏、类型未生成或发布问题时使用。提供排查思路与解决方案。"
---

# 常见问题排查指南 (FAQ)

当用户在使用 Pagoda CLI 过程中遇到各类异常错误时，请参考本指南进行排查和修复。

## 何时使用

- 用户反馈 `pagoda-cli` 命令找不到或依赖安装失败。
- 用户反馈构建时报错、类型声明文件未生成、样式编译失败。
- 用户反馈文档站启动后白屏、Demo 预览不显示、移动端模拟器不工作。
- 用户反馈发布 npm 包失败。
- 用户需要扩展 Vite 配置或修改别名。

## 常见问题与解决方案

### 1. 安装与依赖问题

**命令找不到？**
- 检查 Node.js 版本（需要 `^14.16.0` 或 `>=16.0.0`）。
- 尝试使用 `npx pagoda-cli` 运行。

**依赖安装失败？**
- 执行清理并重新安装：
  ```bash
  npm cache clean --force
  rm -rf node_modules package-lock.json
  npm install
  ```

### 2. 构建与编译问题

**类型声明文件 (`.d.ts`) 没有生成？**
- 确认项目根目录存在 `tsconfig.declaration.json`。
- 确认已安装 `vue-tsc` 依赖。
- 确认运行的是 `pagoda-cli build` 而不是 `pagoda-cli dev`。

**构建报错 "Cannot find module" 或样式编译失败？**
- 检查相对路径是否正确。
- 检查是否安装了对应的样式预处理器（`less` 或 `sass`）。

### 3. 文档站与 Demo 问题

**文档站页面空白？**
- 检查浏览器控制台报错。
- 确认项目下的 `site/desktop/views/` 目录是否存在。

**组件文档或 Demo 预览不显示/无法渲染/报错？**
- 检查组件是否已全局注册。**必须**在对应的项目入口文件中全局注册该组件：
  - 桌面端文档：检查并修改 `site/desktop/index.js`
  - 移动端文档：检查并修改 `site/mobile/index.js`
  - 示例注册代码：
    ```javascript
    // 示例：site/desktop/index.js
    // 注意：这里的 'my-ui' 只是示例，请替换为你当前项目 package.json 中的 name 字段值。
    // CLI 会自动处理别名映射，所以你不需要写相对路径。
    import MyUI from 'my-ui';
    
    export default {
      install(app) {
        app.use(MyUI); // 完整引入
        // 或按需注册: app.component('my-component', MyComponent);
      }
    };
    ```
- 确认组件目录下有 `README.md`。
- 确认 Demo 组件放在组件的 `demo/` 子目录下。
- 确认 Markdown 中 `:::demo-preview` 语法内引用的 Demo 名称不带 `.vue` 后缀。

### 4. 配置文件扩展 (Vite 配置)

**如何扩展 Vite 配置或配置路径别名？**
在根目录下的 `pagoda.config.mjs` 中进行配置：

```javascript
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  build: {
    vite: {
      configure(config) {
        // 修改组件库的构建配置
        config.resolve = config.resolve || {};
        config.resolve.alias = {
          ...config.resolve.alias,
          '@': '/src',
        };
        return config;
      },
    },
  },
  site: {
    build: {
      vite: {
        configure(config) {
          // 修改文档站的构建配置
          return config;
        },
      },
    }
  }
});
```

### 5. 发布问题

**发布失败，提示未登录或私有仓库错误？**
- 执行 `npm login`。
- 如果是私有仓库，在 `package.json` 中配置：
  ```json
  {
    "publishConfig": {
      "registry": "https://npm.your-company.com/"
    }
  }
  ```
