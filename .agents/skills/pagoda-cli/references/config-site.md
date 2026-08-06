---
name: config-site
description: "详细说明 `site` 配置项（如标题、Logo、布局、多语言等）。当用户需要修改文档站的外观、配置多语言或调整页面行为时调用此 skill。"
---

# site 文档站配置

本指南详细说明了 `pagoda.config.mjs` 中的 `site` 配置项，它用于控制文档站的内容展示和行为。

## Usage

当用户要求修改文档站点标题、更换 Logo、开启移动端模拟器或配置多语言时，请参考以下配置选项：

### 1. 基础外观配置

配置文档站的标题、SEO 描述及 Logo。

```js
// pagoda.config.mjs
export default defineConfig({
  site: {
    title: 'My Component Library',
    description: 'A Vue 3 component library for modern web',
    logo: './logo.png', // 桌面端 Logo（推荐使用相对路径）
    darkLogo: './logo-dark.png', // 暗黑模式 Logo
    mobileLogo: './logo-mobile.png', // 移动端 Logo
    logoLink: 'home', // 点击 Logo 跳转的视图路径（站内 view，如 'home' 或 'guide/intro'）
  },
});
```

### 2. 布局与模拟器联动

如果开发的是移动端组件库，可以开启模拟器。

```js
export default defineConfig({
  site: {
    layout: {
      darkMode: true,        // 开启暗黑模式切换按钮
      showAnchor: true,      // 显示右侧大纲锚点
      showSimulator: true,   // 开启右侧移动端模拟器
      demoPreview: 'preview', // 演示预览组件类型，可选值为 'preview' 或 'codeOnly'。未配置时，如果启用了 showSimulator，则默认使用 'codeOnly'，否则使用 'preview'
    },
    simulator: {
      url: '/mobile.html',   // 模拟器 iframe 来源
      syncFromSimulator: true, // 同步模拟器路由到外部文档
      syncToSimulator: true,   // 同步外部文档路由到模拟器
    },
  },
});
```

#### 布局配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `darkMode` | `boolean` | `false` | 是否开启暗黑模式切换按钮 |
| `showAnchor` | `boolean` | `true` | 是否在文章右侧展示目录锚点 |
| `showSimulator` | `boolean` | `false` | 是否开启右侧移动端模拟器（常用于 Mobile 组件库文档） |
| `demoPreview` | `'preview' \| 'codeOnly'` | 自动推断 | 演示预览组件类型。未配置时，如果启用了 `showSimulator`，则默认使用 `'codeOnly'`，否则使用 `'preview'` |

### 3. 多语言配置 (locales)

支持文档站多语言切换。

```js
export default defineConfig({
  site: {
    defaultLang: 'zh-CN', // 默认语言
    locales: {
      'zh-CN': {
        label: '中文',
        title: '我的组件库',
        nav: [ /* 中文导航 */ ]
      },
      'en-US': {
        label: 'English',
        title: 'My UI Lib',
        nav: [ /* 英文导航 */ ]
      }
    }
  }
});
```

### 4. 高级配置与构建

```ts
interface PagodaCliSiteConfig {
  docsRoot?: string;             // 组件文档在路由中的根路径前缀，默认 'components'
  srcDir?: string;               // 文档源码目录，默认 'site'
  defaultRoute?: string;         // 404 或首页跳转的默认路由
  head?: PagodaCliSiteHeadConfig; // 注入 <head> 标签内容（如统计脚本）
  build?: PagodaCliSiteBuildConfig; // 静态站打包配置（如 publicPath、outputDir）
}
```
**场景**：如果用户想修改部署的子目录或支持相对路径，需配置 `site.build.publicPath: ''`。
