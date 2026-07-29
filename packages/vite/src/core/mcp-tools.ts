/**
 * 自定义 DevTools 工具定义
 * 所有工具（除 devtools_list_pages）必须传入 pageId 参数，
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
  pageId: { type: "number", description: "目标页面 ID（从 devtools_list_pages 获取）" },
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
    name: "devtools_list_pages",
    description:
      "获取当前项目所有打开的页面列表，含 active（用户正在浏览）和 selected（Chrome DevTools 当前操作目标）标记",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ===== 截图与快照 =====
  {
    name: "devtools_snapshot",
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
    name: "devtools_screenshot",
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
        uid: { type: "string", description: "元素 uid（从 devtools_snapshot 获取），省略截取整页" },
        fullPage: { type: "boolean", description: "是否截取完整页面（与 uid 互斥）" },
        filePath: { type: "string", description: "保存截图的文件路径，省略返回 base64" },
      }),
    },
  },

  // ===== 交互操作 =====
  {
    name: "devtools_click",
    description: "点击页面元素",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          uid: { type: "string", description: "元素 uid（从 devtools_snapshot 获取）" },
          dblClick: { type: "boolean", description: "是否双击，默认 false" },
          includeSnapshot: { type: "boolean", description: "是否在响应中包含快照，默认 false" },
        },
        ["uid"],
      ),
    },
  },
  {
    name: "devtools_hover",
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
    name: "devtools_drag",
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
    name: "devtools_type",
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
    name: "devtools_press_key",
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
    name: "devtools_fill",
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
    name: "devtools_fill_form",
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
    name: "devtools_navigate",
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
    name: "devtools_resize_page",
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
    name: "devtools_emulate",
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
    name: "devtools_evaluate",
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
    name: "devtools_network",
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
    name: "devtools_network_request",
    description: "获取网络请求的详细信息，可保存请求/响应体到文件",
    inputSchema: {
      type: "object",
      ...withPageId({
        reqid: {
          type: "number",
          description: "请求 ID（从 devtools_network 获取），省略返回当前选中请求",
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
    name: "devtools_console",
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
    name: "devtools_console_message",
    description: "获取某条控制台消息的详细信息",
    inputSchema: {
      type: "object",
      ...withPageId(
        {
          msgid: { type: "number", description: "消息 ID（从 devtools_console 获取）" },
        },
        ["msgid"],
      ),
    },
  },

  // ===== 其他 =====
  {
    name: "devtools_wait_for",
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
    name: "devtools_handle_dialog",
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
    name: "devtools_upload_file",
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
    name: "devtools_performance_start",
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
    name: "devtools_performance_stop",
    description: "停止性能 trace 记录并返回结果",
    inputSchema: {
      type: "object",
      ...withPageId({
        filePath: { type: "string", description: "保存原始 trace 数据的路径，如 trace.json.gz" },
      }),
    },
  },
  {
    name: "devtools_performance_insight",
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
    name: "devtools_lighthouse",
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
    name: "devtools_heapsnapshot",
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
];

/** 工具名映射（自定义 → chrome-devtools-mcp） */
export const TOOL_MAP: Record<string, string> = {
  devtools_list_pages: "list_pages",
  devtools_snapshot: "take_snapshot",
  devtools_screenshot: "take_screenshot",
  devtools_evaluate: "evaluate_script",
  devtools_click: "click",
  devtools_hover: "hover",
  devtools_drag: "drag",
  devtools_type: "type_text",
  devtools_press_key: "press_key",
  devtools_fill: "fill",
  devtools_fill_form: "fill_form",
  devtools_navigate: "navigate_page",
  devtools_resize_page: "resize_page",
  devtools_emulate: "emulate",
  devtools_network: "list_network_requests",
  devtools_network_request: "get_network_request",
  devtools_console: "list_console_messages",
  devtools_console_message: "get_console_message",
  devtools_wait_for: "wait_for",
  devtools_handle_dialog: "handle_dialog",
  devtools_upload_file: "upload_file",
  devtools_performance_start: "performance_start_trace",
  devtools_performance_stop: "performance_stop_trace",
  devtools_performance_insight: "performance_analyze_insight",
  devtools_lighthouse: "lighthouse_audit",
  devtools_heapsnapshot: "take_heapsnapshot",
};
