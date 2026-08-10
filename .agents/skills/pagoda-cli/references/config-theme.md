---
name: config-theme
description: "提供文档站 CSS 变量和主题定制指南。当用户需要修改文档站主色调、文本颜色、字号、间距、圆角、层级或代码高亮样式时调用此 skill。覆盖 100+ 个可定制变量。"
---

# 主题定制 (Theme)

Pagoda CLI 文档站采用三层 CSS 变量架构，提供 100+ 个可定制变量。你可以通过覆盖这些变量来深度定制文档站的视觉效果。

## 变量体系架构

```
common/style/css-vars.scss    ← 基础设计令牌（颜色、字号、间距、圆角、过渡、z-index）
        ↓ 引用
desktop/style/css-vars.scss   ← 桌面端专属变量（Markdown 排版、布局尺寸）
mobile/style/css-vars.scss    ← 移动端专属变量（移动排版、图标尺寸）
        ↓ 引用
markdow.scss / Vue 组件       ← 实际样式消费
```

## Usage

当用户要求修改文档站的品牌色、调整字号/间距比例尺、控制圆角或层级关系时，请指导他们覆盖对应层级的 CSS 变量。

### 1. 修改主色调

最常见的定制是修改主色调 `--pd-doc-primary`。覆盖这个基础色变量后，亮/暗阶梯颜色会通过 CSS `color-mix()` 自动计算。

```css
:root {
  /* 修改主品牌色为蓝色 */
  --pd-doc-primary-base: #409eff;
}
```

> **注意**：暗黑模式下 CLI 会自动降低主色饱和度：`color-mix(in srgb, var(--pd-doc-primary-base) 50%, white)`。如需在暗黑模式下使用不同主色，在 `:root.dark` 中覆盖 `--pd-doc-primary`。

---

### 2. 排版系统

#### 字号（7 级比例尺）

```css
:root {
  --pd-doc-font-size-xs: 11px;    /* 版本标签等极小文字 */
  --pd-doc-font-size-sm: 13px;    /* 表格、代码块 */
  --pd-doc-font-size-base: 14px;  /* 正文、h5 */
  --pd-doc-font-size-md: 16px;    /* h3、h4、Alert 标题 */
  --pd-doc-font-size-lg: 20px;    /* h2 */
  --pd-doc-font-size-xl: 22px;    /* Header 标题 */
  --pd-doc-font-size-xxl: 28px;   /* h1 */
}
```

#### 行高（6 级）

```css
:root {
  --pd-doc-line-height-tight: 20px;    /* 紧凑 */
  --pd-doc-line-height-base: 24px;     /* 正文、h4 */
  --pd-doc-line-height-relaxed: 28px;  /* p、h3 */
  --pd-doc-line-height-loose: 32px;    /* h2 */
  --pd-doc-line-height-xl: 40px;       /* h1 */
  --pd-doc-line-height-code: 1.7;      /* 代码块 */
}
```

#### 字重 / 字间距

```css
:root {
  --pd-doc-font-weight-normal: 400;
  --pd-doc-font-weight-medium: 500;
  --pd-doc-font-weight-semibold: 600;  /* 标题、表头 */
  --pd-doc-font-weight-bold: 700;

  --pd-doc-letter-spacing-tight: -0.02em;    /* h1、h2 */
  --pd-doc-letter-spacing-tighter: -0.015em; /* h3 */
  --pd-doc-letter-spacing-normal: 0;
}
```

---

### 3. 间距比例尺（10 级）

所有 Markdown 元素和组件的间距均引用此比例尺，修改一处即可全局生效：

```css
:root {
  --pd-doc-space-1: 2px;
  --pd-doc-space-2: 4px;
  --pd-doc-space-3: 8px;
  --pd-doc-space-4: 12px;
  --pd-doc-space-5: 16px;
  --pd-doc-space-6: 20px;
  --pd-doc-space-7: 24px;
  --pd-doc-space-8: 32px;
  --pd-doc-space-9: 40px;
  --pd-doc-space-10: 48px;
}
```

---

### 4. 圆角（4 级）

```css
:root {
  --pd-doc-border-radius-sm: 4px;     /* code 标签、blockquote */
  --pd-doc-border-radius-md: 8px;     /* 图片、Alert、代码块容器 */
  --pd-doc-border-radius-lg: 20px;    /* 版本标签 */
  --pd-doc-border-radius-full: 999px; /* 导航项、按钮 */
}
```

