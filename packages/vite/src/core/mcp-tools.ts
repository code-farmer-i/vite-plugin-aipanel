/**
 * Chrome DevTools 工具层的项目维度元数据与自定义工具。
 *
 * 模型可见的 chrome-devtools_* 工具 = 官方 chrome-devtools-mcp 工具的白名单子集
 * （schema/描述运行时同步自官方 tools/list，见 official-tools.ts）+ 本项目自定义工具。
 * 工具层限制（白名单、必填 pageId、仅项目页）由本文件 + endpoints/mcp.ts 的 tools/call 共同执行。
 */

import { VUE_DEVTOOLS_ACTIONS, type VueDevtoolsAction } from "@aipanel/core";
import { OFFICIAL_TOOL_META, type OfficialToolMeta } from "./official-meta";

/** 模型可见名前缀：官方短名 → chrome-devtools_<name> */
export const MCP_PREFIX = "chrome-devtools_";

export function displayToolName(short: string): string {
  return MCP_PREFIX + short;
}

/** 本地桥接工具族前缀（tools/list 暴露面与 tools/call 路由共用） */
export const VUE_DEVTOOLS_PREFIX = "vue-devtools_";
export const LOGS_DEVTOOLS_PREFIX = "logs-devtools_";

/** Vite 进程日志工具名（工具定义与调用路由共用） */
export const VITE_LOGS_TOOL_NAME = `${LOGS_DEVTOOLS_PREFIX}vite_logs`;

/** 服务日志文件工具名（按 LogFileConfig.name 生成，暴露与路由共用） */
export function serviceLogToolName(name: string): string {
  return `${LOGS_DEVTOOLS_PREFIX}${name}_logs`;
}

export interface CustomTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * 默认暴露的官方页面级工具 = 元数据规则推导（pageScoped && 无条件 && 分类安全），
 * 具体由 officialDefaultShorts() 给出。
 * 以下为 meta 无法从 pageScoped 推断、需要“按页面上下文使用/列表/新建”的产品全局特例（短名）。
 */
export const OFFICIAL_GLOBAL_POLICY = [
  "evaluate_script",
  "list_console_messages",
  "list_pages",
  "new_page",
] as const;

export type OfficialToolShortName = string;

/** 不需要 pageId 的官方工具（无目标页，由调用层特别处理） */
export const OFFICIAL_NO_PAGE_TOOLS: ReadonlySet<string> = new Set(["list_pages", "new_page"]);

/** 目标页参数：pageId 必须在可操作范围（项目页或 allowOrigins 白名单页）内 */
export const PAGE_ID_PROP = {
  pageId: {
    type: "number",
    description:
      "The ID of a page within the operation scope (project pages or chromeMcp.project.allowOrigins pages) to operate on",
  },
} as const;

/** 往官方 schema 上统一追加必填 pageId（保持工具层项目限制） */
export function withPageIdSchema(schema: CustomTool["inputSchema"]): CustomTool["inputSchema"] {
  return {
    type: "object",
    properties: { ...PAGE_ID_PROP, ...schema.properties },
    required: ["pageId", ...(schema.required ?? [])],
  };
}

/**
 * 追加到官方描述末尾的项目维度说明（英文，按工具特例）。
 * 只填“调用层真正实现的语义与官方不一样”的工具，
 * 避免描述过度承诺（如 navigate_page 目标 URL 未被调用层限制，不填“必须在项目内”）。
 * 其余页面级工具的项目边界由必填 pageId 参数说明表达（PAGE_ID_PROP）。
 */
export const PROJECT_DESCRIPTION_NOTES: Record<string, string> = {
  list_pages:
    "Lists pages within the operation scope (project pages + chromeMcp.project.allowOrigins).",
  new_page:
    "Only URLs within the operation scope (project or allowOrigins) can be opened. Opening a project page is de-duplicated (returns the already-open page); allowOrigins pages are opened without a count limit.",
  navigate_page:
    "Navigation target (type=url) must stay within the operation scope (project or allowOrigins).",
};

