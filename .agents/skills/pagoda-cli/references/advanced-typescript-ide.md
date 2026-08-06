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

### 0. 基础 tsconfig.json

项目根目录的 `tsconfig.json` 应包含以下核心配置：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ESNext", "DOM"],
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue"],
  "exclude": ["node_modules", "dist", "es", "lib"]
}
```

**关键字段说明：**
- `target: "ESNext"` 与 `module: "ESNext"` 保证输出最新的 ES 语法
- `moduleResolution: "bundler"` 适配现代打包器（Vite/esbuild）的模块解析
- `paths` 别名 `"@/*": ["./src/*"]` 允许在项目中使用 `@/Button` 导入组件
- `noEmit: true` 表示 tsconfig 仅用于类型检查，不输出编译产物

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
  props: ButtonProps;
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

## 类型工具

### ExtractPropTypes —— 从运行时 Props 提取类型

当使用运行时 props 定义（选项式 API）时，用 `ExtractPropTypes` 提取类型供使用者引用：

```typescript
import { ExtractPropTypes, PropType } from 'vue';

const buttonProps = {
  type: {
    type: String as PropType<'default' | 'primary' | 'success'>,
    default: 'default',
  },
  disabled: Boolean,
} as const;

// 提取出的 ButtonProps 类型为 { type?: 'default' | 'primary' | 'success'; disabled?: boolean }
export type ButtonProps = ExtractPropTypes<typeof buttonProps>;
```

### InstanceType —— 获取组件实例类型

从组件本身推导实例类型，包含 expose 的方法和属性：

```typescript
import Button from './Button.vue';

export type ButtonInstance = InstanceType<typeof Button>;
```

## 全局类型声明的两种模式

除了 `GlobalComponents` 声明外，还可以通过 `declare module` 为组件库提供全局类型兜底：

**模式 1：主入口声明**

```typescript
// src/global.d.ts
declare module 'my-component-library' {
  import type { DefineComponent } from 'vue';
  
  export const Button: DefineComponent;
  export const Input: DefineComponent;
}
```

**模式 2：按路径导入声明（支持 tree-shaking）**

```typescript
declare module 'my-component-library/es/*' {
  import type { DefineComponent } from 'vue';
  export default DefineComponent;
}
```

这两种模式配合使用，确保使用者无论是 `import { Button } from 'my-component-library'` 还是 `import Button from 'my-component-library/es/Button'` 都能获得类型支持。

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
