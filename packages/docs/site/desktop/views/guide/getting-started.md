# 快速开始

## 启动文档站

```bash
pnpm run dev:docs
```

## 当前行为

- 启动前会先构建 workspace 中的 `shared`、`opencode`、`vite` 三个包
- Pagoda CLI 文档站启动时会自动加载 `vite-plugin-aipanel`
- 文档页本身就是插件的真实接入场景