/** 自定义工具（官方无对应，工具层本地实现） */
export const CUSTOM_TOOLS: CustomTool[] = [
  {
    name: displayToolName("current_page"),
    description:
      "Get the page the user is currently browsing (URL, title, and page ID). Resolves the project page with injected context; for allowOrigins pages use list_pages and pass its pageId to page tools instead.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: VITE_LOGS_TOOL_NAME,
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
            "来源过滤：console(控制台)、provider-stdout(服务输出)、provider-stderr(服务错误)",
        },
      },
    },
  },
];

/**
 * 页面桥接工具：描述与输入 schema（模型可见）+ 后端 action（调用分发）单一来源。
 * tools/list 与 tools/call 都取自本定义，避免"清单"与"路由"两份来源各自漂移。
 * 只在注入 Vue DevTools 桥的项目（Vue 项目）暴露。
 */
export interface VueDevtoolsTool extends CustomTool {
  /** 页面桥后端 action（endpoints/vue-devtools.ts executeAction） */
  action: VueDevtoolsAction;
}

export const VUE_DEVTOOLS_TOOLS: readonly VueDevtoolsTool[] = [
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_apps`,
    action: VUE_DEVTOOLS_ACTIONS.GET_APPS,
    description: `获取指定页面所有 Vue 应用实例列表。

**何时使用**：
- 排查微前端/多实例场景下操作的是哪个应用
- 切换活跃应用前查看有哪些可用`,
    inputSchema: withPageIdSchema({ type: "object", properties: {} }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}set_active_app`,
    action: VUE_DEVTOOLS_ACTIONS.TOGGLE_APP,
    description: `切换指定页面的活跃 Vue 应用实例。后续所有 vue-devtools_* 工具都操作这个应用。`,
    inputSchema: withPageIdSchema({
      type: "object",
      properties: {
        appId: { type: "string", description: "应用 ID（从 vue-devtools_get_apps 获取）" },
      },
      required: ["appId"],
    }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_component_tree`,
    action: VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_TREE,
    description: `获取指定页面当前活跃 Vue 应用的组件树。

**何时使用**：
- 了解页面组件层级结构
- 找到目标组件的 nodeId（后续查状态用）
- 排查组件未渲染问题
- 只关心某类组件时用 filter 缩小范围

**返回**：组件树 [{ id, name, children, file, ... }]`,
    inputSchema: withPageIdSchema({
      type: "object",
      properties: {
        filter: { type: "string", description: "按组件名过滤（大小写不敏感的子串匹配），可选" },
      },
    }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_component_state`,
    action: VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_STATE,
    description: `获取指定组件的完整运行时状态。

**何时使用**：
- 排查 props 传值是否正确
- 查看 ref/reactive 响应式数据的当前值
- 检查 computed 计算结果
- 查看 attrs / events / inject / provide / template refs`,
    inputSchema: withPageIdSchema({
      type: "object",
      properties: {
        nodeId: {
          type: "string",
          description: "组件节点 ID（从 vue-devtools_get_component_tree 获取）",
        },
      },
      required: ["nodeId"],
    }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_component_render_code`,
    action: VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_RENDER_CODE,
    description: `获取组件的渲染函数源码。`,
    inputSchema: withPageIdSchema({
      type: "object",
      properties: { nodeId: { type: "string", description: "组件节点 ID" } },
      required: ["nodeId"],
    }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_current_route`,
    action: VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO,
    description: `获取 Vue Router 的当前路由信息。

**何时使用**：
- 排查路由跳转问题
- 查看当前路由 path/params/query/hash
- 确认路由守卫和 matched 记录`,
    inputSchema: withPageIdSchema({ type: "object", properties: {} }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_routes`,
    action: VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO,
    description: `获取 Vue Router 的完整路由表。

**何时使用**：
- 查看所有已注册路由
- 确认路由配置是否正确
- 查看路由嵌套关系`,
    inputSchema: withPageIdSchema({ type: "object", properties: {} }),
  },
];

/** vue-devtools_* 工具名 → 定义（未知名称返回 undefined） */
export function findVueDevtoolsTool(name: string): VueDevtoolsTool | undefined {
  return VUE_DEVTOOLS_TOOLS.find((t) => t.name === name);
}

/** vue-devtools_* 的 tools/list 暴露面（剥掉仅用于路由分发的 action 字段） */
export function vueDevtoolsToolList(): CustomTool[] {
  return VUE_DEVTOOLS_TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}
/** 跨分类不开放（与项目无关的实体/安装类） */
const UNSAFE_CATEGORIES = new Set(["EXTENSIONS", "PWA", "THIRD_PARTY", "WEBMCP"]);

function metaByName(short: string): OfficialToolMeta | undefined {
  return OFFICIAL_TOOL_META.find((m) => m.name === short);
}

/** 官方声明了条件、且属于可开启范围的工具（由官方元数据派生，无手写） */
export function isOfficialExtraTool(short: string): boolean {
  const m = metaByName(short);
  return !!m && m.conditions.length > 0 && !UNSAFE_CATEGORIES.has(m.category);
}

function camelToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** 由官方 conditions 推导所需 flag（experimentalX → --experimental-x，与官方 CLI 一致） */
export function extraToolFlag(short: string): string | undefined {
  const m = metaByName(short);
  if (!m) return undefined;
  const cond = m.conditions.find((c) => c.startsWith("experimental"));
  return cond ? `--${camelToKebab(cond)}` : undefined;
}

/** 可开启的二级工具名单（用于验证与提示） */
export function officialExtraCandidates(): string[] {
  return OFFICIAL_TOOL_META.filter(
    (m) => m.conditions.length > 0 && !UNSAFE_CATEGORIES.has(m.category),
  ).map((m) => m.name);
}

/**
 * 默认暴露的官方工具集：
 * 页面级（pageScoped && 无 conditions && 分类安全）由官方元数据规则推导 + 全局特例 GLOBAL_POLICY。
 */
export function officialDefaultShorts(): string[] {
  const pages = OFFICIAL_TOOL_META.filter(
    (m) => m.pageScoped && m.conditions.length === 0 && !UNSAFE_CATEGORIES.has(m.category),
  )
    .map((m) => m.name)
    .sort();
  return [...pages, ...OFFICIAL_GLOBAL_POLICY];
}

let extraAllowed: ReadonlySet<string> = new Set();
let deniedShorts: ReadonlySet<string> = new Set();

/** 配置工具面范围（默认为纯白名单） */
export function configureToolScope(
  extra: readonly string[] = [],
  deny: readonly string[] = [],
  warn: (msg: string) => void = (msg) => console.warn(msg),
): void {
  const allowedExtra = new Set<string>();
  for (const short of extra) {
    if (isOfficialExtraTool(short)) {
      allowedExtra.add(short);
    } else {
      warn(`chromeMcp.project.tools.extra 已忽略非二级目录工具: ${short}`);
    }
  }
  const known = new Set<string>([
    ...officialDefaultShorts(),
    ...officialExtraCandidates(),
    "current_page",
  ]);
  const denied = new Set<string>();
  for (const short of deny) {
    if (known.has(short)) {
      denied.add(short);
    } else {
      warn(`chromeMcp.project.tools.deny 已忽略未知工具名: ${short}`);
    }
  }
  extraAllowed = allowedExtra;
  deniedShorts = denied;
}

/**
 * 当前生效的官方白名单（短名，含 extra 减 deny）。
 * deny 同时作用于默认面与 extra，保证 tools/list 暴露面与 isAllowedToolName 调用守卫一致。
 */
export function currentOfficialShorts(): string[] {
  const base = officialDefaultShorts().filter((s) => !deniedShorts.has(s));
  const extra = [...extraAllowed].filter(
    (s) => !deniedShorts.has(s) && !officialDefaultShorts().includes(s),
  );
  return [...base, ...extra];
}

/** tools/call 白名单守卫（含 current_page 与动态 extra/deny） */
export function isAllowedToolName(name: string): boolean {
  if (name === displayToolName("current_page")) return true;
  const short = name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
  if (deniedShorts.has(short)) return false;
  if (officialDefaultShorts().includes(short)) return true;
  return extraAllowed.has(short);
}
