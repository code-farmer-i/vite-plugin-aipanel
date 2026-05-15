---
name: publish-modes-formats
description: "当用户需要决定项目的构建模式（组件库模式 vs 类库模式），配置全局初始化逻辑（`setup.ts`），或了解 ESM、CJS、UMD 产物格式及对应的 `package.json` 配置时使用。"
---

# 构建模式与产物格式

Pagoda CLI 提供了灵活的构建体系，支持针对不同类型项目选择对应的构建模式，并自动输出标准的多种模块格式产物。

## 构建模式 (Build Modes)

CLI 提供两种构建模式：`components`（组件库模式，默认）和 `lib`（类库模式）。

### 1. 组件库模式 (components)

**适用场景**：开发 Vue 3 组件库。

```javascript
// pagoda.config.mjs
export default defineConfig({
  build: { mode: 'components' }, // 默认即为 components
});
```

**核心特性**：
- 自动扫描 `src/` 目录，生成组件的注册入口（包含 `install` 方法）。
- 自动处理和提取组件的 CSS/Less/Sass 样式。
- 解析 Markdown 生成用于 IDE 提示的 `web-types.json`。

**全局初始化逻辑 (`setup.ts`)**：
如果组件库在被 `app.use()` 注册时需要执行全局逻辑（如注册全局属性、提供配置），或者需要额外导出工具函数，可以在 `src/setup.ts`（或 `src/setup/index.ts`）中定义：

```typescript
// src/setup.ts
export * from './helper/utils'; // 额外导出的辅助函数

export default {
  install(app, options) {
    // 注册全局属性或指令
    app.config.globalProperties.$myConfig = options;
  },
};
```
CLI 会自动将此逻辑集成到最终生成的入口文件中。

### 2. 类库模式 (lib)

**适用场景**：开发纯 JavaScript/TypeScript 工具库、SDK，不需要组件注册和样式处理。

```javascript
// pagoda.config.mjs
export default defineConfig({
  build: { mode: 'lib' },
});
```

**核心特性**：
- 跳过 Vue 组件入口生成、样式处理和 Web Types 生成。

## 产物格式 (Output Formats)

构建完成后，产物会输出到 `es/` 和 `lib/` 目录，涵盖三种格式：

1. **ESM (ES Module)**：输出在 `es/`，支持 Tree Shaking，供 Vite/Webpack 等现代打包工具使用。
2. **CJS (CommonJS)**：输出在 `lib/`，供 Node.js 或旧版打包工具使用。
3. **UMD**：输出在 `lib/my-lib.min.js`，挂载到全局变量，供 `<script>` 标签和 CDN 直接引入。

### UMD 全局变量配置

如果需要支持 UMD 引入，必须配置库的名称，CLI 会将其转换为 PascalCase 作为全局变量名：

```javascript
export default defineConfig({
  name: 'my-awesome-lib', // UMD 全局变量将为 window.MyAwesomeLib
});
```

如果不需要 UMD 产物以加快构建速度，可以禁用：

```javascript
export default defineConfig({
  build: { umd: false },
});
```

## 最佳实践：配置 package.json

为了让使用者的打包工具能够正确识别不同的产物格式，必须在 `package.json` 中配置 `exports`、`main` 和 `module` 字段。

**组件库标准的 package.json 示例**：

```json
{
  "name": "my-component-library",
  "version": "1.0.0",
  "main": "lib/index.js",
  "module": "es/index.js",
  "types": "es/index.d.ts",
  "unpkg": "lib/my-component-library.min.js",
  "jsdelivr": "lib/my-component-library.min.js",
  "files": [
    "es",
    "lib"
  ],
  "exports": {
    ".": {
      "types": "./es/index.d.ts",
      "import": "./es/index.js",
      "require": "./lib/index.js"
    },
    "./*": "./*",
    "./es/*": "./es/*",
    "./lib/*": "./lib/*",
    "./style.css": "./lib/index.css"
  },
  "sideEffects": [
    "**/*.css",
    "**/*.vue"
  ]
}
```

> **注意**：`sideEffects` 字段非常重要，必须包含 CSS 文件，否则在使用 Webpack 生产构建时，样式文件可能会被 Tree Shaking 错误地丢弃。
