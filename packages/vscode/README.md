# AIPanel Assistant

为 AIPanel AI 提供 VS Code 原生格式化与诊断能力，通过 HTTP 桥接实现 formatOnSave、codeActionsOnSave 和 LSP 诊断的统一调度。

## 功能

- **格式化桥接**：将 AIPanel AI 的格式化请求转发到 VS Code 原生格式化器，支持 `formatOnSave` 和手动格式化
- **代码操作**：集成 `codeActionsOnSave`，在保存时自动执行代码修复
- **诊断同步**：将 VS Code LSP 诊断信息实时同步到 AIPanel AI

## 安装

通过 VSIX 文件安装：

```bash
code --install-extension vite-plugin-aipanel-1.0.0.vsix
```

## 开发

```bash
pnpm install
pnpm --filter vite-plugin-aipanel build
pnpm --filter vite-plugin-aipanel package
```

## 许可证

MIT
