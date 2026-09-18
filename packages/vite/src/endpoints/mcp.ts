import type { ViteDevServer } from "vite";
import type { IncomingMessage } from "node:http";
import type { ChromeProjectOptions, LogFileConfig, PageContext } from "@aipanel/core";
import { MCP_API_PATH } from "@aipanel/core";
import { McpProxy } from "../core/mcp-proxy";
import {
  createLogger,
  getProcessLogBuffer,
  readLogFileTail,
  type ProcessLogEntry,
  type FileLogEntry,
} from "@aipanel/core/node";
import type { PageInfo } from "../core/mcp-chrome";
import {
  parseListPages,
  resolveChromePageId,
  isPageAllowed,
  isProjectPage,
  validatePageId,
} from "../core/mcp-chrome";
import { resolveProjectScope } from "../core/chrome-project";
import {
  CUSTOM_TOOLS,
  findVueDevtoolsTool,
  isAllowedToolName,
  serviceLogToolName,
  VITE_LOGS_TOOL_NAME,
  VUE_DEVTOOLS_PREFIX,
  vueDevtoolsToolList,
  type CustomTool,
} from "../core/mcp-tools";
import { getOfficialProjectTools } from "../core/official-tools";
import { executeAction } from "./vue-devtools";
import { findGitRoot } from "@aipanel/core/node";

const log = createLogger("McpEndpoint");

// Vite 中间件的 response 类型不标准，统一用此别名
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpResponse = any;

export { MCP_API_PATH };

// ========== 端点入口 ==========

export function setupMcpEndpoint(
  server: ViteDevServer,
  mcp: McpProxy,
  getPageContext: () => PageContext,
  logFiles: LogFileConfig[] = [],
  chromeProject?: ChromeProjectOptions,
  /** Vue 项目才注入 vue-devtools 桥；非 Vue 项目既不上架也不路由这些工具，避免模型调用必失败的工具 */
  exposeVueDevtools = true,
) {
  const projectRoot = findGitRoot(process.cwd());
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith(MCP_API_PATH)) return next();

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET") {
      handleGetSse(req, res, mcp);
      return;
    }

    if (req.method === "DELETE") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "POST") {
      const scope = resolveProjectScope(server, chromeProject);
      await handlePost(
        req,
        res,
        mcp,
        scope.origins,
        scope.operationsOrigins,
        scope.includeExtensions,
        getPageContext,
        logFiles,
        projectRoot,
        exposeVueDevtools,
      );
      return;
    }

    next();
  });
}

// ========== 请求处理 ==========

function handleGetSse(req: IncomingMessage, res: McpResponse, mcp: McpProxy) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Mcp-Session-Id": mcp.sessionId,
  });
  res.write(":ok\n\n");
  const keepAlive = setInterval(() => res.write(":ping\n\n"), 15000);
  req.on("close", () => clearInterval(keepAlive));
}

async function handlePost(
  req: IncomingMessage,
  res: McpResponse,
  mcp: McpProxy,
  projectOrigins: string[],
  operationsOrigins: string[],
  includeExtensions: boolean,
  getPageContext: () => PageContext,
  logFiles: LogFileConfig[],
  projectRoot: string,
  exposeVueDevtools: boolean,
) {
  try {
    const body = await readBody(req);
    if (!body) {
      res.writeHead(400);
      res.end("Empty body");
      return;
    }

    const { method, id } = tryParseRequest(body);
    log.debug("MCP request", { method, body: body.substring(0, 150) });

    switch (method) {
      case "tools/list":
        return await handleToolsList(res, id, mcp, logFiles, exposeVueDevtools);
      case "tools/call":
        return await handleToolsCall(
          res,
          id,
          body,
          mcp,
          projectOrigins,
          operationsOrigins,
          includeExtensions,
          getPageContext,
          logFiles,
          projectRoot,
          exposeVueDevtools,
        );
      default:
        // initialize 等 → 直接转发
        return await handleForward(res, body, mcp);
    }
  } catch (e) {
    log.debug("MCP POST error", { error: (e as Error).message });
    sendMcpJson(res, 500, {
      jsonrpc: "2.0",
      error: { code: -32603, message: (e as Error).message },
    });
  }
}

// ========== tools/list ==========

