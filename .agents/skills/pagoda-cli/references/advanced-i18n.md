---
name: advanced-i18n
description: "配置文档站和组件的多语言（如中英文）支持。当用户需要实现国际化、多语言切换、或为不同语言编写文档时调用。"
---

# 多语言支持 (i18n)

该 Skill 提供了在 Pagoda CLI 文档站中配置和使用多语言（国际化）的完整方案。

## 适用场景

- 需要为组件库文档站添加多语言切换功能（如中文/英文切换）。
- 需要配置不同语言下的站点名称、Logo、导航栏（Nav）等。
- 需要了解多语言环境下的文档目录结构和路由映射规则。

## 核心配置与实现

### 1. 启用多语言与站点配置

在 `pagoda.config.mjs` 中通过 `site.locales` 配置多语言字典和默认语言。

```javascript
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  site: {
    // 默认语言（访问根路径时显示的语言）
    defaultLang: 'zh-CN',
    
    // 多语言配置字典
    locales: {
      'zh-CN': {
        label: '中文', // 语言切换器中显示的名称
        title: '我的组件库',
        subtitle: '轻量级 Vue 3 组件库', // 副标题
        description: '一个 Vue 3 组件库',
        headerTitle: 'MyUI', // 头部品牌标题
        logo: '/logo-zh.png',
        nav: [
          {
            title: '指南',
            items: [
              { title: '介绍', view: 'guide/intro' },
            ],
          },
          {
            title: '组件',
            view: 'components',
          },
        ]
      },
      'en-US': {
        label: 'English',
        title: 'My Component Library',
        subtitle: 'Lightweight Vue 3 Component Library',
        description: 'A Vue 3 component library',
        headerTitle: 'MyUI',
        logo: '/logo-en.png',
        nav: [
          {
            title: 'Guide',
            items: [
              { title: 'Introduction', view: 'guide/intro' },
            ],
          },
          {
            title: 'Components',
            view: 'components',
          },
        ]
      }
    }
  }
});
```

**关键点：**
- `defaultLang` 决定了站点的默认语言（如不带语言前缀的路由对应哪种语言）。
- `label` 字段用于渲染文档站顶部的语言切换下拉菜单。
- `subtitle` 副标题，显示在站点标题下方。
- `headerTitle` 头部品牌标题，显示在页面顶部 logo 区域。
- 可以在不同语言下提供不同的 `title`、`logo` 和 `nav`（导航菜单）。

### 2. 多语言文档组织结构

组件和静态文档通过**文件名后缀**区分不同语言版本。默认语言的文档不需要后缀。

**组件文档：**
```bash
src/Button/
├── README.md           # 中文文档 (默认语言，对应路由 /components/button)
└── README.en-US.md     # 英文文档 (对应路由 /en-US/components/button)
```

**静态视图文档：**
```bash
site/desktop/views/guide/
├── intro.md           # 中文文档 (默认语言，对应路由 /guide/intro)
└── intro.en-US.md     # 英文文档 (对应路由 /en-US/guide/intro)
```

### 3. 语言切换逻辑

文档站会在桌面端顶部导航栏和移动端首页底部自动生成语言切换器。
切换语言时：
1. 记录当前文档路由。
2. 将路由中的语言前缀替换为目标语言前缀（如 `/components/button` 变为 `/en-US/components/button`）。
3. 自动跳转到对应语言页面。

### 4. 路由映射规则

多语言文档的实际路由由**语言前缀 + 文件路径**组合而成。默认语言不需要前缀：

| 语言 | 文件路径 | 实际路由 |
|------|---------|----------|
| zh-CN (默认) | `src/Button/README.md` | `/components/button` |
| en-US | `src/Button/README.en-US.md` | `/en-US/components/button` |
| zh-CN (默认) | `site/desktop/views/guide/intro.md` | `/guide/intro` |
| en-US | `site/desktop/views/guide/intro.en-US.md` | `/en-US/guide/intro` |

### 5. docsRoot 配置

`docsRoot` 决定文档站首页默认展示的视图路径，通常设置为 `'components'`：

```javascript
site: {
  defaultLang: 'zh-CN',
  docsRoot: 'components',
  locales: { /* ... */ }
}
```

### 6. 外部链接配置 (links)

每个语言可以配置 `links` 数组，用于在导航栏中显示外部链接（如 PC 端/移动端产品线切换）。`active: true` 标记当前选中的链接：

```javascript
locales: {
  'zh-CN': {
    links: [
      { label: 'PC 端', link: 'https://ui.example.com', active: true },
      { label: '移动端', link: 'https://mobile.example.com' },
    ],
  },
  'en-US': {
    links: [
      { label: 'PC', link: 'https://ui.example.com', active: true },
      { label: 'Mobile', link: 'https://mobile.example.com' },
    ],
  },
}
```

## 最佳实践与注意事项

1. **保持文档结构一致**：不同语言的 Markdown 文档应具有相同的章节结构和 Demo 引用，方便同步维护。
2. **同步更新**：更新或新增组件功能时，请确保同时更新所有对应语言的文档文件。
3. **全局默认信息回退**：如果没有在 `locales` 的具体语言内配置 `title` 或 `logo`，CLI 将回退使用 `site` 根节点下的默认配置。