---

### 5. 过渡时长（3 级）

```css
:root {
  --pd-doc-transition-duration-fast: 0.2s;  /* 导航 hover */
  --pd-doc-transition-duration-base: 0.25s; /* 链接、标题锚点 */
  --pd-doc-transition-duration-slow: 0.3s;  /* 移动端导航、浮层 */
}
```

---

### 6. 层级 z-index（7 级）

控制 Header、浮层、导航栏、下拉菜单等元素的堆叠顺序：

```css
:root {
  --pd-doc-z-index-base: 1;       /* 代码块操作按钮 */
  --pd-doc-z-index-content: 9;    /* TOC / Simulator 区域 */
  --pd-doc-z-index-dropdown: 10;  /* Demo 底部控制条 */
  --pd-doc-z-index-overlay: 98;   /* NavScreen / SimulatorScreen */
  --pd-doc-z-index-nav-bar: 99;   /* MobileNavBar */
  --pd-doc-z-index-demo-nav: 100; /* 移动端 Demo 导航 */
  --pd-doc-z-index-header: 999;   /* 桌面端 Header */
}
```

---

### 7. 导航栏与布局尺寸

```css
:root {
  /* 布局尺寸 */
  --pd-doc-header-height: 60px;
  --pd-doc-sidebar-width: 240px;
  --pd-doc-toc-width: 180px;
  --pd-doc-simulator-width: 360px;
  --pd-doc-mobile-nav-height: 56px;
  --pd-doc-mobile-nav-bar-height: 48px;

  /* Header */
  --pd-doc-header-title-color: var(--pd-doc-text-1);
  --pd-doc-header-bg-color: var(--pd-doc-backdrop-bg);
  --pd-doc-header-shadow-color: var(--pd-doc-shadow-header-color);
  --pd-doc-header-theme-toggle-color: var(--pd-doc-text-3);
  --pd-doc-header-theme-toggle-hover-color: var(--pd-doc-primary);
}
```

---

### 8. Markdown 内容区

#### 标题字体变量

每个标题元素拥有独立变量，可单独控制而不影响其他级别：

```css
:root {
  /* 字号 */
  --pd-doc-md-font-size-h1: var(--pd-doc-font-size-xxl);
  --pd-doc-md-font-size-h2: var(--pd-doc-font-size-lg);
  --pd-doc-md-font-size-h3: var(--pd-doc-font-size-md);
  --pd-doc-md-font-size-h4: var(--pd-doc-font-size-md);
  --pd-doc-md-font-size-h5: var(--pd-doc-font-size-base);
  --pd-doc-md-font-size-p: var(--pd-doc-font-size-base);
  --pd-doc-md-font-size-table: var(--pd-doc-font-size-sm);

  /* 行高 */
  --pd-doc-md-line-height-h1: var(--pd-doc-line-height-xl);
  --pd-doc-md-line-height-h2: var(--pd-doc-line-height-loose);
  --pd-doc-md-line-height-h3: var(--pd-doc-line-height-relaxed);
  --pd-doc-md-line-height-h4: var(--pd-doc-line-height-base);
  --pd-doc-md-line-height-p: var(--pd-doc-line-height-relaxed);
  --pd-doc-md-line-height-code-block: var(--pd-doc-line-height-code);

  /* 字重 */
  --pd-doc-md-font-weight-heading: var(--pd-doc-font-weight-semibold);
  --pd-doc-md-font-weight-th: var(--pd-doc-font-weight-semibold);
  --pd-doc-md-font-weight-version-tag: var(--pd-doc-font-weight-semibold);
  --pd-doc-md-font-weight-alert-title: var(--pd-doc-font-weight-semibold);

  /* 字间距 */
  --pd-doc-md-letter-spacing-heading: var(--pd-doc-letter-spacing-tight);
  --pd-doc-md-letter-spacing-h1: var(--pd-doc-letter-spacing-tight);
  --pd-doc-md-letter-spacing-h2: var(--pd-doc-letter-spacing-tight);
  --pd-doc-md-letter-spacing-h3: var(--pd-doc-letter-spacing-tighter);
}
```

#### 标题和段落间距