async function handleToolsList(
  res: McpResponse,
  id: number | null,
  mcp: McpProxy,
  logFiles: LogFileConfig[],
  exposeVueDevtools: boolean,
) {
  let official: CustomTool[] = [];
  try {
    // 官方 schema 运行时同步；失败时跳过官方工具（仅自定义/log 工具仍可用）
    official = await getOfficialProjectTools(mcp);
  } catch (e) {
    log.warn("official chrome tools unavailable for tools/list", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  const tools = [
    ...official,
    ...CUSTOM_TOOLS,
    ...(exposeVueDevtools ? vueDevtoolsToolList() : []),
    ...buildServiceLogTools(logFiles),
  ];
  sendMcpJson(res, 200, { jsonrpc: "2.0", id, result: { tools } }, mcp.sessionId);
}

// ========== tools/call 路由 ==========

function handleToolsCall(
  res: McpResponse,
  id: number | null,
  body: string,
  mcp: McpProxy,
  projectOrigins: string[],
  operationsOrigins: string[],
  includeExtensions: boolean,
  getPageContext: () => PageContext,
  logFiles: LogFileConfig[],
  projectRoot: string,
  exposeVueDevtools: boolean,
) {
  const params = tryParseParams(body);
  const toolName = params?.name;
  const args = params?.arguments ?? {};

  // 自定义工具（不需要转发到 chrome-devtools-mcp）
  if (toolName === "chrome-devtools_current_page") {
    return handleGetPageContext(res, id, mcp, operationsOrigins, includeExtensions, getPageContext);
  }

  // vue-devtools 桥（window.__aipanel_vue）只注入在项目页，范围固定为自动项目页；
  // 非 Vue 项目不路由：与 tools/list 暴露面保持一致
  if (toolName?.startsWith(VUE_DEVTOOLS_PREFIX)) {
    if (!exposeVueDevtools) {
      return sendMcpError(res, id, -32601, `Tool not found: ${toolName}`, mcp.sessionId);
    }
    return handleVueDevtoolsTool(res, id, mcp, projectOrigins, toolName, args);
  }

  if (toolName === VITE_LOGS_TOOL_NAME) {
    return handleViteLogsTool(res, id, args, mcp.sessionId);
  }

  if (toolName && isServiceLogTool(toolName, logFiles)) {
    return handleServiceLogsTool(res, id, toolName, args, logFiles, projectRoot, mcp.sessionId);
  }

  // chrome-devtools_ 前缀工具：去掉前缀后即为 chrome-devtools-mcp 底层工具名
  if (toolName?.startsWith("chrome-devtools_")) {
    const mapped = toolName.slice("chrome-devtools_".length);

    if (toolName === "chrome-devtools_list_pages") {
      return handleListPages(res, id, mcp, operationsOrigins, includeExtensions, getPageContext);
    }
    if (toolName === "chrome-devtools_new_page") {
      return handleNewPage(res, id, mcp, args, projectOrigins, operationsOrigins);
    }
    // 工具层白名单守卫：不在白名单内的 chrome-devtools_* 不允许调用
    if (!isAllowedToolName(toolName)) {
      return sendMcpError(res, id, -32601, `Tool not found: ${toolName}`, mcp.sessionId);
    }
    return handleDevTool(
      res,
      id,
      mcp,
      mapped,
      args,
      operationsOrigins,
      includeExtensions,
      projectRoot,
      toolName,
    );
  }

  sendMcpError(res, id, -32601, `Tool not found: ${toolName}`, mcp.sessionId);
}

// ========== 项目页面解析（共享逻辑） ==========

interface ProjectPagesResult {
  filtered: PageInfo[];
  activePageId: number | null;
  /** 定位当前页面失败的原因（activePageId 为 null 时） */
  activePageError?: string;
}

async function resolveProjectPages(
  mcp: McpProxy,
  operationsOrigins: string[],
  includeExtensions: boolean,
  getPageContext: () => PageContext,
): Promise<ProjectPagesResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listResult: any = await mcp.callChromeDevTool("list_pages", {});
  // list_pages 返回 JSON-RPC 错误（Chrome 未连接等）时抛错，与"确实没有页面"区分开
  if (listResult?.error || !listResult?.result) {
    throw new Error(listResult?.error?.message ?? "无法获取 Chrome 页面列表");
  }
  const text: string | undefined = listResult?.result?.content?.[0]?.text;
  const allPages = text ? parseListPages(text) : [];
  const filtered = allPages.filter((p) =>
    isPageAllowed(p.url, operationsOrigins, includeExtensions),
  );

  log.debug("Chrome pages", { total: allPages.length, urls: allPages.map((p) => p.url) });
  log.debug("operations origins", { origins: operationsOrigins });
  log.debug("filtered pages", { count: filtered.length, pageIds: filtered.map((p) => p.pageId) });

  let activePageId: number | null = null;
  let activePageError: string | undefined;
  if (filtered.length > 0) {
    const pc = getPageContext();
    const chromeSelectedPageId = allPages.find((p) => p.selected)?.pageId;
    const resolved = await resolveChromePageId(
      mcp,
      pc.url,
      pc.title,
      operationsOrigins,
      pc.sessionId,
      filtered,
      chromeSelectedPageId,
    );
    activePageId = resolved.ok ? resolved.pageId : null;
    if (!resolved.ok) activePageError = resolved.error;
  }

  return { filtered, activePageId, activePageError };
}

// ========== chrome-devtools_list_pages ==========

async function handleListPages(
  res: McpResponse,
  id: number | null,
  mcp: McpProxy,
  operationsOrigins: string[],
  includeExtensions: boolean,
  getPageContext: () => PageContext,
) {
  try {
    const { filtered, activePageId } = await resolveProjectPages(
      mcp,
      operationsOrigins,
      includeExtensions,
      getPageContext,
    );

    if (filtered.length === 0) {
      sendMcpResult(
        res,
        id,
        "暂无可用页面（项目页或 allowOrigins 白名单页），请先在浏览器中打开相应页面",
        mcp.sessionId,
      );
      return;
    }

    const pageList = filtered.map((p) => ({
      pageId: p.pageId,
      url: p.url,
      title: p.title,
      active: activePageId != null ? p.pageId === activePageId : false,
      selected: p.selected,
    }));

    sendMcpResult(res, id, JSON.stringify(pageList, null, 2), mcp.sessionId);
  } catch (e) {
    log.debug("handleListPages error", { error: (e as Error).message });
    sendMcpError(res, id, -32603, `MCP 调用失败: ${(e as Error).message}`, mcp.sessionId);
  }
}

// ========== chrome-devtools_current_page ==========

async function handleGetPageContext(
  res: McpResponse,
  id: number | null,
  mcp: McpProxy,
  operationsOrigins: string[],
  includeExtensions: boolean,
  getPageContext: () => PageContext,
) {
  try {
    const { filtered, activePageId, activePageError } = await resolveProjectPages(
      mcp,
      operationsOrigins,
      includeExtensions,
      getPageContext,
    );

    if (filtered.length === 0) {
      sendMcpResult(
        res,
        id,
        "暂无可用页面（项目页或 allowOrigins 白名单页），请先在浏览器中打开相应页面",
        mcp.sessionId,
      );
      return;
    }

    const pc = getPageContext();

    // 无法定位 pageId 时透出原因，避免 Agent 拿到 pageId: null 无从下手
    if (activePageId == null) {
      sendMcpResult(
        res,
        id,
        `无法定位当前页面对应的 pageId：${activePageError ?? "未匹配到已打开的页面"}

当前页面上下文：${pc.title} (${pc.url})

请刷新目标页面后重试；或使用 chrome-devtools_list_pages 获取页面 ID 后直接操作。`,
        mcp.sessionId,
      );
      return;
    }

    const activePage = filtered.find((p) => p.pageId === activePageId);

    sendMcpResult(
      res,
      id,
      JSON.stringify(
        {
          url: activePage?.url ?? pc.url,
          title: activePage?.title ?? pc.title,
          pageId: activePageId,
        },
        null,
        2,
      ),
      mcp.sessionId,
    );
  } catch (e) {
    log.debug("handleGetPageContext error", { error: (e as Error).message });
    sendMcpError(res, id, -32603, `MCP 调用失败: ${(e as Error).message}`, mcp.sessionId);
  }
}

// ========== chrome-devtools_new_page ==========

async function handleNewPage(
  res: McpResponse,
  id: number | null,
  mcp: McpProxy,
  args: Record<string, unknown>,
  projectOrigins: string[],
  operationsOrigins: string[],
) {
  try {
    const url = args["url"];
    if (typeof url !== "string" || url.trim().length === 0) {
      sendMcpError(res, id, -32000, "缺少 url 参数，请提供要打开的页面 URL", mcp.sessionId);
      return;
    }
    if (!isProjectPage(url, operationsOrigins)) {
      sendMcpError(
        res,
        id,
        -32000,
        `不允许打开该页面: ${url}。仅允许项目页或 allowOrigins 白名单页 (${operationsOrigins.join(", ")})`,
        mcp.sessionId,
      );
      return;
    }

    // 项目页：全局只开一个；非项目允许 URL 不限数量，直接打开
    if (isProjectPage(url, projectOrigins)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listResult: any = await mcp.callChromeDevTool("list_pages", {});
      if (listResult?.error || !listResult?.result) {
        sendMcpError(
          res,
          id,
          -32000,
          `无法确认当前项目页面状态，为避免重复打开，请确认 Chrome DevTools 已连接后重试`,
          mcp.sessionId,
        );
        return;
      }
      const text: string | undefined = listResult?.result?.content?.[0]?.text;
      const projectOpen = (text ? parseListPages(text) : []).filter((p) =>
        isProjectPage(p.url, projectOrigins),
      );
      if (projectOpen.length > 0) {
        const existing = projectOpen
          .map((p) => `- ${p.title} (${p.url}) [pageId: ${p.pageId}]`)
          .join("\n");
        sendMcpResult(
          res,
          id,
          `当前项目已有打开的页面，无需重复打开。\n\n已打开的页面：\n${existing}\n\n如需操作现有页面，请使用 chrome-devtools_list_pages 获取页面 ID，再配合其他 chrome-devtools_* 工具使用。`,
          mcp.sessionId,
        );
        return;
      }
    }
    // 转发到 chrome-devtools-mcp new_page（固定后台打开，不抢焦点）
    const forwardBody = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "new_page", arguments: { ...args, background: true } },
    });

    const responseText = await mcp.forward(forwardBody);
    log.debug("MCP response", { tool: "new_page", response: responseText.substring(0, 100) });
    sendMcpJson(res, 200, responseText, mcp.sessionId);
  } catch (e) {
    log.debug("handleNewPage error", { error: (e as Error).message });
    sendMcpError(res, id, -32603, `MCP 调用失败: ${(e as Error).message}`, mcp.sessionId);
  }
}

