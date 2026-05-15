---
name: config-simulator
description: "详细说明文档站的移动端模拟器配置。当用户在开发移动端组件库，需要配置桌面文档与手机预览 iframe 联动时调用此 skill。"
---

# 模拟器配置 (Simulator)

如果你的组件库是面向移动端的，Pagoda CLI 提供了一个内置的右侧手机模拟器 iframe，用于在桌面文档站中实时渲染移动端组件 Demo，并实现双向路由同步。

## Usage

当用户要求开启右侧手机预览、配置模拟器地址或修改路由映射规则时，请参考以下 `site.simulator` 配置：

### 1. 基础开关与访问

首先，必须在 `layout` 中开启模拟器显示，并在 `simulator` 中指定入口 URL。

```js
// pagoda.config.mjs
export default defineConfig({
  site: {
    layout: {
      showSimulator: true, // 开启右侧模拟器面板
    },
    simulator: {
      url: '/mobile.html', // 移动端页面地址（由 CLI 自动构建，默认即为 /mobile.html）
    },
  },
});
```

> **💡 提示**：当启用 `showSimulator: true` 时，桌面端的组件演示区块默认会自动切换为仅展示代码（`codeOnly` 模式），组件的实际渲染将交由右侧的移动端模拟器负责。你也可以通过 `site.layout.demoPreview` 显式配置演示组件的类型为 `'preview'` 或 `'codeOnly'`。

### 2. 路由同步与映射 (mapRoute)

默认情况下，桌面端路由（如 `/components/button`）与移动端路由是保持一致的。如果不一致，可以使用 `mapRoute` 函数进行转换。

```js
export default defineConfig({
  site: {
    simulator: {
      url: '/mobile.html',
      
      // 自定义路由映射：将桌面端的 /components/button 映射为移动端的 /button
      mapRoute: (path) => {
        return path.replace('/components', '');
      },
      
      // 双向同步开关
      syncFromSimulator: true, // 允许在模拟器内点击时，反向更新桌面文档路由
      syncToSimulator: true,   // 允许在桌面文档切换时，更新模拟器路由
    },
  },
});
```

### 3. 工作原理提示

- 桌面端页面 (`index.html`) 通过 iframe 嵌入 `mobile.html`。
- 两者通过 `postMessage` 机制传递当前的路由信息，从而实现左侧看文档，右侧看 Demo 的无缝体验。
- 如果你的组件仅针对桌面端，请将 `showSimulator` 设为 `false`。