```css
:root {
  --pd-doc-md-h1-margin: 0 0 var(--pd-doc-space-6);
  --pd-doc-md-h2-margin: var(--pd-doc-space-10) 0 var(--pd-doc-space-5);
  --pd-doc-md-h2-padding-top: var(--pd-doc-space-7);
  --pd-doc-md-h3-margin: var(--pd-doc-space-8) 0 var(--pd-doc-space-5);
  --pd-doc-md-h4-margin: var(--pd-doc-space-7) 0 var(--pd-doc-space-4);
  --pd-doc-md-h5-margin: var(--pd-doc-space-7) 0 var(--pd-doc-space-4);
  --pd-doc-md-p-margin: var(--pd-doc-space-5) 0;
  --pd-doc-md-li-margin: var(--pd-doc-space-3) 0;
  --pd-doc-md-ul-ol-margin: var(--pd-doc-space-5) 0;
  --pd-doc-md-hr-margin: var(--pd-doc-space-8) 0;
  --pd-doc-md-img-margin: var(--pd-doc-space-5) 0;
}
```

#### 表格

```css
:root {
  --pd-doc-md-table-margin-top: var(--pd-doc-space-4);
  --pd-doc-md-th-padding: var(--pd-doc-space-3) 10px;
  --pd-doc-md-td-padding: var(--pd-doc-space-3);
  --pd-doc-md-table-border-color: var(--pd-doc-divider);
  --pd-doc-md-table-first-child-code-color: var(--pd-doc-primary);
  --pd-doc-md-table-first-child-code-bg-color: var(--pd-doc-custom-block-tip-code-bg);
  --pd-doc-md-font-size-table: var(--pd-doc-font-size-sm);
  --pd-doc-md-font-size-version-tag: var(--pd-doc-font-size-xs);
  --pd-doc-md-font-size-table-em: var(--pd-doc-font-size-base);
}
```

#### 代码块与内联代码

```css
:root {
  /* 内联代码 */
  --pd-doc-md-code-margin: 0 var(--pd-doc-space-1);
  --pd-doc-md-code-padding: 3px 6px;
  --pd-doc-md-font-size-code: var(--pd-doc-font-size-base);
  --pd-doc-md-code-tag-bg-color: var(--pd-doc-code-tag-bg);
  --pd-doc-md-code-tag-text-color: var(--pd-doc-primary);

  /* 代码块 */
  --pd-doc-md-code-block-margin: var(--pd-doc-space-7) 0;
  --pd-doc-md-code-block-padding: var(--pd-doc-space-6) var(--pd-doc-space-7);
  --pd-doc-md-font-size-code-block: var(--pd-doc-font-size-sm);
  --pd-doc-md-code-block-bg-color: var(--pd-doc-bg-alt);
  --pd-doc-md-code-block-text-color: var(--pd-doc-text-1);
}
```

#### 圆角（Markdown 专项）

```css
:root {
  --pd-doc-md-border-radius-code: var(--pd-doc-border-radius-sm);
  --pd-doc-md-border-radius-version-tag: var(--pd-doc-border-radius-lg);
  --pd-doc-md-border-radius-blockquote: var(--pd-doc-border-radius-sm);
  --pd-doc-md-border-radius-img: var(--pd-doc-border-radius-md);
  --pd-doc-md-border-radius-alert: var(--pd-doc-border-radius-md);
  --pd-doc-md-code-block-border-radius: var(--pd-doc-border-radius-md);
}
```

#### 引用、Alert (Tip/Warning) 与二维码

```css
:root {
  /* 引用块 */
  --pd-doc-md-blockquote-margin: var(--pd-doc-space-5) 0;
  --pd-doc-md-blockquote-padding: var(--pd-doc-space-5) var(--pd-doc-space-7);
  --pd-doc-md-blockquote-bg-color: var(--pd-doc-blockquote-bg);

  /* Alert */
  --pd-doc-md-alert-padding: var(--pd-doc-space-6) var(--pd-doc-space-7);
  --pd-doc-md-alert-margin: var(--pd-doc-space-7) 0;
  --pd-doc-md-alert-title-margin-bottom: var(--pd-doc-space-3);
  --pd-doc-md-font-size-alert-title: var(--pd-doc-font-size-md);
  --pd-doc-md-font-weight-alert-title: var(--pd-doc-font-weight-semibold);

  /* Tip */
  --pd-doc-md-alert-tip-bg-color: var(--pd-doc-custom-block-tip-bg);
  --pd-doc-md-alert-tip-text-color: var(--pd-doc-text-1);
  --pd-doc-md-alert-tip-code-bg-color: var(--pd-doc-custom-block-tip-code-bg);
  --pd-doc-md-alert-tip-code-text-color: var(--pd-doc-primary);

  /* Warning */
  --pd-doc-md-alert-warning-bg-color: var(--pd-doc-custom-block-warning-bg);
  --pd-doc-md-alert-warning-text-color: var(--pd-doc-text-1);
  --pd-doc-md-alert-warning-code-bg-color: var(--pd-doc-custom-block-warning-code-bg);
  --pd-doc-md-alert-warning-code-text-color: var(--pd-doc-custom-block-warning-code-text);
}
```

