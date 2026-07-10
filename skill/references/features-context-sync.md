# 页面上下文同步

## 工作原理

插件自动将当前页面的 URL 和标题同步给 OpenCode Agent，让 AI 知道用户正在浏览哪个页面。

## 同步的内容

发送给 AI 的上下文包括：

```
当前页面 URL: http://localhost:5173/products/42
当前页面标题: 商品详情 - 我的应用
选中的元素: [如果有选中元素，会附带文件路径、行号、文本内容]
```

## 自动化同步

### 页面切换监听

插件监听以下事件，自动更新页面上下文：

- `history.pushState`
- `history.replaceState`
- `popstate`（浏览器前进/后退）
- `hashchange`（Hash 路由）
- `document.title` 变化

**不需要手动操作**，SPA 路由切换时上下文自动更新。

### 同步频率

上下文更新有 **500ms 的节流**（debounce），避免频繁路由切换时重复请求。

## AI 如何使用上下文

OpenCode Agent 收到页面上下文后，会自动将以下信息注入系统提示：

1. **当前页面 URL 和标题** - 作为最高优先级上下文
2. **选中的元素信息** - 帮助 AI 定位代码位置

AI 理解问题的优先级：
1. 当前页面上下文（最高优先级）
2. 用户选中的元素
3. 用户当前输入的文字
4. 会话历史记录（最低优先级，仅作参考）

## 上下文 API

页面上下文通过 HTTP API 与 OpenCode 服务同步：

- **读取**：`GET /__opencode_context__` → 返回 `{ url, title, selectedElements }`
- **更新**：`POST /__opencode_context__` → 更新当前上下文
- **清空选中元素**：`DELETE /__opencode_context__` → 清除已选元素，并通过 SSE 通知所有客户端
