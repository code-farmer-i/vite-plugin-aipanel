---
name: config-site-structure
description: "提供文档站目录结构和文件组织方式的指南。当用户不知道如何创建文档页面、自定义站点组件或修改入口文件时调用此 skill。"
---

# 站点结构与路由映射

Pagoda CLI 文档站的结构独立于源码，统一存放在 `site/` 目录下。它支持高度定制化，包括页面路由、自定义组件和多语言资源。

## Usage

当用户询问如何添加一篇新的指南文档、修改首页、或注入全局 CSS 时，请指导他们遵循以下结构规范：

### 1. 标准 site 目录结构

```text
my-component-library/
├── site/                          # 文档站根目录
│   ├── desktop/                   # 桌面端文档站配置
│   │   ├── views/                 # Markdown / Vue 文档页面（核心）
│   │   ├── components/            # 仅在文档站使用的自定义 Vue 组件
│   │   ├── style/                 # 文档站自定义样式
│   │   ├── index.js               # 桌面端应用入口配置
│   │   └── style.js               # 桌面端样式入口
│   │
│   ├── mobile/                    # 移动端文档站（模拟器内运行）
│   │   ├── components/
│   │   ├── style/
│   │   ├── index.js
│   │   └── style.js
│   │
│   ├── common/                    # 桌面和移动端共享的资源
│   │   └── locales.js             # 多语言文本
│   │
│   └── static/                    # 会原样复制到产物的静态资源 (如 logo.png)
└── pagoda.config.mjs              # CLI 配置
```

### 2. views 目录与路由自动映射

在 `site/desktop/views/` 目录下的 `.md` 和 `.vue` 文件，会自动根据相对路径生成路由：

- `views/guide/intro.md` 对应的 `view` 路径为 `guide/intro`。
- `views/changelog.md` 对应的 `view` 路径为 `changelog`。
- `views/home.vue` 对应的 `view` 路径为 `home`。

**使用场景**：如果用户想在导航栏增加一个“进阶使用”，需在 `site.nav` 中配置 `view: 'guide/advanced'`，然后创建 `site/desktop/views/guide/advanced.md` 文件。

### 3. 自定义路由 Meta

如果需要为特定的页面（无论是 `.md` 还是 `.vue` 格式）配置额外的路由信息，如页面标题、是否显示右侧锚点、或者是否将路由同步至模拟器等，你可以在页面组件中导出 `meta` 对象。

**在 `.vue` 文件中配置：**
```vue
<script setup>
defineOptions({
  meta: {
    title: '自定义首页标题',
    headerShadow: false,
    showAnchor: false,
    simulator: {
      syncToSimulator: false // 禁用该页面向移动端模拟器同步路由
    }
  }
});
</script>
```

**在 `.md` 文件中配置：**
借助 Pagoda CLI 的内置转换支持，你可以直接在 Markdown 文件中使用 `<script setup>` 来声明同样的配置：
```vue
<script setup>
defineOptions({
  meta: {
    title: '组件指南',
    showSimulator: true
  }
});
</script>

# 组件指南
这里是页面的 Markdown 正文...
```

#### 常用的 Meta 字段
| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 附加的页面标题，将与 `site.title` 拼接后作为 `document.title` |
| `showAnchor` | `boolean` | 是否在桌面端文档右侧显示目录锚点（覆盖全局配置） |
| `showSimulator` | `boolean` | 是否在桌面端文档右侧显示移动端模拟器（覆盖全局配置） |
| `headerShadow` | `boolean` | 是否在顶部导航栏显示阴影，默认为 `true` |
| `simulator.syncToSimulator` | `boolean` | 当切换到该路由时，是否将路由信息同步至移动端模拟器。设为 `false` 可禁止同步 |

### 4. 自定义文档站入口 (index.js)

桌面端文档站入口配置文件 `site/desktop/index.js`，常用于全局注册组件或定制文档站功能（如定制代码演示区，开启或关闭模拟器、右侧锚点等）：

```js
// site/desktop/index.js
import MyUiLib from 'my-ui-lib';

export default {
  // 全局注册组件
  install(app) {
    app.use(MyUiLib);
  },
  // 控制是否显示模拟器
  showSimulator(route) {
    return route.meta.isComponentDoc;
  },
  // 控制是否显示右侧锚点
  showAnchor(route) {
    return !route.meta.isComponentDoc;
  },
  // 定制在线代码演示区的环境配置
  configurePlaygroundParams(config, packageJson) {
    // 可以在这里注入在线演示的代码或者配置
    return config;
  }
};
```

与桌面端类似，移动端（模拟器）也有入口配置文件 `site/mobile/index.js`，用于全局注册组件：

```js
// site/mobile/index.js
import MyUiLib from 'my-ui-lib';

export default {
  // 全局注册组件
  install(app) {
    app.use(MyUiLib);
  },
};
```

另外还有 `site/desktop/style.js` 和 `site/mobile/style.js` 用于引入相应的全局样式。
