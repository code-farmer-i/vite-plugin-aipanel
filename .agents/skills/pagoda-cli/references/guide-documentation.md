---
name: guide-documentation
description: "当用户要求为 Vue 组件编写 Markdown 文档、添加代码演示 (Demo) 或定义 API 表格时使用。提供 Pagoda CLI 专属的 Markdown 扩展语法规范和文档结构示例。"
---

# 组件文档编写指南

当用户要求为组件编写说明文档、添加可交互的 Demo 或定义 API 表格时，请遵循本指南使用 Pagoda CLI 的 Markdown 扩展语法。

## 何时使用

- 用户要求为一个新的或现有的组件编写 `README.md` 文档。
- 用户要求在 Markdown 文档中添加 Vue 组件的代码演示 (Demo)。
- 用户要求在文档中声明 Props、Events、Slots 的 API 表格。

## 核心规范与执行步骤

### 1. 文档结构规范

**为什么这么做？** 标准化的结构让用户阅读体验一致。

一个标准的组件文档（例如 `src/button/README.md`）必须包含：
1. **标题与描述**: 简要说明组件用途。
2. **代码演示 (Demo)**: 展示各种用法。
3. **API 参考**: 列出 Props、Events、Slots 等。

### 2. 编写交互式 Demo（重点）

**为什么这么做？** Pagoda CLI 提供了特殊的容器语法，能将 `.vue` 文件渲染为真实的交互式 Demo 并附带源码展示。

:::warning 组件全局注册提醒
在文档或 Demo 中演示组件之前，**必须**确保该组件已经被全局注册。请在项目对应的 `site/desktop/index.js` 或 `site/mobile/index.js` 文件中引入并全局注册你的组件（该文件可选，如不存在可自行创建），否则在文档渲染时将无法被识别和渲染。
:::

你需要在 `site/desktop/index.js`（或 `site/mobile/index.js`）文件中导出一个包含 `install` 方法的对象，在该方法中通过传入的 Vue `app` 实例进行注册：

:::tip 💡 提示
CLI 在启动文档站时，会自动将你项目 `package.json` 中的 `name` 字段作为别名映射到本地的源码入口。具体映射规则如下：

- `包名` → 源码入口文件
- `包名/es` → `src/` 目录
- `包名/lib` → `src/` 目录
- `包名.scss` → 样式入口文件

因此，你在这里可以像普通用户一样，直接通过你的包名来引入组件，而不需要使用相对路径（如 `../../src`）。
:::

```javascript
// site/desktop/index.js 或 site/mobile/index.js

// 这里的 'my-ui' 只是示例。
// 请替换为你当前项目 package.json 中的 name 字段值（例如 '@my-org/components'）
import MyUI from 'my-ui'; 

export default {
  install(app) {
    // 方式一：如果组件本身有 install 方法（如完整的 UI 库）
    app.use(MyUI);
    
    // 方式二：直接注册单个组件
    // 同样，这里的包名也要替换为你自己的
    // import MyComponent from 'my-ui/es/my-component';
    // app.component('my-component', MyComponent);
  }
};
```
:::

**步骤 1：创建独立的 Demo 文件**
必须在组件的 `demo/` 目录下创建 `.vue` 文件。

```vue
<!-- src/button/demo/basic.vue -->
<template>
  <pd-button type="primary">主要按钮</pd-button>
</template>
```

**步骤 2：在 Markdown 中使用扩展语法引入**
使用 `::::demo` 和 `:::demo-preview` 语法引入该 Demo。

```markdown
::::demo

### 基础用法

这是按钮的基础用法说明。

:::demo-preview

basic

:::

::::
```
*注意：*
*- `:::demo-preview` 内部写的是 demo 文件名，不要带 `.vue` 后缀。*
*- 根据站点的 `demoPreview` 配置，它会将对应的代码渲染为真实的 Vue 组件并提供代码查看/折叠功能（`preview` 模式），或者仅展示代码面板（`codeOnly` 模式，通常配合右侧移动端模拟器使用）。*

**默认行为**：如果未配置 `demoPreview`，系统会根据 `showSimulator` 配置自动推断：
- 启用 `showSimulator` 时，默认使用 `'codeOnly'` 模式
- 未启用 `showSimulator` 时，默认使用 `'preview'` 模式

### 3. 编写 API 表格

**为什么这么做？** Pagoda CLI 会自动解析文档中的表格来生成组件的 Web Types，为 IDE 提供自动提示。

**规则：**
- 必须使用三级标题（如 `### Props`）。
- 联合类型中的管道符 `|` 必须使用反斜杠 `\|` 转义，否则会破坏 Markdown 表格。

**可执行示例：**

```markdown
### Props

| 属性名 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| type | 按钮类型 | `'default' \| 'primary'` | `'default'` |

### Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| click | 点击触发 | `(event: MouseEvent)` |

### Slots

| 插槽名 | 说明 | 作用域参数 |
| --- | --- | --- |
| default | 默认内容 | - |
```

### 4. 使用内置提示块

在需要强调某些内容时，使用内置的 Container 语法。

```markdown
:::tip 提示
这是一个提示信息。
:::

:::warning 注意
这是一个警告信息。
:::

:::danger 危险
这是一个危险操作提示。
:::
```

### 5. 文档内部跳转

如果在文档中需要跳转到其他文档，使用 `<PagodaDocLinkToView>` 组件，避免整页刷新。

```html
请参考 <PagodaDocLinkToView view="development/guide/component">组件开发规范</PagodaDocLinkToView> 了解更多。
```
