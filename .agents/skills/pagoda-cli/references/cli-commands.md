---
name: cli-commands
description: "详述 Pagoda CLI 所有可用命令（dev, build, site, release 等）及用法。当用户需要运行构建、启动本地服务、发布或询问命令详情时调用此 skill。"
---

# 命令行工具 (CLI Commands)

Pagoda CLI 提供了一系列内置命令来覆盖组件库开发的完整生命周期，包括开发、构建、文档生成和发布。

## Usage

### 全局选项

```bash
# 查看帮助信息
pagoda-cli --help

# 查看版本号
pagoda-cli --version
```

当用户需要执行具体的工程化操作（如打包、启动服务、清理缓存等）时，请参考以下命令及其适用场景：

### 1. 启动文档站开发服务器 (`site`)

这是开发 Vue UI 组件库最常用的命令。

**用法**：
```bash
pagoda-cli site
```
**场景**：在本地开发组件时实时预览效果。
**原理与特性**：
- 使用 Vite 启动开发服务器（默认端口由 Vite 决定，通常为 5173）。
- 支持 Markdown 与 Vue 组件的混排及实时渲染与热更新（HMR）。
- 内置移动端模拟器（可通过 `site.layout.showSimulator` 开启）。
- 监听 `pagoda.config.mjs` 配置文件变化，自动重启服务器。

### 2. 构建生产环境产物 (`build`)

将源码打包为可供他人使用的分发格式。

**用法**：
```bash
pagoda-cli build [options]
```
**常用选项**：
- `--notInstall`: 跳过自动安装依赖步骤（适合在 CI/CD 环境中使用）。

**执行流程**：
1. **清理目录**: 自动清理 `dist`、`es`、`lib`、`site-dist` 等产物目录。
2. **安装依赖**: 执行依赖安装确保环境一致（除非使用了 `--notInstall`）。
3. **复制源码**: 将源码复制到 `es` 和 `lib` 目录。
4. **构建入口**: 构建包脚本入口（除非配置了 `build.mode: 'lib'`）、构建样式依赖映射、构建组件样式入口、构建包样式入口。
5. **生成类型**: 提取 TypeScript 声明文件 (`.d.ts`)。
6. **编译输出**: 编译 ESM (ES Module) 和 CJS (CommonJS) 格式。
7. **打包输出**: 生成 UMD 产物（可通过配置 `build.bundle: false` 关闭）。

**配置选项**：
可通过 `pagoda.config.mjs` 中的 `build` 字段配置构建行为：
- `build.mode: 'lib'`: 跳过入口文件生成，适用于纯库模式。
- `build.bundle: false`: 关闭 UMD 打包。
- `build.vueSfc: false`: 跳过 Vue SFC 编译。
- `build.platform`: 指定构建平台（如 `browser`、`node`）。
- `build.srcDir`: 指定源码目录（默认 `src`）。

### 3. 交互式发布 (`release`)

自动化的 npm 包发布流程。

**用法**：
```bash
pagoda-cli release [options]
```
**选项**：
- `--tag <tag>`: 指定发布的 npm 标签（例如 `beta`、`next`）。

**执行流程**：
1. **显示当前信息**: 显示当前包名和版本号。
2. **选择版本**: 交互式选择要发布的版本（预设版本如 patch、minor、major 及其 beta 版本，或自定义版本号）。
3. **检查登录**: 检查 npm 登录状态，未登录则自动触发登录流程。
4. **更新版本**: 更新 `package.json` 中的版本号。
5. **运行钩子**: 执行 `beforeRelease` 钩子命令（如果配置）。
6. **构建**: 执行 `build` 命令（如果 `package.json` 中存在 build 脚本）。
7. **发布**: 将包发布到 npm 仓库。
8. **提交**: 提交变更并自动打上 Git Tag。
   - 单包仓库：tag 格式为 `v{version}`（如 `v1.0.0`）
   - Monorepo 子包：tag 格式为 `{pkgName}@v{version}`（如 `@pagoda/cli@v1.0.0`），仅提交当前包目录的变更
9. **推送**: 推送到远程 Git 仓库（含 tag）。

### 4. 纯 JS 库开发模式 (`dev`)

用于开发不包含 UI 组件的纯 JavaScript/TypeScript 工具库。

**用法**：
```bash
pagoda-cli dev
```
**执行流程**：
1. **初始构建**: 启动时先执行一次完整的构建（跳过依赖安装）。
2. **启动监听**: 使用 `vue-tsc --watch` 监听模式生成类型声明文件。
3. **文件监听**: 使用 `chokidar` 监听 `src` 目录变化，实时编译为 ESM 和 CJS 两种格式。

**注意**：开发 Vue UI 组件库**请勿**使用此命令，应使用 `site`。

### 5. 构建静态文档站 (`build-site`)

将文档站点打包为纯静态的 HTML/CSS/JS 文件。

**用法**：
```bash
pagoda-cli build-site
```
**场景**：需要将组件库的官方文档部署到 GitHub Pages、Vercel 或 Nginx 等静态托管服务时。默认输出至 `site-dist` 目录，可通过 `site.build.outputDir` 修改输出路径。

### 6. 代码质量与清理

- **`pagoda-cli lint`**：运行 ESLint 检查代码规范。默认对 `src` 目录下的源文件执行检查，如果存在可自动修复的问题，ESLint 会自动尝试修复。
- **`pagoda-cli commit-lint`**：检查 Git Commit Message 是否符合规范（基于 Angular 规范扩展），格式要求为 `<type>(<scope>): <subject>`。

  **支持的提交类型**：`fix`、`feat`、`docs`、`perf`、`test`、`types`、`style`、`build`、`chore`、`release`、`refactor`、`breaking change`、`Merge`。

  **Husky 集成配置**：
  ```json
  {
    "husky": {
      "hooks": {
        "commit-msg": "pagoda-cli commit-lint $1"
      }
    }
  }
  ```

- **`pagoda-cli clean`**：清理所有构建产物（`dist`、`es`、`lib`、`site-dist`）和临时缓存文件，用于解决奇怪的构建缓存问题。
