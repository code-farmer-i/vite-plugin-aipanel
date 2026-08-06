---
name: publish-styles
description: "当用户需要配置组件库的样式预处理器（Less/Sass）、设置基础样式（Base CSS）、处理样式依赖顺序或配置 PostCSS 时使用。"
---

# 样式处理与构建

Pagoda CLI 提供了完善的样式处理流水线，支持多种 CSS 预处理器，自动分析组件的样式依赖，并为按需加载生成对应的入口文件。

## 适用场景

- 切换项目使用的样式预处理器（从默认的 Less 切换到 Sass 或纯 CSS）。
- 需要为组件库配置全局基础样式（如重置样式、公共变量、Mixins）。
- 使用了第三方组件库（如 Element Plus / Vant）并需要配置其样式解析规则。
- 需要自定义 PostCSS 插件（如 Autoprefixer 或 CSS 变量转换）。

## 核心配置与用法

### 1. 配置预处理器

CLI 默认使用 Less 作为预处理器。如果需要更改为 Sass/SCSS 或纯 CSS，请在 `pagoda.config.mjs` 中配置：

```javascript
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  build: {
    css: {
      preprocessor: 'scss', // 可选值: 'less' | 'scss' | 'sass' | 'css'
    },
  },
});
```

### 2. 配置基础样式 (Base Style)

基础样式（如 `reset.css`、公共变量）会被自动注入到构建产物中。默认查找路径为 `style/base.{less|scss|css}`。你可以自定义该路径：

```javascript
export default defineConfig({
  build: {
    css: {
      base: 'style/common/base.less', // 相对 src 目录的路径
    },
  },
});
```

**基础样式文件结构示例：**

```less
// src/style/common/base.less
@import './variables.less';
@import './mixins.less';
@import './reset.less';
```

### 3. 自定义 PostCSS

CLI 内置了基础的 PostCSS 配置（含浏览器前缀自动补全）。如果需要自定义，在项目根目录创建 `postcss.config.js`：

```javascript
// postcss.config.js
module.exports = {
  plugins: {
    autoprefixer: {
      overrideBrowserslist: ['> 1%', 'last 2 versions', 'not dead'],
    },
    // 可添加其他插件，如 tailwindcss 等
  },
};
```

## 构建产物与样式依赖

在组件库模式下运行 `pagoda-cli build` 后，样式会被编译并提取：

1. **原始与编译产物**：每个组件目录下会保留编译后的 `.css` 和原始的 `.less/.scss`。
2. **样式入口**：在 `lib/index.css` 或 `lib/index.less` 生成全量样式入口。
3. **样式依赖映射**：CLI 会自动分析组件间的引用关系，并生成 `dist/my-lib.style-deps.json`。这确保了在按需加载（如配合 `unplugin-vue-components`）时，样式的加载顺序是正确的。

**样式依赖映射 JSON 结构示例：**

```json
// dist/my-lib.style-deps.json
{
  "map": {
    "Button": ["base", "icon"],
    "Input": ["base", "icon"],
    "Select": ["base", "icon", "Input", "Button"]
  },
  "sequence": ["base", "icon", "Button", "Input", "Select"]
}
```

`map` 字段记录每个组件的样式依赖，`sequence` 字段则按正确加载顺序列出所有依赖模块。构建工具插件会根据此映射确保样式加载顺序正确。

### 按需加载与第三方组件库样式

如果你的组件库基于其他 UI 库（如 Element Plus）二次封装，需要配置第三方样式解析器，以便在按需引入时正确加载底层样式：

```javascript
// pagoda.config.mjs
export default defineConfig({
  build: {
    thirdPartyComponents: {
      'element-plus': {
        styleResolver: {
          // 基础样式路径
          base: ({ esModule }) => `element-plus/${esModule ? 'es' : 'lib'}/components/base/style/css`,
          // 组件样式路径
          component: (name, { esModule }) => `element-plus/${esModule ? 'es' : 'lib'}/components/${name}/style/css`,
        },
      },
    },
  },
});
```

**Vant 组件库配置：**

```javascript
// pagoda.config.mjs
export default defineConfig({
  build: {
    thirdPartyComponents: {
      'vant': {
        styleResolver: {
          base: () => 'vant/lib/index.css',
          component: (name) => `vant/lib/${name}/style`,
        },
      },
    },
  },
});
```

## 最佳实践与注意事项

1. **共享样式变量**：在 Vue SFC 中，如果需要使用 Less/Sass 变量，建议在组件内的 `<style>` 中显式 `@import` 你的变量文件，不要依赖全局注入以保持模块独立性。
   ```vue
   <style lang="less">
   @import '@/style/variables.less';
   .my-btn { color: @primary-color; }
   </style>
   ```
2. **样式隔离**：强烈建议在组件开发中使用 `<style scoped>` 或 `<style module>` 防止样式污染。

   **CSS Modules 用法**：使用 `<style module>` 后，类名会通过 `$style` 对象访问：
   ```vue
   <template>
     <button :class="$style.button">
       <slot />
     </button>
   </template>

   <style module>
   .button {
     color: red;
   }
   </style>
   ```

3. **移除源文件优化**：如果你不希望在最终产物中保留原始的 `.less/.scss` 文件，可配置 `css.removeSourceFile: true`。

## babel-plugin-import 按需加载

配合 `babel-plugin-import` 实现样式按需加载：

```javascript
// babel.config.js
module.exports = {
  plugins: [
    [
      'import',
      {
        libraryName: 'my-component-library',
        libraryDirectory: 'es',
        style: true,  // 自动加载对应组件的样式文件
      },
    ],
  ],
};
```

## 常见问题

### Q: 如何处理全局样式？

A: 在 `site/desktop/style.js`（或 `site/mobile/style.js`）中导入全局样式文件：

```js
// site/desktop/style.js
import './style/global.scss';
```

此文件中的样式会应用到整个文档站。

### Q: CSS 加载顺序不正确？

A: 使用 CLI 自动生成的样式依赖映射（`dist/my-lib.style-deps.json`）确保正确的加载顺序。CLI 会自动分析组件间的样式依赖关系，按需加载插件会根据此映射按 `sequence` 顺序加载样式。