// ========== 其他 chrome-devtools_* 工具 ==========

async function handleDevTool(
  res: McpResponse,
  id: number | null,
  mcp: McpProxy,
  mapped: string,
  args: Record<string, unknown>,
  operationsOrigins: string[],
  includeExtensions: boolean,
  projectRoot: string,
  toolName?: string,
) {
  try {
    // 提取并校验 pageId
    const pageId = args["pageId"];
    if (typeof pageId !== "number") {
      sendMcpError(res, id, -32000, "缺少 pageId 参数，请先获取页面 ID", mcp.sessionId);
      return;
    }

    // 实时验证 pageId 是否在可操作范围内
    const validation = await validatePageId(mcp, pageId, operationsOrigins, includeExtensions);

    log.debug("handleDevTool validation", {
      pageId,
      allowedPages: validation.allowedPages.length,
      allowedPageIds: validation.allowedPages.map((p) => p.pageId),
      origins: operationsOrigins,
      isValid: validation.valid,
    });

    if (!validation.valid) {
      sendMcpError(res, id, -32000, validation.error, mcp.sessionId);
      return;
    }

    // chrome-devtools_navigate_page: 校验跳转目标 URL 是否属于本项目。
    // 官方 type 可选、缺省按 url 处理，因此 type 缺失时也要按 url 校验，避免绕过。
    if (toolName === "chrome-devtools_navigate_page") {
      const navType = typeof args["type"] === "string" ? (args["type"] as string) : "url";
      if (navType === "url") {
        const targetUrl = args["url"];
        if (typeof targetUrl === "string" && targetUrl.length > 0) {
          if (!isProjectPage(targetUrl, operationsOrigins)) {
            sendMcpError(
              res,
              id,
              -32000,
              `不允许跳转到该页面: ${targetUrl}。仅允许导航到项目页或 allowOrigins 白名单页 (${operationsOrigins.join(", ")})`,
              mcp.sessionId,
            );
            return;
          }
        }
      }
    }

    // 选中目标页面再转发
    await mcp.callChromeDevTool("select_page", { pageId, bringToFront: false });

    // 转发到 chrome-devtools-mcp（代理层已显式关闭 pageIdRouting，剥离 pageId，底层工具不认识此参数）
    const forwardArgs = { ...args };
    delete forwardArgs["pageId"];
    const forwardBody = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: mapped, arguments: forwardArgs },
    });

    const responseText = await mcp.forward(forwardBody);
    log.debug("MCP response", { mapped, response: responseText.substring(0, 100) });
    sendMcpJson(res, 200, responseText, mcp.sessionId);
  } catch (e) {
    log.debug("handleDevTool error", { error: (e as Error).message, mapped });
    sendMcpError(res, id, -32603, `MCP 调用失败: ${(e as Error).message}`, mcp.sessionId);
  }
}

