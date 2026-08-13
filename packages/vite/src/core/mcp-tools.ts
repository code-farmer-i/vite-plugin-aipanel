/**
 * 自定义 DevTools 工具定义
 * 所有工具（除 chrome-devtools_list_pages）必须传入 pageId 参数，
 * 代理层校验 pageId 是否为项目页面后方可调用 chrome-devtools-mcp。
 */

export interface CustomTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** 所有工具共用的 pageId 参数定义 */
const PAGE_ID_PROP = {
  pageId: { type: "number", description: "目标页面 ID" },
} as const;

/** 为工具添加 pageId 必填参数 */
function withPageId(
  properties: Record<string, unknown>,
  required: string[] = [],
): {
  properties: Record<string, unknown>;
  required: string[];
} {
  return {
    properties: { ...PAGE_ID_PROP, ...properties },
    required: ["pageId", ...required],
  };
}

export const CUSTOM_TOOLS: CustomTool[] = [
  // ===== 页面管理 =====
  {
    name: "chrome-devtools_list_pages",
    description:
      "获取当前项目所有打开的页面列表，含 active（用户正在浏览）和 selected（Chrome DevTools 当前操作目标）标记",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "chrome-devtools_current_page",
    description: "获取用户当前正在浏览器浏览的页面上下文信息，包含页面 URL、标题、页面 ID",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ===== 截图与快照 =====
  {
    name: "chrome-devtools_take_snapshot",
    description: "获取指定页面可访问性树快照，返回元素 uid、角色、文本等",
    inputSchema: {
      type: "object",
      ...withPageId({
        verbose: { type: "boolean", description: "是否获取完整 a11y 树信息，默认 false" },
        filePath: { type: "string", description: "保存快照的文件路径，省略则内联返回" },
      }),
    },
  },
  {
    name: "chrome-devtools_take_screenshot",
    description: "截取指定页面或元素屏幕截图，返回 base64 或保存到文件",
    inputSchema: {
      type: "object",
      ...withPageId({
        format: {
          type: "string",
          enum: ["png", "jpeg", "webp"],
          description: "图片格式，默认 png",
        },
        quality: {
          type: "number",
          minimum: 0,
          maximum: 100,
          description: "JPEG/WebP 压缩质量 0-100",
        },
        uid: {
          type: "string",
          description: "元素 uid（从 chrome-devtools_take_snapshot 获取），省略截取整页",
        },
        fullPage: { type: "boolean", description: "是否截取完整页面（与 uid 互斥）" },
        filePath: { type: "string", description: "保存截图的文件路径，省略返回 base64" },
      }),
    },
  },

  // ===== 交互操作 =====
  {
    name: "chrome-devtools_click",
    description: "点击页面元素",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          uid: { type: "string", description: "元素 uid（从 chrome-devtools_take_snapshot 获取）" },
          dblClick: { type: "boolean", description: "是否双击，默认 false" },
          includeSnapshot: { type: "boolean", description: "是否在响应中包含快照，默认 false" },
        },
        ["uid"],
      ),
    },
  },
  {
    name: "chrome-devtools_hover",
    description: "鼠标悬停在页面元素上",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          uid: { type: "string", description: "元素 uid" },
          includeSnapshot: { type: "boolean", description: "是否在响应中包含快照，默认 false" },
        },
        ["uid"],
      ),
    },
  },
  {
    name: "chrome-devtools_drag",
    description: "拖拽页面元素到另一个元素上",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          from_uid: { type: "string", description: "被拖拽元素的 uid" },
          to_uid: { type: "string", description: "目标放置元素的 uid" },
          includeSnapshot: { type: "boolean", description: "是否在响应中包含快照，默认 false" },
        },
        ["from_uid", "to_uid"],
      ),
    },
  },
  {
    name: "chrome-devtools_type_text",
    description: "在已聚焦的输入框中使用键盘输入文本",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          text: { type: "string", description: "要输入的文本" },
          submitKey: {
            type: "string",
            description: '输入后按下的按键，如 "Enter"、"Tab"、"Escape"',
          },
        },
        ["text"],
      ),
    },
  },
  {
    name: "chrome-devtools_press_key",
    description: "按下键盘按键或组合键（快捷键、导航键等）",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          key: {
            type: "string",
            description: '按键或组合键，如 "Enter"、"Control+A"。修饰键: Control, Shift, Alt, Meta',
          },
          includeSnapshot: { type: "boolean", description: "是否在响应中包含快照，默认 false" },
        },
        ["key"],
      ),
    },
  },
  {
    name: "chrome-devtools_fill",
    description: "填写输入框值或选择 select 选项，触发 input/change 事件",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          uid: { type: "string", description: "输入框/select 元素 uid" },
          value: {
            type: "string",
            description: '要填入的值。checkbox/toggle 用 "true"/"false"，radio 用 "true"',
          },
          includeSnapshot: { type: "boolean", description: "是否在响应中包含快照，默认 false" },
        },
        ["uid", "value"],
      ),
    },
  },
  {
    name: "chrome-devtools_fill_form",
    description: "批量填写表单字段，比多次调用 fill/click 更快更可靠",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          elements: {
            type: "array",
            items: {
              type: "object",
              properties: { uid: { type: "string" }, value: { type: "string" } },
            },
            description: "表单元素数组 [{ uid, value }]",
          },
          includeSnapshot: { type: "boolean", description: "是否在响应中包含快照，默认 false" },
        },
        ["elements"],
      ),
    },
  },

  // ===== 页面导航 =====
  {
    name: "chrome-devtools_navigate_page",
    description: "导航页面（url/reload/back/forward）",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          type: {
            type: "string",
            enum: ["url", "back", "forward", "reload"],
            description: "导航类型",
          },
          url: { type: "string", description: "目标 URL（type=url 时必填）" },
          ignoreCache: { type: "boolean", description: "reload 时是否忽略缓存" },
          handleBeforeUnload: {
            type: "string",
            enum: ["accept", "dismiss"],
            description: "beforeunload 对话框处理方式",
          },
          initScript: {
            type: "string",
            description: "下一次导航时，在每个新 document 加载前执行的 JS 脚本",
          },
          timeout: { type: "integer", description: "最大等待时间（毫秒），0 使用默认超时" },
        },
        ["type"],
      ),
    },
  },
  {
    name: "chrome-devtools_resize_page",
    description: "调整页面视口大小",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          width: { type: "number", description: "视口宽度" },
          height: { type: "number", description: "视口高度" },
        },
        ["width", "height"],
      ),
    },
  },
  {
    name: "chrome-devtools_emulate",
    description: "模拟设备特性（网络节流、CPU 降速、地理位置、UA、颜色方案、视口等）",
    inputSchema: {
      type: "object",
      ...withPageId({
        networkConditions: {
          type: "string",
          enum: ["Offline", "Slow 3G", "Fast 3G", "Slow 4G", "Fast 4G"],
          description: "网络节流模式",
        },
        cpuThrottlingRate: {
          type: "number",
          minimum: 1,
          maximum: 20,
          description: "CPU 降速倍数，1 不降速",
        },
        geolocation: { type: "string", description: "地理位置，格式 `<纬度>,<经度>`" },
        userAgent: { type: "string", description: "UA 字符串，空字符串清除" },
        colorScheme: {
          type: "string",
          enum: ["dark", "light", "auto"],
          description: '颜色方案，"auto" 恢复默认',
        },
        viewport: {
          type: "string",
          description: "视口模拟，格式 `<宽>x<高>x<缩放比>[,mobile][,touch][,landscape]`",
        },
        extraHttpHeaders: {
          type: "string",
          description: '额外 HTTP 请求头 JSON，如 \'{"X-Custom":"value"}\'',
        },
      }),
    },
  },

  // ===== JS 执行 =====
  {
    name: "chrome-devtools_evaluate_script",
    description: "在指定页面执行 JavaScript 函数并返回结果（返回值需可 JSON 序列化）",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          function: {
            type: "string",
            description:
              "JS 函数声明。无参数: `() => document.title`，有参数: `(el) => el.innerText`",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "传给函数的参数列表（元素 uid）",
          },
          filePath: { type: "string", description: "保存输出到文件，省略则内联返回" },
          dialogAction: {
            type: "string",
            description: '对话框处理: "accept"、"dismiss" 或 prompt 文本',
          },
        },
        ["function"],
      ),
    },
  },

  // ===== 网络监控 =====
  {
    name: "chrome-devtools_list_network_requests",
    description: "获取指定页面网络请求列表（支持分页和过滤）",
    inputSchema: {
      type: "object",
      ...withPageId({
        pageSize: { type: "integer", description: "每页最大请求数" },
        pageIdx: { type: "integer", minimum: 0, description: "页码（从 0 开始）" },
        resourceTypes: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "document",
              "stylesheet",
              "image",
              "media",
              "font",
              "script",
              "xhr",
              "fetch",
              "websocket",
              "manifest",
              "other",
            ],
          },
          description: "按资源类型过滤",
        },
        includePreservedRequests: {
          type: "boolean",
          description: "是否返回最近 3 次导航的保留请求",
        },
      }),
    },
  },
  {
    name: "chrome-devtools_get_network_request",
    description: "获取网络请求的详细信息，可保存请求/响应体到文件",
    inputSchema: {
      type: "object",
      ...withPageId({
        reqid: {
          type: "number",
          description:
            "请求 ID（从 chrome-devtools_list_network_requests 获取），省略返回当前选中请求",
        },
        requestFilePath: {
          type: "string",
          description: "保存请求体到 .network-request 文件的路径",
        },
        responseFilePath: {
          type: "string",
          description: "保存响应体到 .network-response 文件的路径",
        },
      }),
    },
  },

  // ===== 控制台 =====
  {
    name: "chrome-devtools_list_console_messages",
    description: "获取指定页面控制台消息（支持分页和过滤）",
    inputSchema: {
      type: "object",
      ...withPageId({
        pageSize: { type: "integer", description: "每页最大消息数" },
        pageIdx: { type: "integer", minimum: 0, description: "页码（从 0 开始）" },
        types: {
          type: "array",
          items: {
            type: "string",
            enum: ["log", "debug", "info", "error", "warn", "trace", "verbose", "issue"],
          },
          description: "按消息类型过滤",
        },
        includePreservedMessages: {
          type: "boolean",
          description: "是否返回最近 3 次导航的保留消息",
        },
        serviceWorkerId: { type: "string", description: "按 service worker ID 过滤" },
      }),
    },
  },
  {
    name: "chrome-devtools_get_console_message",
    description: "获取某条控制台消息的详细信息",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          msgid: {
            type: "number",
            description: "消息 ID（从 chrome-devtools_list_console_messages 获取）",
          },
        },
        ["msgid"],
      ),
    },
  },

  // ===== 其他 =====
  {
    name: "chrome-devtools_wait_for",
    description: "等待指定页面出现指定文本（任一匹配即返回）",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          text: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "等待出现的文本列表",
          },
          timeout: { type: "integer", description: "最大等待时间（毫秒），0 使用默认超时" },
        },
        ["text"],
      ),
    },
  },
  {
    name: "chrome-devtools_handle_dialog",
    description: "处理 JavaScript 对话框（alert/confirm/prompt）",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          action: { type: "string", enum: ["accept", "dismiss"], description: "接受或关闭对话框" },
          promptText: { type: "string", description: "prompt 对话框的输入文本" },
        },
        ["action"],
      ),
    },
  },
  {
    name: "chrome-devtools_upload_file",
    description: "上传文件到文件输入框",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          uid: { type: "string", description: "文件输入框元素 uid" },
          filePath: { type: "string", description: "本地文件路径" },
          includeSnapshot: { type: "boolean", description: "是否在响应中包含快照，默认 false" },
        },
        ["uid", "filePath"],
      ),
    },
  },

  // ===== 性能分析 =====
  {
    name: "chrome-devtools_performance_start_trace",
    description: "在指定页面开始记录性能 trace（用于发现 Core Web Vitals 性能问题）",
    inputSchema: {
      type: "object",
      ...withPageId({
        reload: { type: "boolean", description: "开始后是否自动刷新页面，默认 true" },
        autoStop: { type: "boolean", description: "是否自动停止录制，默认 true" },
        filePath: { type: "string", description: "保存原始 trace 数据的路径，如 trace.json.gz" },
      }),
    },
  },
  {
    name: "chrome-devtools_performance_stop_trace",
    description: "停止性能 trace 记录并返回结果",
    inputSchema: {
      type: "object",
      ...withPageId({
        filePath: { type: "string", description: "保存原始 trace 数据的路径，如 trace.json.gz" },
      }),
    },
  },
  {
    name: "chrome-devtools_performance_analyze_insight",
    description: "获取特定性能指标的详细分析",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          insightSetId: { type: "string", description: "指标集 ID（从 trace 结果获取）" },
          insightName: {
            type: "string",
            description: '指标名称，如 "DocumentLatency"、"LCPBreakdown"',
          },
        },
        ["insightSetId", "insightName"],
      ),
    },
  },
  {
    name: "chrome-devtools_lighthouse_audit",
    description: "对指定页面运行 Lighthouse 审计（可访问性/SEO/最佳实践，不含性能）",
    inputSchema: {
      type: "object",
      ...withPageId({
        mode: {
          type: "string",
          enum: ["navigation", "snapshot"],
          description: "navigation 刷新审计，snapshot 分析当前状态",
        },
        device: {
          type: "string",
          enum: ["desktop", "mobile"],
          description: "模拟设备类型，默认 desktop",
        },
        outputDirPath: { type: "string", description: "报告输出目录，省略使用临时文件" },
      }),
    },
  },
  {
    name: "chrome-devtools_take_heapsnapshot",
    description: "捕获指定页面堆内存快照，用于分析 JS 对象内存分布和调试内存泄漏",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          filePath: { type: "string", description: "保存 .heapsnapshot 文件的路径" },
        },
        ["filePath"],
      ),
    },
  },

  // ===== Vue DevTools =====
  {
    name: "vue-devtools_get_apps",
    description: `获取指定页面所有 Vue 应用实例列表。

**何时使用**：
- 排查微前端/多实例场景下操作的是哪个应用
- 切换活跃应用前查看有哪些可用`,
    inputSchema: {
      type: "object",
      ...withPageId({}),
    },
  },
  {
    name: "vue-devtools_set_active_app",
    description: `切换指定页面的活跃 Vue 应用实例。后续所有 vue-devtools_* 工具都操作这个应用。`,
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          appId: { type: "string", description: "应用 ID（从 vue-devtools_get_apps 获取）" },
        },
        ["appId"],
      ),
    },
  },
  {
    name: "vue-devtools_get_component_tree",
    description: `获取指定页面当前活跃 Vue 应用的组件树。

**何时使用**：
- 了解页面组件层级结构
- 找到目标组件的 nodeId（后续查状态用）
- 排查组件未渲染问题
- 只关心某类组件时用 filter 缩小范围

**返回**：组件树 [{ id, name, children, file, ... }]`,
    inputSchema: {
      type: "object",
      ...withPageId({
        filter: { type: "string", description: "按组件名过滤（大小写不敏感的子串匹配），可选" },
      }),
    },
  },
  {
    name: "vue-devtools_get_component_state",
    description: `获取指定组件的完整运行时状态。

**何时使用**：
- 排查 props 传值是否正确
- 查看 ref/reactive 响应式数据的当前值
- 检查 computed 计算结果
- 查看 attrs / events / inject / provide / template refs`,
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          nodeId: {
            type: "string",
            description: "组件节点 ID（从 vue-devtools_get_component_tree 获取）",
          },
        },
        ["nodeId"],
      ),
    },
  },
  {
    name: "vue-devtools_get_component_render_code",
    description: `获取组件的渲染函数源码。`,
    inputSchema: {
      type: "object",
      ...withPageId({ nodeId: { type: "string", description: "组件节点 ID" } }, ["nodeId"]),
    },
  },
  {
    name: "vue-devtools_get_current_route",
    description: `获取 Vue Router 的当前路由信息。

**何时使用**：
- 排查路由跳转问题
- 查看当前路由 path/params/query/hash
- 确认路由守卫和 matched 记录`,
    inputSchema: {
      type: "object",
      ...withPageId({}),
    },
  },
  {
    name: "vue-devtools_get_routes",
    description: `获取 Vue Router 的完整路由表。

**何时使用**：
- 查看所有已注册路由
- 确认路由配置是否正确
- 查看路由嵌套关系`,
    inputSchema: {
      type: "object",
      ...withPageId({}),
    },
  },

  // ===== Vite 进程日志 =====
  {
    name: "logs-devtools_vite_logs",
    description: `获取 Vite 开发服务器的运行日志。

**何时使用此工具**：
- 用户报告"页面没更新"、"热更新不工作"、"HMR 失效"时
- 构建报错或编译失败，需要查看详细错误信息
- 页面白屏、样式丢失、模块加载失败等开发问题
- 用户提到"开发服务器有问题"、"vite 报错"
- 需要确认最近的文件变更是否被 Vite 正确处理

**日志内容**：
- Vite HMR 热更新日志（哪些文件被更新、更新状态）
- 构建编译日志（错误、警告、成功信息）
- OpenCode Web 进程输出
- 插件运行日志

日志保存在内存缓冲区（最近 500 条）。`,
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          description:
            "日志级别过滤：error(错误)、warn(警告)、info(信息)、debug(调试)、log(普通)。多个用逗号分隔，如 'error,warn'",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 50,
          description: "返回条数，默认 50，最大 200",
        },
        source: {
          type: "string",
          description:
            "来源过滤：console(控制台)、opencode-stdout(服务输出)、opencode-stderr(服务错误)",
        },
      },
    },
  },
];