#### 代码语法高亮

```css
:root {
  --pd-doc-code-text-color: var(--pd-doc-text-1);
  --pd-doc-code-string-text-color: #8080ff;
  --pd-doc-code-comment-text-color: #999;
  --pd-doc-code-number-text-color: #07c160;
  --pd-doc-code-variable-text-color: #88f;
  --pd-doc-code-keyword-text-color: #1989fa;
  --pd-doc-code-attribute-text-color: #e6550d;
  --pd-doc-api-params-color: #a7419e;
}
```

---

### 9. Demo 预览与模拟器

```css
:root {
  --pd-doc-demo-preview-border-color: var(--pd-doc-divider);
  --pd-doc-demo-preview-control-text-color: var(--pd-doc-text-3);
  --pd-doc-demo-preview-control-hover-text-color: var(--pd-doc-primary);
  --pd-doc-demo-preview-toolbar-icon-color: var(--pd-doc-text-3);
  --pd-doc-demo-preview-toolbar-icon-hover-color: var(--pd-doc-text-2);
  --pd-doc-simulator-shadow: var(--pd-doc-shadow-3);
}
```

---

### 10. 移动端专项变量

移动端拥有独立的排版和图标尺寸变量：

```css
:root {
  /* 排版 */
  --pd-doc-mobile-title-font-size: 17px;
  --pd-doc-mobile-title-font-weight: var(--pd-doc-font-weight-semibold);
  --pd-doc-mobile-home-title-font-size: 32px;
  --pd-doc-mobile-home-subtitle-font-size: 24px;
  --pd-doc-mobile-home-desc-font-size: var(--pd-doc-font-size-base);
  --pd-doc-mobile-section-title-font-size: var(--pd-doc-font-size-base);
  --pd-doc-mobile-section-title-line-height: 16px;

  /* 图标尺寸 */
  --pd-doc-mobile-nav-icon-size: 24px;
  --pd-doc-mobile-home-logo-size: 32px;
  --pd-doc-mobile-arrow-icon-size: 16px;

  /* 特有间距 */
  --pd-doc-mobile-home-padding-top: 46px;
}
```

---

### 11. 暗黑模式

开启暗黑模式后，CLI 已内置完整的暗色变量覆盖。如需自定义：

```scss
:root.dark {
  /* 暗色主色 */
  --pd-doc-primary: color-mix(in srgb, var(--pd-doc-primary-base) 50%, white);

  /* 文字色 */
  --pd-doc-text-1: rgba(255, 255, 245, 0.86);
  --pd-doc-text-2: rgba(235, 235, 245, 0.6);
  --pd-doc-text-3: rgba(235, 235, 245, 0.38);

  /* 背景色 */
  --pd-doc-bg: #1b1b1f;
  --pd-doc-bg-alt: #161618;

  /* 代码语法高亮（暗色） */
  --pd-doc-code-comment-text-color: #6a737d;
  --pd-doc-code-keyword-text-color: #f97583;
  --pd-doc-code-string-text-color: #9ecbff;
  --pd-doc-code-number-text-color: #79b8ff;
}
```

---

### 12. 引入自定义样式

将覆盖变量的文件引入到文档站样式入口：

```javascript
// site/desktop/style.js
import './style/css-vars.scss';   // 或自定义 var 文件
import './style/index.scss';

// site/mobile/style.js
import './style/css-vars.scss';
```

> **最佳实践**：修改时尽量只覆盖顶层基础令牌（如 `--pd-doc-space-*`、`--pd-doc-font-size-*`），Markdown 专项变量会自动继承新值，保持整体视觉一致性。
