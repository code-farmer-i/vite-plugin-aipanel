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

### 4. 外观细节配置

```js
export default defineConfig({
  site: {
    headerTitle: 'MyUI',                    // 头部品牌标题（简短版本）
    subtitle: '轻量级 Vue 3 组件库',         // 站点副标题
    icon: '/favicon.ico',                   // favicon
  },
});
```

### 5. 外链与版本切换

#### links 外链列表

顶部外链，常用于产品线切换：

```js
export default defineConfig({
  site: {
    links: [
      { label: 'PC', link: 'https://ui.example.com', active: true },
      { label: 'Mobile', link: 'https://mobile.example.com' },
      { label: 'Charts', link: 'https://charts.example.com' },
    ],
  },
});
```

#### versions 版本切换

```js
export default defineConfig({
  site: {
    versions: [
      { label: 'v2.x', link: 'https://v2.example.com', active: true },
      { label: 'v1.x', link: 'https://v1.example.com' },
    ],
  },
});
```

### 6. Head 配置

#### head.html

注入到 `<head>` 中的原始 HTML：

```js
export default defineConfig({
  site: {
    head: {
      html: `
        <meta name="author" content="Your Name">
        <link rel="icon" href="/favicon.ico">
      `,
    },
  },
});
```

#### head.meta

结构化的 meta 标签配置：

```js
export default defineConfig({
  site: {
    head: {
      meta: [
        { name: 'keywords', content: 'Vue, Component, UI' },
        { name: 'description', content: 'A Vue 3 component library' },
        { property: 'og:title', content: 'My Component Library' },
        { property: 'og:description', content: 'A Vue 3 component library' },
      ],
    },
  },
});
```

**meta 字段说明**：

| 字段 | 说明 | 示例 |
|------|------|------|
| `content` | meta 标签内容 | `'Vue 3 组件库'` |
| `name` | 对应 `<meta name="...">`，适用于 description、keywords 等 | `'description'` |
| `property` | 对应 `<meta property="...">`，用于 Open Graph、Twitter Card | `'og:title'` |

#### head.analytics

百度统计配置：

```js
export default defineConfig({
  site: {
    head: {
      analytics: {
        baidu: {
          seed: 'your-baidu-analytics-seed',
        },
      },
    },
  },
});
```

### 7. 调试工具

#### enableVConsole

开发模式下注入 vConsole 调试工具（仅在开发环境生效）：

```js
export default defineConfig({
  site: {
    enableVConsole: true,
  },
});
```

### 8. 文档站构建配置

#### site.build 基础配置

```js
export default defineConfig({
  site: {
    build: {
      publicPath: '',             // 部署路径（留空以支持相对路径）
      outputDir: 'site-dist',     // 输出目录
      vueComponentsResolvers: [], // 组件解析器
      autoImportResolvers: [],    // 自动导入解析器
    },
  },
});
```

#### vueComponentsResolvers 示例

扩展组件自动导入，例如搭配 Vant：

```js
import { VantResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  site: {
    build: {
      vueComponentsResolvers: [
        VantResolver(),
      ],
    },
  },
});
```

#### autoImportResolvers 示例

扩展自动导入，例如搭配 Element Plus：

```js
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  site: {
    build: {
      autoImportResolvers: [
        ElementPlusResolver(),
      ],
    },
  },
});
```

### 9. 高级配置类型

```ts
interface PagodaCliSiteConfig {
  docsRoot?: string;             // 组件文档在路由中的根路径前缀，默认 'components'
  srcDir?: string;               // 文档源码目录，默认 'site'
  defaultRoute?: string;         // 404 或首页跳转的默认路由
  head?: PagodaCliSiteHeadConfig; // 注入 <head> 标签内容（如统计脚本）
  build?: PagodaCliSiteBuildConfig; // 静态站打包配置（如 publicPath、outputDir）
  enableVConsole?: boolean;      // 开发模式注入 vConsole
}
```