// ========== Vue DevTools 工具 ==========

async function handleVueDevtoolsTool(
  res: McpResponse,
  id: number | null,
  mcp: McpProxy,
  projectOrigins: string[],
  toolName: string,
  args: Record<string, unknown>,
) {
  try {
    // 单一来源：name/description/schema 与 action 同出自 core/mcp-tools 的 VUE_DEVTOOLS_TOOLS
    const tool = findVueDevtoolsTool(toolName);
    if (!tool) {
      sendMcpError(res, id, -32601, `Tool not found: ${toolName}`, mcp.sessionId);
      return;
    }

    const result = await executeAction(tool.action, args, mcp, projectOrigins);

    switch (toolName) {
      case "vue-devtools_set_active_app":
        sendMcpResult(res, id, `已切换到应用 ${args["appId"]}`, mcp.sessionId);
        return;
      case "vue-devtools_get_current_route":
      case "vue-devtools_get_routes": {
        const parsed = typeof result === "string" ? parseJsonSafe(result) : result;
        const data = (parsed ?? {}) as { currentRoute?: unknown; routes?: unknown };
        const value =
          toolName === "vue-devtools_get_current_route"
            ? (data.currentRoute ?? null)
            : (data.routes ?? null);
        sendMcpResult(res, id, JSON.stringify(value), mcp.sessionId);
        return;
      }
      case "vue-devtools_get_component_render_code":
        sendMcpResult(
          res,
          id,
          typeof result === "string" ? result : JSON.stringify(result),
          mcp.sessionId,
        );
        return;
      default:
        sendMcpResult(res, id, JSON.stringify(result), mcp.sessionId);
        return;
    }
  } catch (e) {
    log.debug("handleVueDevtoolsTool error", { error: (e as Error).message });
    sendMcpError(res, id, -32603, `Vue DevTools 调用失败: ${(e as Error).message}`, mcp.sessionId);
  }
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ========== Vite 进程日志工具 ==========

function handleViteLogsTool(
  res: McpResponse,
  id: number | null,
  args: Record<string, unknown>,
  sessionId: string,
) {
  const { level, limit, source } = args;
  const buffer = getProcessLogBuffer();
  const logs = buffer.getLogs({
    level: parseProcessLevelFilter(level),
    limit: typeof limit === "number" && limit >= 1 ? limit : 50,
    source:
      typeof source === "string" && source ? (source as ProcessLogEntry["source"]) : undefined,
  });

  if (logs.length === 0) {
    sendMcpResult(
      res,
      id,
      `当前没有符合条件的日志（缓冲区共 ${buffer.size()} 条）。

建议：
- 不指定参数获取所有日志
- 使用 level=error,warn 获取错误和警告`,
      sessionId,
    );
    return;
  }

  const formattedLogs = logs
    .map((entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const levelIcon =
        entry.level === "error"
          ? "❌"
          : entry.level === "warn"
            ? "⚠️"
            : entry.level === "info"
              ? "ℹ️"
              : "";
      return `${time} ${levelIcon} ${entry.message}`;
    })
    .join("\n");

  sendMcpResult(
    res,
    id,
    `Vite 开发服务器日志（${logs.length}/${buffer.size()} 条）：

${formattedLogs}`,
    sessionId,
  );
}

function parseProcessLevelFilter(level: unknown): ProcessLogEntry["level"][] | undefined {
  if (typeof level !== "string" || !level.trim()) return undefined;
  const levels = level
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean) as ProcessLogEntry["level"][];
  return levels.length ? levels : undefined;
}

