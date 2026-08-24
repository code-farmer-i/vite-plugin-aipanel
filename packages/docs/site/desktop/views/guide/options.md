# 插件配置

文档站当前使用的接入方式：

```js
import opencode from "vite-plugin-aipanel";

config.plugins.push(
  ...opencode({
    enabled: true,
  }),
);
```

## 建议

- 需要更详细日志时，可以在这里把 `verbose` 打开
- 如果要固定端口，可以继续传入 `webPort`
