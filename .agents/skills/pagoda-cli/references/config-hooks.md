---
name: config-hooks
description: "提供 Pagoda CLI 的发布流程生命周期钩子配置说明。当用户需要在发布前后自动执行测试、构建或其他自定义脚本时调用此 skill。"
---

# 发布钩子 (Release Hooks)

Pagoda CLI 支持在自动化的发布流程中，注入自定义的脚本命令（Hooks），以保证发布前代码的质量和完整性。

## Usage

当用户询问如何在发布组件库前自动运行 ESLint、Vitest 或自定义脚本时，请参考以下配置：

### 1. 配置 beforeRelease 钩子

在 `pagoda.config.mjs` 中的 `hooks` 字段下配置 `beforeRelease`。

```js
// pagoda.config.mjs
import { defineConfig } from '@pagoda-cli/core';

export default defineConfig({
  hooks: {
    beforeRelease: [
      'npm run test',           // 1. 运行单元测试
      'npm run lint',           // 2. 运行代码规范检查
      'npm run build-site',     // 3. 构建静态文档站
    ],
  },
});
```

### 2. 动态模板变量支持

你可以在命令中使用内置变量，CLI 会在执行时自动替换：

| 变量 | 说明 | 示例 |
|------|------|------|
| `${name}` | `package.json` 中的包名 | `my-component-library` |
| `${version}` | 即将发布的新版本号 | `1.0.0` |

**示例**：
```js
export default defineConfig({
  hooks: {
    beforeRelease: [
      'echo "Releasing ${name} v${version}"',
      'npm run changelog -- --release ${version}', // 生成对应版本的 changelog
      'git add CHANGELOG.md',                      // 将生成的日志加入暂存区
    ],
  },
});
```

### 3. 执行顺序与异常处理机制

- **顺序**：数组中的命令将严格按顺序同步执行。
- **异常中断**：如果任何一个钩子命令返回非零退出码（失败），CLI 会**立即中断**整个发布流程，并输出标准错误（stderr）。
- **自动回滚**：中断后，CLI 会自动将 `package.json` 中的版本号回滚到修改前。
- **注意**：CLI 不会自动撤销钩子内已执行的其他操作（如已产生的 `git add`），因此确保你的钩子具备幂等性（可重复安全执行）。