// ========== 服务日志文件工具 ==========

function buildServiceLogTools(logFiles: LogFileConfig[]): CustomTool[] {
  return logFiles.map((cfg) => ({
    name: serviceLogToolName(cfg.name),
    description: `获取 ${cfg.name} 的日志。

**何时使用此工具**：
${cfg.description}

**日志内容**：
- 来自日志文件 ${cfg.path} 的实时日志
- 默认返回最近 200 行日志`,
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          description:
            "日志级别过滤：error(错误)、warn(警告)、info(信息)。多个用逗号分隔，如 'error,warn'",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 50,
          description: "返回条数，默认 50，最大 200",
        },
      },
    },
  }));
}

function isServiceLogTool(toolName: string, logFiles: LogFileConfig[]): boolean {
  return logFiles.some((cfg) => serviceLogToolName(cfg.name) === toolName);
}

async function handleServiceLogsTool(
  res: McpResponse,
  id: number | null,
  toolName: string,
  args: Record<string, unknown>,
  logFiles: LogFileConfig[],
  projectRoot: string,
  sessionId: string,
) {
  try {
    const cfg = logFiles.find((c) => serviceLogToolName(c.name) === toolName);
    if (!cfg) {
      sendMcpError(res, id, -32601, `Tool not found: ${toolName}`, sessionId);
      return;
    }

    const { level, limit } = args;
    const requestedLimit = typeof limit === "number" ? limit : 50;

    const entries = await readLogFileTail({
      name: cfg.name,
      filePath: cfg.path,
      projectRoot,
      lines: Math.max(requestedLimit * 3, 500),
      level: parseFileLevelFilter(level),
      limit: requestedLimit,
    });

    if (entries.length === 0) {
      sendMcpResult(
        res,
        id,
        `当前没有符合条件的日志。

建议：
- 不指定参数获取所有日志
- 使用 level=error,warn 获取错误和警告`,
        sessionId,
      );
      return;
    }

    const formattedLogs = entries
      .map((entry: FileLogEntry) => {
        const levelIcon = entry.level === "error" ? "❌" : entry.level === "warn" ? "⚠️" : "ℹ️";
        return `${levelIcon} ${entry.message}`;
      })
      .join("\n");

    sendMcpResult(
      res,
      id,
      `${cfg.name} 日志（${entries.length} 条）：

${formattedLogs}`,
      sessionId,
    );
  } catch (e) {
    log.debug("handleServiceLogsTool error", { error: (e as Error).message });
    sendMcpError(res, id, -32603, `读取日志失败: ${(e as Error).message}`, sessionId);
  }
}

