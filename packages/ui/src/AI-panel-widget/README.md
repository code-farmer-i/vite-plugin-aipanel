# AIPanel Widget

`AIPanelWidget` 是一个可悬浮在页面右下角的智能助手组件，主要用于在浏览器中呈现 AIPanel 聊天界面和选中代码节点的信息。

## 代码演示

::::demo

### 基础用法

这是挂件的基础用法说明，支持打开/关闭、暗黑模式切换以及页面节点选择。

:::demo-preview

basic

:::

::::

## API 参考

### Props

| 属性名                    | 说明                       | 类型                                                           | 默认值                    |
| ------------------------- | -------------------------- | -------------------------------------------------------------- | ------------------------- |
| `position`                | 挂件显示的位置             | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | `'bottom-right'`          |
| `open`                    | 挂件是否打开               | `boolean`                                                      | `false`                   |
| `theme`                   | 主题模式                   | `'light' \| 'dark' \| 'auto'`                                  | `'auto'`                  |
| `title`                   | 助手头部显示的标题         | `string`                                                       | `'AI 助手'`               |
| `hotkeyLabel`             | 快捷键提示文本             | `string`                                                       | `'Ctrl+K'`                |
| `selectShortcutLabel`     | 选择模式快捷键提示文本     | `string`                                                       | `'按 ESC 或 Ctrl+P 退出'` |
| `selectMode`              | 是否进入选择页面元素模式   | `boolean`                                                      | `false`                   |
| `sessionListCollapsed`    | 会话列表是否折叠           | `boolean`                                                      | `true`                    |
| `sessionKey`              | 会话列表项的唯一键字段     | `string`                                                       | `'id'`                    |
| `frameLoading`            | iframe 是否显示加载状态    | `boolean`                                                      | `false`                   |
| `loadingSessionList`      | 会话列表是否加载中         | `boolean`                                                      | `undefined`               |
| `showSessionListSkeleton` | 是否显示会话列表骨架屏     | `boolean`                                                      | `false`                   |
| `showEmptyState`          | 是否显示空状态             | `boolean`                                                      | `false`                   |
| `showError`               | 是否显示错误状态           | `boolean`                                                      | `false`                   |
| `emptyStateText`          | 空状态显示的文本           | `string`                                                       | `'当前项目暂无会话'`      |
| `emptyStateActionText`    | 空状态操作按钮文本         | `string`                                                       | `'立即创建'`              |
| `iframeSrc`               | Web UI 的 URL 来源         | `string`                                                       | `''`                      |
| `sessions`                | 会话列表数据               | `AIPanelWidgetSession[]`                                       | `[]`                      |
| `currentSessionId`        | 当前选中的会话 ID          | `string \| null`                                               | `null`                    |
| `selectedElements`        | 已选中的元素列表           | `AIPanelSelectedElement[]`                                     | `[]`                      |
| `showClearAll`            | 是否显示"一键清空"按钮     | `boolean`                                                      | `true`                    |
| `selectEnabled`           | 是否启用选择模式           | `boolean`                                                      | `true`                    |
| `thinking`                | 是否显示思考状态（加载中） | `boolean`                                                      | `false`                   |

### Events

