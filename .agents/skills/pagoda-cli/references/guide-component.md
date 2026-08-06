---
name: guide-component
description: "当用户要求创建、修改或重构 Vue 3 组件时使用。提供组件目录结构、命名规范、Props/Events 声明方式以及样式隔离的具体步骤与可执行代码示例。"
---

# Vue 3 组件开发指南

:::tip 💡 提示
本指南推荐使用 Vue 3 Composition API（`<script setup>`）编写组件，这是 Vue 3 的推荐写法，具有更好的类型推断和代码组织能力。
:::

当用户要求创建或修改 Vue 3 组件时，请严格按照本指南提供的规范进行代码编写和文件组织。本指南旨在确保组件库代码风格统一，且能自动生成高质量的 API 文档。

## 何时使用

- 用户要求创建一个新的 Vue 3 组件。
- 用户要求为一个已有的组件添加新的 Props、Events 或 Slots。
- 用户要求重构组件样式以支持主题定制（CSS 变量）。

## 核心规范与执行步骤

### 1. 目录与文件生成

**为什么这么做？** 统一的目录结构有助于 CLI 自动发现组件并生成路由，同时方便开发者维护和查阅。

创建一个新组件时，必须生成以下基础文件，目录名统一使用 `kebab-case`：

```text
src/{component-name}/
├── index.vue         # 组件核心逻辑与模板
├── index.ts          # 组件导出入口
└── README.md         # 组件 API 文档与 Demo 演示
```

### 2. 组件命名与基础结构

**为什么这么做？** 显式声明带有项目前缀（如 `my-` 等）的 `kebab-case` 名称，能避免与原生 HTML 标签或其他组件库发生冲突。

**可执行示例 (`src/base-select/index.vue`)：**

```vue
<script setup lang="ts">
defineOptions({
  name: 'my-base-select', // 必须：注册名为带前缀的 kebab-case
});

// 此处编写组件逻辑...
</script>

<template>
  <div class="my-base-select">
    <!-- 组件模板 -->
  </div>
</template>

<style scoped>
/* 此处编写样式... */
</style>
```

### 3. Props 与 Events 的声明（重点）

**为什么这么做？** 必须使用带有完整 TypeScript 类型和 JSDoc 注释的语法声明 Props。Pagoda CLI 等工具会解析这些注释并自动生成 Web Types 和编辑器提示。

**规则：**
- **Props**: 在脚本中使用 `camelCase` 定义，外部模板中使用 `kebab-case` 传参。
- **Events**: 统一使用 `kebab-case` 命名事件。

**可执行示例：**

```vue
<script setup lang="ts">
import type { PropType } from 'vue';

/**
 * 必须包含 JSDoc 注释以生成文档说明
 * @description 组件尺寸
 * @default 'medium'
 */
const props = defineProps({
  size: {
    type: String as PropType<'small' | 'medium' | 'large'>,
    default: 'medium',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

// 事件名称使用 kebab-case
const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
  (e: 'size-change', size: 'small' | 'medium' | 'large'): void;
}>();

const handleChange = (val: string) => {
  if (!props.disabled) {
    emit('update:modelValue', val);
  }
};
</script>
```

### 4. 样式隔离与主题定制

**为什么这么做？** 组件库必须支持使用方的样式隔离和主题切换，不能污染全局样式。
- **隔离**：必须使用 `<style scoped>`。
- **命名**：必须遵循 BEM (Block Element Modifier) 规范。
- **定制**：必须提取 CSS 变量并提供合理的默认回退值（fallback）。

**可执行示例：**

```vue
<style scoped>
/* Block */
.pd-base-select {
  /* 使用 CSS 变量以支持外部主题定制，必须包含默认值 */
  padding: var(--pd-base-select-padding, 8px 16px);
  color: var(--pd-text-color, #333333);
  background-color: var(--pd-bg-color, #ffffff);
}

/* Element */
.pd-base-select__icon {
  font-size: var(--pd-icon-size, 14px);
}

/* Modifier */
.pd-base-select--disabled {
  opacity: var(--pd-disabled-opacity, 0.5);
  cursor: not-allowed;
}
</style>
```

### 5. 导出组件

**可执行示例 (`src/base-select/index.ts`)：**

```typescript
import BaseSelect from './index.vue';

export default BaseSelect;

// 推荐：如果有相关的 TypeScript 类型，也在此处一并导出供外部使用
// export type { BaseSelectProps } from './types'; 
```

### 6. 使用路径别名 (Alias)

Vite 配置中的 `~` 和 `@` 别名默认指向项目根目录下的 `src` 文件夹。如果你在 Vue 组件中需要引入 `src` 下的模块或样式，可以直接使用别名：

```vue
<script setup lang="ts">
// 引入 src/utils/helpers.ts
import { myHelper } from '@/utils/helpers';
// 或使用 ~
import { anotherHelper } from '~/utils/helpers';
</script>

<style scoped>
/* 引入 src/styles/mixins.scss */
@import '@/styles/mixins.scss';
</style>
```

## 边界情况与高级用法

- **复杂的类型定义**：如果 Props 极其复杂（如大量的接口定义），应该将其抽离到 `src/{component-name}/types.ts` 中，并通过 `PropType` 引入，而不是将巨大的类型直接写在 `defineProps` 中，这有助于保持 Vue SFC 的清晰度。
- **支持全局安装 (app.use)**：当前指南适用于单个组件的内部结构。如果用户要求该组件可作为独立的 Vue 插件被 `app.use()` 安装，需要在 `index.ts` 中为其挂载 `install` 方法：
  ```typescript
  import type { App } from 'vue';
  import BaseSelect from './index.vue';

  BaseSelect.install = (app: App) => {
    app.component(BaseSelect.name, BaseSelect);
  };

  export default BaseSelect;
  ```
