# 元素选择器

## 功能说明

元素选择器让你在页面上点选任意 DOM 元素，将元素的源码位置信息直接传给 AI。AI 就能快速定位到对应的组件代码。

## 使用方式

### 进入选择模式

- **快捷键**：按 `Ctrl + P`（macOS 用 `Cmd + P`）
- 进入后鼠标变为十字准星/选择状态
- 再次按 `Ctrl + P` 或按 `ESC` 退出

### 选中元素

在选择模式下：
1. 鼠标悬停到页面上任意元素，元素会高亮
2. 点击选中目标元素
3. 元素信息自动发送到 OpenCode 对话输入框

### 选中后的效果

选中一个元素后，OpenCode 输入框中会自动插入一个 **File Part 标记**，包含：

- **文件路径**：元素对应 Vue 组件的源文件路径
- **行号 / 列号**：代码在源文件中的位置
- **DOM 选择器**：元素的 CSS 选择器
- **文本内容**：元素的内部文本（前 500 字符）

输入框中显示为：`@elementSelector(内容预览...)`

实际传给 AI 的数据结构：

```json
{
  "nodeContext": {
    "filePath": { "value": "/src/components/Button.vue", "desc": "源码文件路径" },
    "line": { "value": 15, "desc": "代码所在行号" },
    "column": { "value": 3, "desc": "代码所在列号" },
    "description": { "value": "button.btn-primary", "desc": "DOM 元素选择器" },
    "innerText": { "value": "提交", "desc": "DOM 元素内部文本" },
    "selectAt": { "value": "http://localhost:5173/page", "desc": "选中时页面 URL" }
  }
}
```

## 依赖

元素选择器依赖 **unplugin-vue-inspector**（插件已内置）。

- Vue 项目：自动可用
- 非 Vue 项目：不可用，会提示"Vue Inspector 未加载"

## 批量选择

可以连续选中多个元素，所有选中元素会显示在输入框和气泡中：

- **输入框中**：每个元素一个 File Part 标记
- **悬浮气泡**：显示已选中元素列表
- **面板中**：显示选中元素列表，支持点击定位、单个删除、一键清空

## AI 如何使用元素信息

AI 收到元素信息后的处理流程：

1. 检查 `filePath` - 如果有路径，直接打开对应文件
2. 若路径为空，通过 Chrome DevTools MCP 获取元素 DOM 信息
3. 根据 `innerText` / `description` 在项目中搜索匹配的组件
4. 定位到代码后，根据用户请求进行修改

## 注意事项

- **选择模式下面板会关闭**（非分屏模式），退出选择后面板重新打开
- **ESC 优先退出选择模式**，而非中止 AI 对话，防止误操作
- 扩展模式下选择元素后，会通过 Chrome 扩展 API 将结果发送到侧边栏