| 事件名                        | 说明                                   | 回调参数                                  |
| ----------------------------- | -------------------------------------- | ----------------------------------------- |
| `update:open`                 | 当挂件打开或关闭时触发                 | `(open: boolean)`                         |
| `update:selectMode`           | 当选择模式切换时触发                   | `(mode: boolean)`                         |
| `update:sessionListCollapsed` | 当会话列表折叠状态改变时触发           | `(collapsed: boolean)`                    |
| `update:currentSessionId`     | 当选中的会话 ID 改变时触发             | `(sessionId: string \| null)`             |
| `update:selectedElements`     | 当已选中的元素列表改变时触发           | `(elements: AIPanelSelectedElement[])`    |
| `update:theme`                | 当主题模式改变时触发                   | `(theme: 'light' \| 'dark' \| 'auto')`    |
| `update:thinking`             | 当思考状态改变时触发                   | `(thinking: boolean)`                     |
| `toggle`                      | 点击触发挂件开关                       | `(open: boolean)`                         |
| `close`                       | 点击关闭按钮时触发                     | `-`                                       |
| `toggle-session-list`         | 点击会话列表切换按钮时触发             | `(collapsed: boolean)`                    |
| `toggle-select-mode`          | 点击选择模式切换按钮时触发             | `(mode: boolean)`                         |
| `toggle-theme`                | 点击主题切换按钮时触发                 | `(theme: 'light' \| 'dark' \| 'auto')`    |
| `create-session`              | 点击创建新会话时触发                   | `-`                                       |
| `select-session`              | 选中某个历史会话时触发                 | `(session: AIPanelWidgetSession)`         |
| `delete-session`              | 删除某个历史会话时触发                 | `(session: AIPanelWidgetSession)`         |
| `click-selected-node`         | 点击已选中的气泡或节点卡片时触发       | `(element: AIPanelSelectedElement)`       |
| `remove-selected-node`        | 删除已选中的元素时触发                 | `(payload: AIPanelRemoveSelectedPayload)` |
| `clear-selected-nodes`        | 清空所有选中元素时触发                 | `-`                                       |
| `empty-action`                | 点击空状态操作按钮时触发               | `-`                                       |
| `frame-loaded`                | iframe 加载完成时触发                  | `-`                                       |
| `thinking-change`             | 思考状态改变时触发（用于显示加载动画） | `(thinking: boolean)`                     |

### Slots

| 插槽名                | 说明                   | 说明                                                       |
| --------------------- | ---------------------- | ---------------------------------------------------------- |
| `button-icon`         | 自定义触发按钮图标     | 替换默认的挂件触发按钮图标                                 |
| `session-toggle-icon` | 自定义会话列表切换图标 | 替换默认的会话列表展开/折叠图标                            |
| `select-icon`         | 自定义选择模式切换图标 | 替换默认的选择页面元素图标                                 |
| `close-icon`          | 自定义关闭按钮图标     | 替换默认的关闭按钮图标                                     |
| `theme-icon`          | 自定义主题切换图标     | 替换默认的主题切换图标（自动/亮色/暗色）                   |
| `sessions-empty`      | 自定义会话列表空状态   | 替换默认的"暂无会话"提示                                   |
| `empty-state`         | 自定义 iframe 空状态   | 替换默认的空状态提示（当 `showEmptyState` 为 true 时显示） |
| `loading`             | 自定义 iframe 加载状态 | 替换默认的"加载中..."提示                                  |
| `error`               | 自定义错误状态         | 替换默认的错误提示                                         |
| `content`             | 自定义 iframe 内容     | 替换默认的 iframe，用于完全自定义内容                      |

### Exposed Methods

组件通过 `ref` 暴露以下方法：

| 方法名                | 说明               | 参数                                                              |
| --------------------- | ------------------ | ----------------------------------------------------------------- |
| `showNotification`    | 显示通知消息       | `(message: string, duration?: number)`<br/>`duration` 默认 3000ms |
| `showConfirmDialog`   | 显示确认对话框     | `(message: string) => Promise<boolean>`<br/>返回用户确认结果      |
| `sendMessageToIframe` | 向 iframe 发送消息 | `(type: string, data?: Record<string, unknown>)`                  |

### 类型定义

#### AIPanelWidgetSession

```typescript
interface AIPanelWidgetSession {
  id: string;
  title?: string;
  updatedAt?: string | number | Date;
  meta?: string;
  directory?: string;
}
```

#### AIPanelSelectedElement

```typescript
interface AIPanelSelectedElement {
  filePath: string | null;
  line: number | null;
  column: number | null;
  innerText: string;
  description?: string;
}
```

#### AIPanelRemoveSelectedPayload

```typescript
interface AIPanelRemoveSelectedPayload {
  element: AIPanelSelectedElement;
  index: number;
  source: "panel" | "bubble";
}
```

