/**
 * Chrome DevTools 工具层的项目维度元数据与自定义工具。
 *
 * 模型可见的 chrome-devtools_* 工具 = 官方 chrome-devtools-mcp 工具的白名单子集
 * （schema/描述运行时同步自官方 tools/list，见 official-tools.ts）+ 本项目自定义工具。
 * 工具层限制（白名单、必填 pageId、仅项目页）由本文件 + endpoints/mcp.ts 的 tools/call 共同执行。
 */

import {
  VUE_DEVTOOLS_ACTIONS,
  VUE_DEVTOOLS_TIMELINE_DEFAULTS,
  VUE_DEVTOOLS_TIMELINE_INCLUDES,
  VUE_DEVTOOLS_TIMELINE_LAYERS,
  type VueDevtoolsAction,
} from "@aipanel/core";
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
 *
 * 描述写法（description 是模型唯一能看到的说明书，会随每次请求注入，所以既要准也要省）：
 * 1. 第一行一句话说清"给什么"；
 * 2. **何时使用**：正向场景 + 与相邻工具的分工；
 * 3. **返回**：字段与形态（够推理即可，不重复 inputSchema 的参数说明）；
 * 4. **注意**：会误导判断的边界必须写明"缺失 ≠ 没有 / ≠ 0"；
 * 5. 只承诺实现里真有的能力——被裁剪/丢弃的数据要显式说明，不能让模型按描述去查一个永远为空的东西。
 */
export interface VueDevtoolsTool extends CustomTool {
  /** 页面桥后端 action（endpoints/vue-devtools.ts executeAction） */
  action: VueDevtoolsAction;
}

