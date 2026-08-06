---
name: advanced-typescript-ide
description: "当用户需要在组件库项目中配置或解决 TypeScript 相关的类型推导、类型声明（`.d.ts`）自动生成，以及完善 IDE 类型提示时使用。"
---

# TypeScript 支持与 IDE 提示

Pagoda CLI 提供开箱即用的 TypeScript 支持。为了确保组件库的使用者在 IDE 中获得良好的类型提示，你需要正确配置类型声明的生成和导出机制。

## 适用场景

- 需要在 `pagoda-cli build` 构建产物中包含 `.d.ts` 类型声明文件。
- 需要规范化导出 Vue 组件的 Props 类型和实例类型供使用者引用。
- 使用者反馈在使用组件库时，IDE 无法正确推导组件类型。

## 核心配置与用法

### 1. 开启自动生成声明文件

默认情况下，构建过程可能会跳过类型声明的生成。必须在项目根目录创建 `tsconfig.declaration.json`，CLI 会自动检测该文件并生成 `es/*.d.ts`。

```json
// tsconfig.declaration.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "./es",
    "declarationMap": true
  },
  "include": ["src"]
}
```

> **注意**：必须确保项目中已安装 `vue-tsc` 依赖，CLI 底层依赖它来生成 Vue 组件的声明。

### 2. 规范组件类型的定义与导出

为了让使用者能够方便地导入组件相关的类型（如 `ButtonProps`），建议在组件入口文件中显式导出：

```vue
<!-- src/Button/index.vue -->
<script setup lang="ts">
import type { ButtonProps } from './types';

const props = withDefaults(defineProps<ButtonProps>(), {
  type: 'default',
  size: 'medium',
  disabled: false,
});
</script>
```

```typescript
// src/Button/types.ts
export interface ButtonProps {
  type?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
}

export interface ButtonInstance {
  focus: () => void;
  blur: () => void;
}
```

```typescript
// src/Button/index.ts
import Button from './index.vue';
import type { ButtonProps, ButtonInstance } from './types';

// 显式导出组件及其类型
export { Button, type ButtonProps, type ButtonInstance };
export default Button;
```

### 3. 配置 package.json 的类型入口

在 `package.json` 中配置 `types` 和 `exports` 字段，以确保 TypeScript 和 IDE 能够正确找到入口声明文件。

```json
{
  "name": "my-component-library",
  "version": "1.0.0",
  "main": "lib/index.js",
  "module": "es/index.js",
  "types": "es/index.d.ts",
  "exports": {
    ".": {
      "types": "./es/index.d.ts",
      "import": "./es/index.js",
      "require": "./lib/index.js"
    },
    "./*": "./*"
  },
  "files": [
    "es",
    "lib"
  ]
}
```

## 最佳实践与全局类型支持

### 提供全局组件类型 (Global Components)

对于支持全局注册（`app.use(MyLibrary)`）的组件库，为了在 Vue 模板中获得全局组件的类型提示，建议在项目中提供 `global.d.ts`：

```typescript
// src/global.d.ts
declare module 'vue' {
  // Vue 3 全局组件类型声明规范
  export interface GlobalComponents {
    MyButton: typeof import('my-component-library')['Button'];
    MyInput: typeof import('my-component-library')['Input'];
  }
}

export {};
```

使用者可以在其项目的 `tsconfig.json` 中包含此文件，从而获得完整的模板类型支持。

## 常见排错指南

1. **类型声明未生成**
   - 检查根目录是否存在 `tsconfig.declaration.json`。
   - 检查 `vue-tsc` 是否安装并可正常运行。
2. **Vue 组件导入报类型错误**
   - 确保存在对 `.vue` 文件的环境声明（通常在 `env.d.ts` 中）：
     ```typescript
     declare module '*.vue' {
       import type { DefineComponent } from 'vue';
       const component: DefineComponent<{}, {}, any>;
       export default component;
     }
     ```
