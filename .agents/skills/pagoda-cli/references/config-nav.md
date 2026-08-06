---
name: config-nav
description: "详细说明文档站的顶部和侧边栏导航配置（site.nav）。当用户需要添加新页面、重组文档目录树或调整菜单结构时调用此 skill。"
---

# 导航配置 (Navigation)

本指南详细说明了文档站中路由和导航（包括顶部导航、侧边栏和移动端菜单）的配置方法。

## Usage

当用户要求在文档站中添加新指南、组件文档或修改现有菜单结构时，请参考以下 `site.nav` 配置。

### 1. 基础导航配置结构

导航配置位于 `site.nav` 数组中。导航项分为**页面节点**（有 `view`）和**分组节点**（有 `items`）。

```js
// pagoda.config.mjs
export default defineConfig({
  site: {
    nav: [
      // 1. 简单的顶级页面节点
      { title: '更新日志', view: 'changelog' },
      
      // 2. 带有侧边栏的顶部导航分组
      {
        title: '指南',
        items: [
          { title: '介绍', view: 'development/basics/introduction' },
          { title: '快速上手', view: 'guide/quickstart' },
        ],
      },
      
      // 3. 嵌套多级的组件导航分组
      {
        title: '组件',
        items: [
          {
            title: '基础组件',
            items: [
              { title: 'Button 按钮', view: 'button' },
              { title: 'Icon 图标', view: 'icon' },
            ],
          }
        ],
      },
    ],
  },
});
```

### 2. 导航项属性 (PagodaCliSiteNavItem)

了解每个导航节点的可用配置：

```ts
interface PagodaCliSiteNavItem {
  title?: string;              // 必填：菜单中显示的标题文本
  view?: string;               // 页面节点必填：映射到 site/desktop/views 目录下的 Markdown 文件路径
  items?: PagodaCliSiteNavItem[]; // 分组节点必填：子菜单数组
  hideInDesktop?: boolean;     // 仅在移动端显示，桌面端隐藏
  hideInMobile?: boolean;      // 仅在桌面端显示，移动端隐藏
}
```

### 3. `view` 路径映射规则

`view` 的值直接对应文件系统的目录结构，这是非常关键的机制。

| view 值 | 对应文件 |
|----------|----------|
| `development/basics/introduction` | `site/desktop/views/development/basics/introduction.md` |
| `changelog` | `site/desktop/views/changelog.md` |
| `button` | `src/Button/README.md`（默认组件路径）或 `site/desktop/views/button.md` |

**注意**：`view` 属性的值不应包含 `.md` 后缀。

### 4. `docsRoot` 组件文档路由前缀

默认为 `'components'`，控制组件文档在路由中的根路径：

```js
export default defineConfig({
  site: {
    docsRoot: 'components', // 默认值，view: 'button' -> /components/button
  },
});
```

修改为其他前缀：

```js
export default defineConfig({
  site: {
    docsRoot: 'development', // view: 'button' -> /development/button
  },
});
```

### 5. `defaultRoute` 默认路由

用于 404 或入口跳转：

```js
export default defineConfig({
  site: {
    defaultRoute: '/guide/quickstart',
  },
});
```

### 6. 外链与版本切换

#### links 外链配置

顶部外链列表，常用于产品线切换：

```js
export default defineConfig({
  site: {
    links: [
      { label: 'PC', link: 'https://ui.example.com', active: true },
      { label: 'Mobile', link: 'https://mobile.example.com' },
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

### 7. 组件文档自动识别

CLI 会自动扫描 `src/` 目录下的组件，生成组件文档导航。组件文档入口通过 `view: 'components'` 指定，CLI 会将其识别为组件文档分组：

```js
{
  title: '组件',
  view: 'components',
  items: [
    {
      title: '基础组件',
      items: [
        { title: 'Button 按钮', view: 'button' },
      ],
    },
  ],
}
```

组件文档路由格式：`/{docsRoot}/{component-name}`，例如 `/components/button`。

### 8. 多语言下的导航配置

如果启用了多语言，需要为每个语言分别配置 `nav`：

```js
export default defineConfig({
  site: {
    locales: {
      'zh-CN': {
        nav: [ { title: '指南', view: 'guide/intro' } ]
      },
      'en-US': {
        nav: [ { title: 'Guide', view: 'guide/intro' } ]
      }
    }
  }
});
```
