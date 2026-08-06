---
name: api-runtime
description: "当用户需要在文档站点开发（如自定义页面或组件 Demo）中实现站内路由跳转、多语言切换、生成在线演示（StackBlitz）以及获取站点全局配置时使用。"
---

# 文档运行时 API 与全局组件

Pagoda CLI 的 `@pagoda-cli/core/site` 模块为文档站提供了一系列运行时 API 和组件，用于在 Markdown 文档或 Vue Demo 中实现复杂的交互功能。

## 适用场景

- 需要在自定义文档页面或 Demo 中实现编程式路由跳转。
- 需要获取或动态切换当前站点的语言（如中英文切换）。
- 希望在组件 Demo 中提供 "一键在 StackBlitz 打开" 的在线演示功能。
- 需要读取 `pagoda.config.mjs` 中的配置信息（如站点标题、文档列表）。

## 核心 API 与组件

### 1. 站内路由跳转

**在 Markdown 中使用全局组件：**
CLI 内置了 `<PagodaDocLinkToView>` 全局组件，专门用于站内链接，它会自动处理多语言前缀和路由基础路径。

```html
<!-- 直接在 Markdown 中使用，无需引入 -->
<PagodaDocLinkToView view="development/basics/introduction" hash="installation">
  跳转到安装指南
</PagodaDocLinkToView>

<PagodaDocLinkToView view="components/button" :config="{ query: { tab: 'api' } }">
  查看 Button API
</PagodaDocLinkToView>
```

**在脚本中使用编程式导航：**

```typescript
import { navigateToView } from '@pagoda-cli/core/site';

// 导航到指定视图（参数1: viewPath, 参数2: hash, 参数3: vue-router config）
navigateToView('development/basics/introduction', 'installation', {});
```

### 2. 国际化 (i18n) 状态管理

用于获取当前语言或手动切换语言，设置会自动持久化到 localStorage 中。

```vue
<script setup>
import { getLang, setLang } from '@pagoda-cli/core/site';

const currentLang = getLang(); // 返回 'zh-CN' 或 'en-US'

const switchLang = () => {
  setLang(currentLang === 'zh-CN' ? 'en-US' : 'zh-CN');
};
</script>

<template>
  <button @click="switchLang">当前语言: {{ currentLang }}</button>
</template>
```

### 3. 在线演示 (StackBlitz) 生成

如果需要自定义一个 "在 StackBlitz 中打开" 的按钮，可以使用 `getPlaygroundData` 和 `openPlayground`。

```typescript
import { getPlaygroundData, openPlayground } from '@pagoda-cli/core/site';

const openDemo = () => {
  const demoCode = `<template><my-button type="primary">按钮</my-button></template>`;
  
  // 1. 生成 StackBlitz 项目配置
  const config = getPlaygroundData(demoCode, {
    name: 'my-component-library', // 你的包名
    version: '1.0.0',
    peerDependencies: { vue: '^3.0.0' }
  });

  // 2. 在新标签页打开
  openPlayground(config);
};
```

### 4. 获取站点配置与文档列表

通过虚拟模块 `site-desktop-shared`，你可以在运行时获取构建时解析的配置数据、文档元数据，以及来自 `site/desktop/index.js` 的设置配置（`setupConfig`）。

```typescript
import { config, documents, packageJson, setupConfig } from 'site-desktop-shared';

// 获取 pagoda.config.mjs 中的 site 配置
console.log('站点标题:', config.site.title);

// 获取来自 site/desktop/index.js 的设置配置（如果不存在该文件则返回空对象 {}）
console.log('setupConfig:', setupConfig);

// 遍历所有已解析的文档
documents.forEach(doc => {
  console.log('文档名:', doc.name, '路径:', doc.path, '是否为组件:', doc.isComponentDoc);
});

// 获取包版本
console.log('当前库版本:', packageJson.version);

// 访问组件库构建配置
const { srcDir, css } = config.build;

// 访问文档站构建配置
const { publicPath, outputDir } = config.site.build;
```

> **Note:** `config.build` 是组件库构建配置（`PagodaCliBuildConfig`），包含 `mode`、`platform`、`srcDir`、`css` 等属性。而 `config.site.build` 是文档站构建配置（`PagodaCliSiteBuildConfig`），包含 `publicPath`、`outputDir` 等属性。

## 其他实用工具

`@pagoda-cli/core/site` 还导出了部分底层依赖库，方便开发者直接使用而无需重复安装：

- `hljs`: highlight.js 实例，用于代码高亮。
- `clipboardCopy`: 剪贴板复制工具。
- `QRCode`: 二维码生成库。
- **Vue Router API**: 直接导出了 `useRouter`, `useRoute` 等 Vue Router 核心方法。

```typescript
import { clipboardCopy, QRCode, useRouter } from '@pagoda-cli/core/site';

// 复制文本
await clipboardCopy('复制的内容');

// 生成二维码 Data URL
const dataUrl = await QRCode.toDataURL('https://example.com');

// 获取当前路由
const router = useRouter();
```