function parseFileLevelFilter(level: unknown): ("info" | "warn" | "error")[] | undefined {
  if (typeof level !== "string" || !level.trim()) return undefined;
  const levels = level
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean) as ("info" | "warn" | "error")[];
  return levels.length ? levels : undefined;
}

// ========== 其他方法（initialize 等） ==========

async function handleForward(res: McpResponse, body: string, mcp: McpProxy) {
  try {
    const responseText = await mcp.forward(body);
    sendMcpJson(res, 200, responseText, mcp.sessionId);
  } catch (e) {
    log.debug("handleForward error", { error: (e as Error).message });
    sendMcpError(res, null, -32603, `MCP 调用失败: ${(e as Error).message}`, mcp.sessionId);
  }
}

// ========== 响应工具 ==========

/** 发送 MCP 成功响应 { jsonrpc, id, result: { content: [{ type: "text", text }] } } */
function sendMcpResult(res: McpResponse, id: number | null, text: string, sessionId: string) {
  sendMcpJson(
    res,
    200,
    {
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text }] },
    },
    sessionId,
  );
}

/** 发送 MCP 错误响应 { jsonrpc, id, error: { code, message } } */
function sendMcpError(
  res: McpResponse,
  id: number | null,
  code: number,
  message: string,
  sessionId: string,
) {
  sendMcpJson(
    res,
    200,
    {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    },
    sessionId,
  );
}

function sendMcpJson(
  res: McpResponse,
  statusCode: number,
  body: Record<string, unknown> | string,
  sessionId?: string,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  res.writeHead(statusCode, headers);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

// ========== 请求体解析 ==========

function readBody(req: IncomingMessage, maxSize = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > maxSize) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function tryParseRequest(body: string): { method: string; id: number | null } {
  try {
    const data = JSON.parse(body);
    return { method: data.method || "unknown", id: data.id ?? null };
  } catch {
    return { method: "unknown", id: null };
  }
}

function tryParseParams(
  body: string,
): { name: string; arguments?: Record<string, unknown> } | null {
  try {
    return JSON.parse(body).params ?? null;
  } catch {
    return null;
  }
}