- `source`: 删除来源，`"panel"` 表示从右侧节点面板删除，`"bubble"` 表示从气泡列表删除

## 主题定制

组件支持亮色、暗色和自动三种主题模式：

- **亮色模式** (`light`): 适用于明亮环境
- **暗色模式** (`dark`): 适用于夜间或暗色环境
- **自动模式** (`auto`): 根据系统主题自动切换

组件使用 CSS 变量进行主题定制，主要变量包括：

| 变量名                | 说明           |
| --------------------- | -------------- |
| `--ap-bg-main`        | 主背景色       |
| `--ap-bg-secondary`   | 次背景色       |
| `--ap-bg-tertiary`    | 第三背景色     |
| `--ap-text-primary`   | 主文本色       |
| `--ap-text-secondary` | 次文本色       |
| `--ap-border-primary` | 主边框色       |
| `--ap-primary`        | 主色调（蓝色） |
| `--ap-danger`         | 危险色（红色） |
| `--ap-success`        | 成功色（绿色） |

## 位置配置

挂件支持四个位置配置：

- `bottom-right` (默认): 右下角
- `bottom-left`: 左下角
- `top-right`: 右上角
- `top-left`: 左上角

## 使用示例

### 基础使用

```vue
<template>
  <aipanel-widget
    :open="open"
    :theme="theme"
    :sessions="sessions"
    :current-session-id="currentSessionId"
    :selected-elements="selectedElements"
    iframe-src="https://opencode.dev"
    @update:open="open = $event"
    @select-session="handleSelectSession"
  />
</template>
```

### 完整示例

```vue
<template>
  <aipanel-widget
    ref="widgetRef"
    v-model:open="open"
    v-model:theme="theme"
    v-model:select-mode="selectMode"
    v-model:session-list-collapsed="sessionListCollapsed"
    position="bottom-right"
    title="我的 AI 助手"
    :sessions="sessions"
    :current-session-id="currentSessionId"
    :selected-elements="selectedElements"
    iframe-src="https://opencode.dev"
    @select-session="handleSelectSession"
    @delete-session="handleDeleteSession"
    @create-session="handleCreateSession"
    @click-selected-node="handleClickSelectedNode"
    @remove-selected-node="handleRemoveSelectedNode"
    @clear-selected-nodes="handleClearSelectedNodes"
    @empty-action="handleCreateSession"
  />
</template>

<script setup>
import { ref } from "vue";

const open = ref(false);
const theme = ref("auto");
const selectMode = ref(false);
const sessionListCollapsed = ref(true);
const currentSessionId = ref(null);
const sessions = ref([]);
const selectedElements = ref([]);

const widgetRef = ref();

// 显示通知
const showNotification = (message) => {
  widgetRef.value?.showNotification(message);
};

// 显示确认对话框
const confirmDelete = async (message) => {
  const confirmed = await widgetRef.value?.showConfirmDialog(message);
  if (confirmed) {
    // 执行删除操作
  }
};
</script>
```

### 选择模式

启用选择模式后，用户可以点击页面元素进行选择：

```vue
<template>
  <button @click="selectMode = true">开始选择</button>

  <aipanel-widget
    v-model:select-mode="selectMode"
    :selected-elements="selectedElements"
    @click-selected-node="handleClickSelectedNode"
  />
</template>
```

## 注意事项

1. **iframe 通信**: 如果需要与 iframe 进行通信，可以使用 `sendMessageToIframe` 方法
2. **对话框**: `showConfirmDialog` 返回 Promise，需要使用 `await` 处理
3. **通知**: `showNotification` 的持续时间可以自定义，默认 3000ms
4. **选择模式**: 选择模式依赖 `__VUE_INSPECTOR__` 全局对象，需要确保已安装 Vue Inspector
5. **主题切换**: 在 `auto` 模式下，组件会自动检测系统主题变化

## 依赖

- Vue 3
- `@aipanel/core` (类型定义)
