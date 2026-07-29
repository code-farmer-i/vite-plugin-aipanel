/**
 * 自定义 DevTools 工具定义
 * 所有工具自动映射到 chrome-devtools-mcp 底层工具
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

export const CUSTOM_TOOLS: CustomTool[] = [
  {
    name: "devtools_select_page",
    description: "选择当前项目中的某个页面作为后续工具操作的目标",
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "number", description: "页面 ID（从 devtools_list_pages 获取）" },
      },
      required: ["pageId"],
    },
  },
  {
    name: "devtools_list_pages",
    description:
      "获取当前项目所有打开的页面列表，含 active（用户正在浏览）和 selected（Chrome DevTools 当前操作目标）标记",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "devtools_snapshot",
    description: "获取当前页面可访问性树快照，返回元素 uid、角色、文本等",
    inputSchema: {
      type: "object",
      properties: {
        verbose: { type: "boolean", description: "是否获取完整节点信息" },
      },
    },
  },
  {
    name: "devtools_screenshot",
    description: "截取当前页面屏幕截图，返回 base64 图片数据",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", description: "图片格式: png 或 jpeg" },
        quality: { type: "number", description: "jpeg 质量 0-100" },
        fullPage: { type: "boolean", description: "是否截取完整页面" },
      },
    },
  },
  {
    name: "devtools_evaluate",
    description: "在当前页面执行 JavaScript 代码并返回结果（返回值需可 JSON 序列化）",
    inputSchema: {
      type: "object",
      properties: {
        function: { type: "string", description: "JS 函数声明，如 () => document.title" },
      },
      required: ["function"],
    },
  },
  {
    name: "devtools_click",
    description: "点击页面元素",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "元素 uid（从 devtools_snapshot 获取）" },
        dblClick: { type: "boolean", description: "是否双击" },
      },
      required: ["uid"],
    },
  },
  {
    name: "devtools_hover",
    description: "鼠标悬停在页面元素上",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "元素 uid" },
      },
      required: ["uid"],
    },
  },
  {
    name: "devtools_drag",
    description: "拖拽页面元素",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "源元素 uid" },
        targetUid: { type: "string", description: "目标元素 uid" },
      },
      required: ["uid", "targetUid"],
    },
  },
  {
    name: "devtools_type",
    description: "在聚焦元素中输入文本",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "要输入的文本" },
      },
      required: ["text"],
    },
  },
  {
    name: "devtools_press_key",
    description: "按下键盘按键",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "按键名称，如 Enter、Control+A" },
      },
      required: ["key"],
    },
  },
  {
    name: "devtools_fill",
    description: "填写输入框值并触发 input/change 事件",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "输入框元素 uid" },
        value: { type: "string", description: "要填入的值" },
      },
      required: ["uid", "value"],
    },
  },
  {
    name: "devtools_fill_form",
    description: "批量填写表单字段",
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: { uid: { type: "string" }, value: { type: "string" } },
          },
          description: "字段数组 [{ uid, value }]",
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "devtools_navigate",
    description: "导航页面（url/reload/back/forward）",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "url | reload | back | forward" },
        url: { type: "string", description: "目标 URL（type=url 时）" },
      },
      required: ["type"],
    },
  },
  {
    name: "devtools_resize_page",
    description: "调整页面视口大小",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number", description: "视口宽度" },
        height: { type: "number", description: "视口高度" },
      },
      required: ["width", "height"],
    },
  },
  {
    name: "devtools_emulate",
    description: "模拟移动设备",
    inputSchema: {
      type: "object",
      properties: {
        device: { type: "string", description: "设备名称，如 iPhone 15" },
      },
      required: ["device"],
    },
  },
  {
    name: "devtools_network",
    description: "获取当前页面网络请求列表",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "devtools_network_request",
    description: "获取某条网络请求的详细信息",
    inputSchema: {
      type: "object",
      properties: {
        reqid: { type: "number", description: "请求 ID（从 devtools_network 获取）" },
      },
      required: ["reqid"],
    },
  },
  {
    name: "devtools_console",
    description: "获取当前页面控制台消息",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "devtools_console_message",
    description: "获取某条控制台消息的详细信息",
    inputSchema: {
      type: "object",
      properties: {
        msgid: { type: "number", description: "消息 ID（从 devtools_console 获取）" },
      },
      required: ["msgid"],
    },
  },
  {
    name: "devtools_wait_for",
    description: "等待页面出现指定文本",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "等待出现的文本" },
      },
      required: ["text"],
    },
  },
  {
    name: "devtools_handle_dialog",
    description: "处理 JavaScript 对话框（accept/dismiss/输入文本）",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "accept | dismiss | prompt 输入文本" },
      },
      required: ["action"],
    },
  },
  {
    name: "devtools_upload_file",
    description: "上传文件到文件输入框",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "文件输入框元素 uid" },
        filePath: { type: "string", description: "文件绝对路径" },
      },
      required: ["uid", "filePath"],
    },
  },
  {
    name: "devtools_performance_start",
    description: "开始记录性能 trace",
    inputSchema: {
      type: "object",
      properties: {
        reload: { type: "boolean", description: "是否自动刷新" },
        autoStop: { type: "boolean", description: "是否自动停止" },
      },
    },
  },
  {
    name: "devtools_performance_stop",
    description: "停止性能 trace 记录并返回结果",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "devtools_performance_insight",
    description: "获取性能指标详细分析",
    inputSchema: {
      type: "object",
      properties: {
        insightSetId: { type: "string", description: "指标集 ID" },
        insightName: { type: "string", description: "指标名称" },
      },
      required: ["insightSetId", "insightName"],
    },
  },
  {
    name: "devtools_lighthouse",
    description: "运行 Lighthouse 审计（可访问性/SEO/最佳实践，不含性能）",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", description: "navigation 或 snapshot" },
        device: { type: "string", description: "desktop 或 mobile" },
      },
    },
  },
  {
    name: "devtools_heapsnapshot",
    description: "捕获堆内存快照",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "保存路径" },
      },
      required: ["filePath"],
    },
  },
];

/** 工具名映射（自定义 → chrome-devtools-mcp） */
export const TOOL_MAP: Record<string, string> = {
  devtools_select_page: "select_page",
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
