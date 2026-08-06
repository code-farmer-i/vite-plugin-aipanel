---
name: advanced-web-types
description: "当用户希望为 Vue 组件库生成供 WebStorm 和 VS Code 使用的智能提示（Web Types）文件时使用。介绍如何配置标签前缀以及通过规范 Markdown 表格自动提取组件 API。"
---

# Web Types 智能提示

Pagoda CLI 能够自动解析组件的 Markdown 文档中的 API 表格，生成标准的 `web-types.json` 文件。这能为组件库使用者在编写 Vue 模板时提供属性（Props）、事件（Events）和插槽（Slots）的 IDE 智能提示。

## 适用场景

- 需要在构建（`pagoda-cli build`）时自动生成 `web-types.json` 供使用者获得组件标签、属性及事件的自动补全。
- 使用者反馈在 WebStorm 或 VS Code (配合 Volar/Vue Official 插件) 中无法识别组件库的自定义标签。

## 核心配置与用法

### 1. 规范化编写 Markdown API 表格

CLI 提取 Web Types 元数据的唯一来源是组件目录下的 `README.md`。必须使用严格的 Markdown 标题和表格格式：

```markdown
<!-- src/Button/README.md -->
# Button 按钮

## API

<!-- 必须使用精确的标题名称：### Props, ### Events, ### Slots -->

### Props

| 参数 | 说明 | 类型 | 默认值 |
|------|------|------|--------|
| type | 按钮类型 | `'default' \| 'primary' \| 'success'` | `'default'` |
| disabled | 是否禁用 | `boolean` | `false` |

### Events

| 事件名 | 说明 | 回调参数 |
|--------|------|----------|
| click | 点击按钮时触发 | `(event: MouseEvent)` |

### Slots

| 插槽名 | 说明 |
|--------|------|
| default | 按钮内容 |
| icon | 图标插槽 |
```

> **关键规则**：表头前的标题必须严格匹配 `### Props`、`### Events` 或 `### Slots`。CLI 解析器依赖这些固定的标题来分类提取数据。

### 2. 配置组件标签前缀

在 `pagoda.config.mjs` 中配置 `build.tagPrefix`，这将决定在 IDE 中提示的组件标签名称（例如 `<my-button>`）。

```javascript
// pagoda.config.mjs
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  name: 'my-component-library',
  build: {
    // 自动为所有组件加上 `my-` 前缀用于模板提示
    tagPrefix: 'my', 
  },
});
```

### 3. 配置 package.json 以生效提示

运行 `pagoda-cli build` 后，生成的元数据文件会输出到 `lib/web-types.json`。必须在 `package.json` 中暴露此字段，IDE 才能自动识别：

```json
{
  "name": "my-component-library",
  "version": "1.0.0",
  "web-types": "lib/web-types.json"
}
```

## 注意事项与排错

1. **Web Types 没有生成或内容为空？**
   - 确认 `pagoda.config.mjs` 中正确配置了 `name` 和 `build.tagPrefix`。
   - 检查 Markdown 文件中的 API 标题是否为三级标题（如 `### Props`），并且拼写完全一致。
   - 检查 Markdown 表格格式是否合法。
2. **IDE 无法提示？**
   - 检查 `package.json` 中是否包含了 `"web-types": "lib/web-types.json"`。
   - 对于 WebStorm：通常在安装依赖后会自动识别。
   - 对于 VS Code：需要安装 Vue 官方扩展（Volar），它会自动读取项目依赖中的 `web-types` 配置。
