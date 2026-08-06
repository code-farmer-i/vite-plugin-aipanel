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
        description: '一个 Vue 3 组件库',
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
        description: 'A Vue 3 component library',
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

## 最佳实践与注意事项

1. **保持文档结构一致**：不同语言的 Markdown 文档应具有相同的章节结构和 Demo 引用，方便同步维护。
2. **同步更新**：更新或新增组件功能时，请确保同时更新所有对应语言的文档文件。
3. **全局默认信息回退**：如果没有在 `locales` 的具体语言内配置 `title` 或 `logo`，CLI 将回退使用 `site` 根节点下的默认配置。