export const VUE_DEVTOOLS_TOOLS: readonly VueDevtoolsTool[] = [
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_apps`,
    action: VUE_DEVTOOLS_ACTIONS.GET_APPS,
    description: `列出页面里的 Vue 应用实例（微前端 / 多实例场景用）。

**何时使用**：
- 页面上不止一个 Vue 应用，先确认要查哪个
- 调 set_active_app 前取可用 appId

**返回**：[{ id, name }]，id 供 set_active_app 使用。`,
    inputSchema: withPageIdSchema({ type: "object", properties: {} }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}set_active_app`,
    action: VUE_DEVTOOLS_ACTIONS.TOGGLE_APP,
    description: `切换后续 vue-devtools_* 组件/路由工具操作的活跃 Vue 应用。

**何时使用**：
- get_apps 显示多个应用，而组件树/状态查的是另一个
- 微前端子应用里组件怎么都查不到（很可能活跃应用不是它）

**注意**：只改后续查询的目标应用，不改页面本身。`,
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
    description: `获取活跃 Vue 应用的组件树（每个节点带 nodeId 与源码路径）。

**何时使用**：
- 取组件的 nodeId：get_component_state / get_component_render_code 都要它
- 了解组件层级；确认某个组件是否渲染、被谁渲染
- 由 file 反查某个 .vue 文件对应哪个组件

**返回**：组件节点数组 [{ id, name, uid, file, children, ... }]
- id 就是 nodeId（形如 app-1:57；根节点为 app-1:root）
- file 是源码路径；空字符串表示取不到（框架内置或匿名组件）

**filter 的真实语义（容易踩）**：
- **大小写敏感**：内部用小写化的组件名（classify / kebabize 两种形态）匹配，**传全小写最稳**
  （filter:"App" 返回空，filter:"app" 才有结果）
- 命中组件会连带返回它整个子树（后代不要求匹配）
- 匹配的是组件名，不是 file 路径

**注意**：树可能很大（UI 库内置组件占比很高），拿不准就先 filter。`,
    inputSchema: withPageIdSchema({
      type: "object",
      properties: {
        filter: { type: "string", description: "按组件名过滤（见描述：大小写敏感，传全小写最稳）" },
      },
    }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_component_state`,
    action: VUE_DEVTOOLS_ACTIONS.GET_COMPONENT_STATE,
    description: `获取指定组件的运行时状态。

**何时使用**：
- 核对 props 传值、ref/reactive 当前值、computed 结果
- 排查"值没更新"：先看状态，再用 get_timeline 看是哪次渲染/更新引起的

**返回**：{ state: { <分类>: { <字段>: { value, type? } } } }
- 分类随组件而定，常见：props / setup / setup (other) / computed / data / attrs（Vuex 项目还有 vuex bindings）
- 值可能被裁剪成**占位记号**，别当成真实值：__undefined__（该值是 undefined，即未传/未设置）、[Function]（函数）、<max depth>（超出裁剪深度）、<前缀... (N chars)>（长字符串截断）；Vue 内部对象（dep/subs/effect 等）直接丢弃

**注意（别把"看不到"当成"不存在"）**：provided / injected / event listeners / template refs
**被刻意裁掉以省 token**，永远查不到；要确认这些请用 chrome-devtools_evaluate_script。`,
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
    description: `获取组件渲染函数的源码（编译产物，用来看模板最终生成了什么）。

**何时使用**：
- 模板行为反直觉，需要看编译结果
- 配合 get_component_tree 的 file 一起定位源码

**参数**：nodeId 来自 get_component_tree（write-类工具改完代码后，nodeId 可能因 HMR 失效，需重新取）。`,
    inputSchema: withPageIdSchema({
      type: "object",
      properties: { nodeId: { type: "string", description: "组件节点 ID" } },
      required: ["nodeId"],
    }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_current_route`,
    action: VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO,
    description: `获取当前路由（含 path/params/query/hash/matched）。

**何时使用**：
- 排查路由跳转是否发生、跳到了哪、参数对不对
- 看当前路由命中了哪些路由记录（matched，含各自 meta）

**返回**：当前路由对象；与 get_routes 的区别是这里只给当前这一条。`,
    inputSchema: withPageIdSchema({ type: "object", properties: {} }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_routes`,
    action: VUE_DEVTOOLS_ACTIONS.GET_ROUTER_INFO,
    description: `获取完整路由表（vue-router 的 getRoutes() 输出，已展开为**扁平**记录列表）。

**何时使用**：
- 确认路由是否注册、path / name / meta 是否正确
- 需要路由清单来判断某个 path 是否可达

**返回**：路由记录数组 [{ path, name, meta, children, redirect, aliasOf, props, components, ... }]
- 嵌套路由已展开：children 通常为空，每层各占一条记录
- 元数据在 meta（title / lang / prefix 等）；值同样会出现 __undefined__ 等占位记号`,
    inputSchema: withPageIdSchema({ type: "object", properties: {} }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}get_timeline`,
    action: VUE_DEVTOOLS_ACTIONS.GET_TIMELINE,
    description: `获取页面最近一段的 Vue 运行时事件时间线：组件渲染耗时、组件事件、路由跳转、agent 标记。

**何时使用**：
- 页面卡顿/白屏/内容不更新，定位是哪个组件的哪次渲染引起
- 刚做完一次交互，想看它引发了哪些组件重渲染、各耗时多少
- 排查过度渲染：某组件在窗口内渲染/更新了几次、总耗时多少

**两条最常用的路径**：
- 现象已经发生（用户说"刚才很卡"）→ 直接 get_timeline
- 要精确归因自己的动作 → mark_timeline → 触发动作 → get_timeline({ sinceMark })
- 全程常驻采集，不需要 start；整页刷新会清空缓冲，SPA 路由切换保留

**返回**：
- summary：perf（按组件的次数/总耗时/最慢几次）、lifecycle（累计增删改）、emit、navigate、agent
- records：明细（t 为相对现在的毫秒、负数=过去；dur；nodeId；file）
- buffer：容量、丢弃、窗口完整性、耗时缺失计数
- omitted + notes：明细被裁剪的去向，以及"为什么缺数据"的自然语言说明

**读数契约（缺失 ≠ 没有，更 ≠ 0ms）**：
- 明细不是全量：默认只留耗时 ≥ minDurationMs 的渲染，再受 limit 与体积上限约束。**判断"明细是否完整"请看 detailComplete**（= omitted 三项全为 0）；truncated 只表示被 limit/体积裁剪过，slow 档的阈值过滤不计入它。**次数与耗时一律以 summary 为准**
- buffer.windowTruncated=true：窗口起点之前的数据已被缓冲淘汰，窗口内不完整
- buffer.unpaired / prunedStarts > 0：这些渲染没配到完整 start/end，耗时是**缺失**，不要读成很快
- 没有 nodeId：解析不出可靠组件 id，别猜也别复用别的 id
- records.data（emit 参数等）与 get_component_state 用同一套裁剪，占位记号含义相同
- lifecycle 的 added/updated/removed 是自页面加载起的**全页累计**（不受 windowMs，也不受 component 过滤；只有 byComponent 受过滤）；byComponent 只覆盖最近活跃的 200 个组件，componentEvictions > 0 表示有组件被淘汰出该表
- include: "summary" 时 records 按请求为空、detailComplete 恒 true（这是"按请求口径"，不代表窗口内没有事件，次数看 summary）

**下一步**：拿到 nodeId → get_component_state；拿到 file → 直接去改那个文件。

**不要用它**：查网络请求或 console（用 chrome-devtools_*）；当全量事件流用（明细有阈值与上限）。`,
    inputSchema: withPageIdSchema({
      type: "object",
      properties: {
        windowMs: {
          type: "number",
          description: `回溯窗口（毫秒），默认 ${VUE_DEVTOOLS_TIMELINE_DEFAULTS.windowMs}`,
          default: VUE_DEVTOOLS_TIMELINE_DEFAULTS.windowMs,
        },
        sinceMark: {
          type: "string",
          description: "从最近一次 mark_timeline 的标记开始（优先于 windowMs）",
        },
        layers: {
          type: "array",
          items: { type: "string", enum: [...VUE_DEVTOOLS_TIMELINE_LAYERS] },
          description: "只看指定层，默认全部（lifecycle 只影响摘要）",
        },
        minDurationMs: {
          type: "number",
          description: `组件渲染明细的耗时下限（毫秒），默认 ${VUE_DEVTOOLS_TIMELINE_DEFAULTS.minDurationMs}；16 约等于只看掉帧`,
          default: VUE_DEVTOOLS_TIMELINE_DEFAULTS.minDurationMs,
        },
        component: {
          type: "string",
          description:
            "按组件名子串过滤（大小写不敏感）明细与 byComponent；路由与标记不受影响，lifecycle 的 added/updated/removed 仍是全页累计",
        },
        include: {
          type: "string",
          enum: [...VUE_DEVTOOLS_TIMELINE_INCLUDES],
          description: "summary 只给摘要、slow 只给慢的明细（默认）、all 给窗口内全部明细",
          default: VUE_DEVTOOLS_TIMELINE_DEFAULTS.include,
        },
        limit: {
          type: "integer",
          description: `明细条数上限：all 档是总条数上限；slow 档是「最慢的 perf」与「其它层」各自的上限（总条数最多 2×limit）。默认 ${VUE_DEVTOOLS_TIMELINE_DEFAULTS.limit}，最大 ${VUE_DEVTOOLS_TIMELINE_DEFAULTS.maxLimit}`,
          default: VUE_DEVTOOLS_TIMELINE_DEFAULTS.limit,
        },
      },
    }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}mark_timeline`,
    action: VUE_DEVTOOLS_ACTIONS.MARK_TIMELINE,
    description: `在时间线上插一个标记，把"我接下来要做的动作"和它引发的事件对齐（不清空历史）。

**何时使用**：
- 准备用 chrome-devtools_click / fill 触发操作，想只看这次操作引起的变化
- 一次调查里要多个检查点（"点击前""提交后"）

**用法**：mark_timeline({ label }) → 执行动作 → get_timeline({ sinceMark: 返回的 markId })

**返回**：{ markId, buffered }。markId 传给 sinceMark；buffered 是当前缓冲条数。`,
    inputSchema: withPageIdSchema({
      type: "object",
      properties: {
        label: { type: "string", description: "标记名称，例如“点击提交按钮”" },
      },
      required: ["label"],
    }),
  },
  {
    name: `${VUE_DEVTOOLS_PREFIX}clear_timeline`,
    action: VUE_DEVTOOLS_ACTIONS.CLEAR_TIMELINE,
    description: `清空时间线缓冲并重置累计计数——等价于"从现在开始录"（没有 start/stop 状态机）。

**何时使用**：
- 只想看本次操作引起的事件，不要混入页面之前的活动
- get_timeline 报 buffer.dropped 很大（缓冲被高频活动塞满）后，重开一个干净窗口

**返回**：{ cleared, marks }。

**注意**：不可撤销；清空后此前的事件不再可查。想保留历史又要新边界，请用 mark_timeline。`,
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
