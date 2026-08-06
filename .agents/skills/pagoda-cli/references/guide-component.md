---
name: guide-component
description: "当用户要求开发 Vue 3 组件、新建组件、或询问组件目录结构、开发规范、样式处理、组合式函数、全局配置（setup.ts）时使用。提供完整的 Vue 组件开发规范和最佳实践。"
---

# Vue 组件开发规范

当用户要求创建或修改 Vue 3 组件时，请遵循本指南中的目录结构和开发规范。

## 何时使用

- 用户要求新建一个 Vue 组件
- 用户询问组件目录结构、入口文件规范
- 用户想了解样式开发、组合式函数、工具函数的组织方式
- 用户需要配置全局安装逻辑（setup.ts）

## 核心规范与执行步骤

### 1. 组件目录结构（重点）

**为什么这么做？** 标准化的目录结构让 CLI 能自动识别组件，生成入口文件、样式映射和 Web Types。

每个组件必须遵循以下结构：

```
src/
└── button/
    ├── src/                  # 组件源码
    │   ├── button.vue        # 组件实现
    │   └── button.ts         # 类型定义（可选）
    ├── __tests__/            # 单元测试（可选）
    ├── demo/                 # Demo 示例
    │   ├── basic.vue
    │   └── disabled.vue
    ├── index.ts              # 组件入口（必填）
    └── README.md             # 组件文档
```

### 2. 组件入口文件（必填）

**为什么这么做？** CLI 通过扫描 `src/` 下所有组件的 `index.ts` 来自动生成组件库总入口。每个组件的入口文件必须包含 `install` 方法。

**可执行示例 (`src/button/index.ts`)：**

```ts
import Button from './src/button.vue';
import type { App } from 'vue';

Button.install = (app: App) => {
  app.component(Button.name || 'my-button', Button);
};

export default Button;
```

### 3. 组件实现模板

**可执行示例 (`src/button/src/button.vue`)：**

```vue
<template>
  <button
    class="my-button"
    :class="[`my-button--${type}`, `my-button--${size}`]"
    :disabled="disabled"
    @click="handleClick"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineOptions({
  name: 'MyButton',
});

const props = withDefaults(
  defineProps<{
    type?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
    size?: 'small' | 'medium' | 'large';
    disabled?: boolean;
    loading?: boolean;
  }>(),
  {
    type: 'default',
    size: 'medium',
    disabled: false,
    loading: false,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const handleClick = (event: MouseEvent) => {
  if (props.disabled || props.loading) return;
  emit('click', event);
};
</script>
```

### 4. 样式开发规范

Pagoda CLI 默认使用 Less，可通过 `build.css.preprocessor` 切换为 SCSS。

**基础样式配置：**
```js
// pagoda.config.mjs
export default defineConfig({
  build: {
    css: {
      preprocessor: 'less',
      base: 'style/common/base.less', // 全局变量/混入，自动注入每个组件
    },
  },
});
```

**基础样式文件示例 (`src/style/common/base.less`)：**
```less
@import './variables.less';
@import './mixins.less';
```

### 5. 组合式函数 (Composables)

可复用的逻辑封装在 `src/composables/` 目录下：

```ts
// src/composables/useClickOutside.ts
import { onMounted, onUnmounted, type Ref } from 'vue';

export function useClickOutside(target: Ref<HTMLElement | null>, callback: () => void) {
  const handleClick = (event: MouseEvent) => {
    if (target.value && !target.value.contains(event.target as Node)) {
      callback();
    }
  };
  onMounted(() => document.addEventListener('click', handleClick));
  onUnmounted(() => document.removeEventListener('click', handleClick));
}
```

### 6. 全局安装配置 (setup.ts)

**为什么这么做？** 如果你需要在 `app.use(MyLib)` 时执行全局逻辑（如注册全局属性、provide 数据、额外导出），可以在 `src/` 下创建 `setup.ts`。CLI 构建时会自动合并该文件的内容到库入口。

**可执行示例 (`src/setup.ts`)：**

```ts
// 1. 导出额外的公共 API（会被合并到库入口）
export * from './composables/useClickOutside';
export const version = '1.0.0';

// 2. 默认导出 install 配置
export default {
  install(app, options) {
    app.config.globalProperties.$myLib = options;
    app.provide('config', options);
  },
};
```

### 7. 标签前缀配置

通过 `tagPrefix` 统一组件标签前缀：

```js
// pagoda.config.mjs
export default defineConfig({
  build: {
    tagPrefix: 'my', // 组件标签变为 <my-button>
  },
});
```

### 8. 组件命名建议

- 文件名使用 PascalCase（如 `MyButton.vue`）
- 目录名使用 kebab-case（如 `button/`、`base-select/`）
- 标签名使用 kebab-case（如 `<my-button>`）

## 相关文档

- 文档编写与 Demo 语法 → `guide-documentation`
- 纯 JS/TS 库开发 → `guide-js-library`
- TypeScript 类型声明生成 → `advanced-typescript-ide`
- IDE 组件智能提示 (Web Types) → `advanced-web-types`
