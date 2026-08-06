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

访问地址：

- 桌面端文档站：`http://localhost:5173/`
- 移动端模拟器：`http://localhost:5173/mobile.html`

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

### 3. 配置项汇总

| 配置项 | 说明 | 类型 | 默认值 |
|--------|------|------|--------|
| `url` | 模拟器地址 | `string` | `/mobile.html` |
| `mapRoute` | 路由映射函数 | `(path: string) => string` | `(path) => path` |
| `syncFromSimulator` | 从模拟器同步路由到桌面端 | `boolean` | `true` |
| `syncToSimulator` | 将桌面端路由同步到模拟器 | `boolean` | `true` |

### 4. 移动端文档站代码示例

为移动端创建独立的文档入口页面，目录结构：

```
site/mobile/
├── components/
│   ├── DemoHome.vue        # 首页
│   ├── DemoNav.vue         # 导航
│   └── DemoPreview.vue     # 预览组件
├── style/
│   └── index.scss
├── App.vue
├── main.js
└── router.js
```

#### main.js

```js
// site/mobile/main.js
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './style/index.scss';

const app = createApp(App);
app.use(router);
app.mount('#app');
```

#### router.js

```js
// site/mobile/router.js
import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    component: () => import('./components/DemoHome.vue'),
  },
  {
    path: '/:component',
    component: () => import('./components/DemoPreview.vue'),
  },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
```

#### App.vue

```vue
<!-- site/mobile/App.vue -->
<template>
  <div class="mobile-app">
    <demo-nav />
    <router-view />
  </div>
</template>

<script setup>
import DemoNav from './components/DemoNav.vue';
</script>
```

### 5. postMessage 通信协议

桌面端与移动端通过 `postMessage` 通信，消息格式如下：

```js
// 桌面端发送路由到移动端
iframe.contentWindow.postMessage({
  type: 'replacePath',
  value: {
    path: '/button',
    hash: ''
  },
}, '*');

// 移动端发送路由到桌面端
window.parent.postMessage({
  type: 'replacePath',
  value: {
    path: '/button',
    hash: ''
  },
}, '*');
```

监听消息实现路由同步：

```js
// 监听路由同步消息
window.addEventListener('message', (event) => {
  if (event.data?.type === 'replacePath') {
    const { path, hash } = event.data?.value || {};
    // 更新路由
  }
});
```

### 6. 常见问题

**Q: 模拟器显示空白？**
检查：1) `url` 配置是否正确；2) 移动端页面是否正常启动；3) 是否存在跨域问题。

**Q: 路由不同步？**
检查：1) `syncFromSimulator` 和 `syncToSimulator` 是否启用；2) `mapRoute` 函数是否正确映射路由。

**Q: 如何禁用模拟器？**
设置 `site.layout.showSimulator: false`：

```js
export default defineConfig({
  site: {
    layout: {
      showSimulator: false,
    },
  },
});
```
