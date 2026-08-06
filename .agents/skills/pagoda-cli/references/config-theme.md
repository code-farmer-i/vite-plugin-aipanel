---
name: config-theme
description: "提供文档站 CSS 变量和主题定制指南。当用户需要修改文档站主色调、文本颜色或覆盖代码高亮样式时调用此 skill。"
---

# 主题定制 (Theme)

Pagoda CLI 文档站大量使用了 CSS 变量（Custom Properties）来定义样式。你可以通过覆盖这些变量来深度定制文档站的视觉效果。

## Usage

当用户要求修改文档站的品牌色（如绿色改为蓝色）、调整侧边栏宽度或定制代码块背景色时，请指导他们修改或覆盖 CSS 变量。

### 1. 修改主色调及内置变量

最常见的定制是修改主色调 `--pd-doc-primary-base`。默认情况下，你只需要覆盖这个基础色变量，其余相关的颜色（如各亮/暗阶梯颜色）会自动通过 CSS `color-mix()` 计算。建议在 `site/desktop/style/css-vars.scss` 或自定义样式入口中进行覆盖：

```css
:root {
  /* 修改主品牌色为蓝色 */
  --pd-doc-primary-base: #409eff;
  
  /* 只有在必要时才需要手动覆盖以下变量 */
  /* --pd-doc-primary: var(--pd-doc-primary-base); */
  /* --pd-doc-white: #fff; */
  /* --pd-doc-black: #000; */
  
  /* 亮/暗阶梯颜色会通过 CSS color-mix() 自动计算，无需手动覆盖：
     例如：--pd-doc-primary-light-1: color-mix(in srgb, var(--pd-doc-white) 10%, var(--pd-doc-primary));
  */
  
  /* 文字与边框颜色（按需覆盖） */
  /* --pd-doc-text-color: #303133; */
  /* --pd-doc-border-color: #ebeef5; */
}
```

### 2. 定制导航栏与布局尺寸

如果默认的布局尺寸或导航栏不符合需求：

```css
:root {
  /* 导航栏配置 */
  --pd-doc-header-height: 60px;
  --pd-doc-header-title-color: #333;
  --pd-doc-header-bg-color: rgba(255, 255, 255, 0.7);
  --pd-doc-header-divider-color: #bbb;
  --pd-doc-header-shadow-color: #e8ebf0;
  --pd-doc-nav-active-bg-color: var(--pd-doc-primary-light-10);
  
  /* 侧边栏与目录 (TOC) */
  --pd-doc-sidebar-width: 240px;
  --pd-doc-toc-width: 180px;
  --pd-doc-toc-border-color: #f4f6f7;
  
  /* 最大屏幕宽度控制 */
  --pd-doc-screen-max-width: 2130px;
  --pd-doc-screen-padding: 5vw;
  --pd-doc-screen-padding-right: var(--pd-doc-screen-padding);
  
  /* 右侧区域 */
  --pd-doc-right-sidebar-width: 160px;
  
  /* 移动端模拟器尺寸 */
  --pd-doc-simulator-width: 360px;
  --pd-doc-simulator-top-bottom-margin: 30px;
  --pd-doc-simulator-right-margin: 30px;
  --pd-doc-simulator-shadow: 0 8px 12px #ebedf0;
}
```

### 3. 定制 Markdown 内容区与代码块

可以独立定制 Markdown 渲染出的各级标题、表格、提示框以及代码块配色：

```css
:root {
  /* 标题颜色 */
  --pd-doc-md-h1-color: #1f2f3d;
  --pd-doc-md-h2-color: #323233;
  --pd-doc-md-h3-color: #323233;
  --pd-doc-md-h4-color: #323233;
  --pd-doc-md-h5-color: #323233;

  /* 表格 */
  --pd-doc-md-table-border-color: var(--pd-doc-border-color);
  --pd-doc-md-table-first-child-code-color: var(--pd-doc-primary);
  --pd-doc-md-table-first-child-code-bg-color: var(--pd-doc-primary-light-9);
  
  /* 标签与代码块 */
  --pd-doc-md-code-tag-bg-color: #f0f2f5;
  --pd-doc-md-code-tag-text-color: #455a64;
  --pd-doc-md-code-block-bg-color: #fafafa;
  --pd-doc-md-code-block-text-color: #455a64;
  --pd-doc-md-code-block-border-color: #eaeefb;
  --pd-doc-md-code-block-border-radius: 8px;
  
  /* 引用与提示框 (Tip & Warning) */
  --pd-doc-md-blockquote-bg-color: #f6f6f7;
  --pd-doc-md-alert-tip-bg-color: var(--pd-doc-primary-light-10);
  --pd-doc-md-alert-tip-text-color: var(--pd-doc-text-color);
  --pd-doc-md-alert-tip-code-bg-color: var(--pd-doc-primary-light-9);
  --pd-doc-md-alert-tip-code-text-color: var(--pd-doc-primary);
  --pd-doc-md-alert-warning-bg-color: #fff9e6;
  --pd-doc-md-alert-warning-text-color: var(--pd-doc-text-color);
  --pd-doc-md-alert-warning-code-bg-color: #fdf0ce;
  --pd-doc-md-alert-warning-code-text-color: #d19a3b;

  /* 二维码 */
  --pd-doc-md-qrcode-color: var(--pd-doc-dark-grey);
  --pd-doc-md-qrcode-desc-color: var(--pd-doc-dark-grey);

  /* 代码语法高亮 */
  --pd-doc-code-keyword-text-color: #c678dd;
  --pd-doc-code-string-text-color: #98c379;
  --pd-doc-code-number-text-color: #d19a66;
}
```

### 4. 定制内置组件 (Demo 预览 & API 表格)

对 Pagoda CLI 提供的专用组件进行样式覆盖：

```css
:root {
  /* Demo 预览框 */
  --pd-doc-demo-preview-border-color: #ebebeb;
  --pd-doc-demo-preview-control-text-color: #ccc;
  --pd-doc-demo-preview-control-hover-bg-color: #f9fafc;

  /* API 参数表格 */
  --pd-doc-api-params-color: #a7419e;
}
```

### 5. 定制暗黑模式

如需启用暗黑模式并在深色主题下自定义样式，可以配置 `pagoda.config.mjs` 并定义 `.dark` 作用域的变量：

```js
// pagoda.config.mjs
export default defineConfig({
  site: {
    layout: {
      darkMode: true, // 开启暗黑模式切换按钮
    },
  },
});
```

```scss
// site/desktop/style/css-vars.scss
:root.dark {
  /* 可以在这里覆盖深色模式下的变量，默认情况下不需要手动覆盖 */
}
```

### 6. 引入自定义样式

确保将覆盖了 CSS 变量的文件引入到文档站的样式中（支持 `.scss`, `.less`, `.css` 等）：

```javascript
// site/desktop/style.js
import './style/css-vars.scss';   // 或 import './styles/var.less';
import './style/index.scss';      // 引入其它自定义样式
```
