---
name: publish-versioning
description: "当用户需要发布组件库新版本、管理语义化版本号（如 alpha/beta/rc）、自动生成 CHANGELOG 或在 CI/CD 环境中配置自动发布流程时使用。"
---

# 版本管理与发布流程

Pagoda CLI 提供了标准的发布命令，遵循语义化版本（SemVer）规范，并集成了标签创建和 CHANGELOG 生成的最佳实践。

## 适用场景

- 组件库开发完成，需要更新版本号并发布到 npm。
- 需要发布预发布版本（如 `beta` 或 `rc`）进行内部测试。
- 希望规范化版本更新流程，自动创建 Git 标签和生成 CHANGELOG。
- 需要在 GitHub Actions 等 CI/CD 系统中配置自动发布。

## 核心命令与用法

### 1. 稳定版发布

运行 release 命令，CLI 会提供交互式界面让你选择要升级的版本号（patch/minor/major）。

```bash
# 自动更新 package.json 版本号并执行发布流程
pagoda-cli release

# 附带创建 Git Tag（推荐）
pagoda-cli release --gitTag
```

### 2. 预发布版本 (Pre-release)

当需要发布测试版时，通过 `--tag` 指定 npm 的发布标签（如 beta/rc），这会防止用户使用 `npm install` 默认下载到测试版。

```bash
# 发布 beta 版本 (例如 1.0.0-beta.0)，并打上 npm beta tag
pagoda-cli release --tag beta --gitTag

# 发布 rc (Release Candidate) 版本
pagoda-cli release --tag rc --gitTag
```

> **注意**：使用 `--tag beta` 发布后，用户需要明确指定 `npm install my-lib@beta` 才能安装。

### 3. 发布钩子 (Hooks)

在发布流程前后可以执行自定义命令，这通常用于在发布前运行测试、代码检查或生成 CHANGELOG：

```js
// pagoda.config.mjs
export default defineConfig({
  hooks: {
    beforeRelease: [
      'npm run test',
      'npm run changelog',
    ],
  },
});
```

支持的模板变量：
- `${name}` - 包名
- `${version}` - 发布版本号

### 4. 配置自动生成 CHANGELOG

推荐结合 `conventional-changelog` 自动生成变更日志。在 `package.json` 中配置：

```bash
npm install -D conventional-changelog-cli
```

```json
{
  "scripts": {
    "changelog": "conventional-changelog -p angular -i CHANGELOG.md -s",
    "release": "npm run changelog && pagoda-cli release --gitTag",
    "release:beta": "pagoda-cli release --tag beta --gitTag"
  }
}
```

## 最佳实践：CI/CD 自动发布配置

在实际项目中，通常将发布流程集成到 GitHub Actions 或 GitLab CI 中，当推送特定的 Tag 时自动构建和发布。

```yaml
# .github/workflows/release.yml 示例
name: Release

on:
  push:
    tags:
      - 'v*' # 监听以 v 开头的 tag，例如 v1.0.0

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Publish to NPM
        # 注意：在 CI 环境中通常直接使用 npm publish，而将版本号和 tag 的创建留在本地执行
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## 发布失败与版本回退

如果发布过程中出现网络或权限错误导致失败：
1. **本地回滚**：CLI 会尝试自动回滚 `package.json` 中的版本号。如果创建了错误的 Git 标签，可使用 `git tag -d v1.0.0` 删除。
2. **NPM 废弃**：如果包已发布到 npm 但发现严重问题，无法删除版本，只能通过标记废弃并发布补丁版本：
   ```bash
   npm deprecate my-lib@1.0.0 "此版本存在严重缺陷，请升级到 1.0.1"
   ```
