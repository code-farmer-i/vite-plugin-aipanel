---
name: config-build
description: "详细说明 `build` 配置项（如产物模式、样式处理、Vite 自定义）。当用户需要调整组件库打包方式、修改 CSS 预处理器或引入第三方库时调用此 skill。"
---

# build 构建配置

本指南详细说明了 `pagoda.config.mjs` 中的 `build` 配置项，它负责控制整个组件库的打包和产物生成行为。

## Usage

当用户遇到构建报错、需要修改包管理器、调整输出模块格式，或询问如何自定义构建过程时，请参考以下配置：

### 1. 构建模式与基础设置

根据项目的目标（组件库 vs 纯类库）选择不同的构建模式。

```js
// pagoda.config.mjs
export default defineConfig({
  build: {
    mode: 'components',           // 'components' (默认) 生成组件入口和样式; 'lib' 仅编译源码
    platform: 'browser',          // 目标平台: 'browser' | 'node' | 'neutral'
    packageManager: 'pnpm',       // 依赖安装和发布使用的包管理器 (npm/yarn/pnpm)
    srcDir: 'src',                // 指定源码目录
  },
});
```

### 2. 产物控制

精细控制打包输出的文件格式和特性。

```js
export default defineConfig({
  build: {
    umd: true,                    // 是否生成 UMD 产物（供浏览器直接 <script> 引入）
    bundle: true,                 // 是否将所有组件打包成单个大文件
    sourcemap: false,             // 是否生成 sourcemap
    namedExport: false,           // 是否生成具名导出
    vueSfc: true,                 // 是否启用 Vue 单文件组件 (SFC) 编译
    tagPrefix: 'my',              // 组件标签前缀（用于自动生成的 Web Types 提示）
  },
});
```

### 3. 样式处理配置

配置预处理器及样式抽离逻辑。

```js
export default defineConfig({
  build: {
    css: {
      preprocessor: 'less',       // 默认 'less'，支持 'scss'
      base: 'style/common/base.less', // 基础样式入口，会被注入到所有组件样式前
      removeSourceFile: false,    // 构建后是否移除样式源码文件
    },
  },
});
```
**场景**：如果项目使用 Sass/SCSS，必须显式将 `preprocessor` 改为 `scss` 或 `sass`。

### 4. 自定义底层构建 (Vite/esbuild)

如果你需要对默认的打包器（Vite/esbuild）进行更底层的配置扩展：

```js
export default defineConfig({
  build: {
    // 扩展 Vite 配置 (用于 site 文档站和部分组件编译)
    vite: {
      configure(config, type) {
        if (type === 'site') {
          // 修改文档站开发时的 Vite 配置
          config.server.port = 8080;
        }
        return config;
      },
    },
    // 文件后缀配置
    extensions: {
      esm: '.mjs',
      cjs: '.cjs'
    },
    // 第三方组件库按需引入配置
    thirdPartyComponents: {
      'element-plus': { 
        globalName: 'ElementPlus',
        sourceResolver: (path, { esModule }) => `element-plus/${esModule ? 'es' : 'lib'}/${path}`,
        styleResolver: {
          base: ({ esModule, ext }) => `element-plus/theme-chalk/base.css`,
          component: (name, { esModule, ext }) => `element-plus/theme-chalk/el-${name}.css`
        }
      }
    }
  },
});
```
