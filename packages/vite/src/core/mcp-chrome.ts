/**
 * MCP Chrome 页面相关工具
 *
 * 专注于 Chrome DevTools 页面匹配与解析逻辑
 */
import type { ViteDevServer } from "vite";
import { createLogger } from "@aipanel/core/node";
import type { McpProxy } from "./mcp-proxy";

const log = createLogger("McpChrome");

// ========== Origin 匹配 ==========

/** 从 Vite 服务器解析的所有 URL 中提取项目 origin 列表 */
export function getProjectOrigins(server: ViteDevServer): string[] {
  const local = server.resolvedUrls?.local ?? [];
  const network = server.resolvedUrls?.network ?? [];
  const origins = [...new Set([...local, ...network].map((u) => new URL(u).origin))];
  log.debug("project origins", { origins });
  return origins;
}

/** 判断页面 URL 是否属于项目的某个 origin */
export function isProjectPage(url: string, origins: string[]): boolean {
  return origins.some((origin) => url.startsWith(origin));
}

// ========== 页面解析 ==========

export interface PageInfo {
  pageId: number;
  url: string;
  title: string;
  /** Chrome DevTools 当前选中的页面 */
  selected: boolean;
}

/** 解析 list_pages 返回的文本。格式："56: Title (URL) [selected]" */
export function parseListPages(text: string): PageInfo[] {
  const pages: PageInfo[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^(\d+):\s*(.+?)\s*\((\S+)\)/);
    if (match) {
      pages.push({
        pageId: parseInt(match[1], 10),
        title: match[2].replace(/\s*\.{3}$/, "").trim(),
        url: match[3],
        selected: /\[selected\]/i.test(line),
      });
    }
  }
  return pages;
}

/** 从 evaluate_script 返回的格式化文本中提取 JSON 值 */
export function extractEvalValue(text: string | undefined): string | undefined {
  if (!text) return undefined;
  // evaluate_script 返回格式：
  // "Script ran on page and returned:\n```json\n\"value\"\n```"
  const marker = "```json\n";
  const startIdx = text.indexOf(marker);
  if (startIdx < 0) return text.trim();
  const contentStart = startIdx + marker.length;
  const endIdx = text.indexOf("\n```", contentStart);
  const jsonStr = endIdx < 0 ? text.substring(contentStart) : text.substring(contentStart, endIdx);
  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    return jsonStr.trim();
  }
}

// ========== 页面定位 ==========

type PageIdResult = { ok: true; pageId: number } | { ok: false; error: string };

/**
 * 校验 pageId 是否属于项目页面
 *
 * 调用 list_pages → 过滤项目页面 → 检查 pageId 是否在范围内。
 * 供 MCP 代理层和 Vue DevTools 端点共用。
 */
export async function validatePageId(
  mcp: McpProxy,
  pageId: number,
  projectOrigins: string[],
): Promise<
  | { valid: true; projectPages: PageInfo[] }
  | { valid: false; error: string; projectPages: PageInfo[] }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listResult: any = await mcp.callChromeDevTool("list_pages", {});
  // list_pages 报错（Chrome 未连接等）时明确失败原因，避免误报"pageId 无效"
  if (listResult?.error || !listResult?.result) {
    return {
      valid: false,
      error:
        listResult?.error?.message ?? "无法获取 Chrome 页面列表，请确认 Chrome DevTools 已连接",
      projectPages: [],
    };
  }
  const text: string | undefined = listResult?.result?.content?.[0]?.text;
  const allPages = text ? parseListPages(text) : [];
  const projectPages = allPages.filter((p) => isProjectPage(p.url, projectOrigins));
  const isValid = projectPages.some((p) => p.pageId === pageId);

  if (!isValid) {
    return {
      valid: false,
      error: `pageId ${pageId} 无效或非项目页面，请获取有效页面 ID`,
      projectPages,
    };
  }
  return { valid: true, projectPages };
}

/**
 * 通过 MCP 解析当前页面对应的 Chrome DevTools pageId
 *
 * 策略：
 * 1. list_pages → 解析每行的 "pageId: title (URL)" 格式
 * 2. 仅用 sessionId（_aipanel_pk）匹配，跨导航可靠；不做 URL 降级匹配
 *
 * 失败时返回具体原因，由调用方透传给 Agent。
 */
export async function resolveChromePageId(
  mcp: McpProxy | undefined,
  url: string,
  title: string,
  projectOrigins: string[],
  sessionId?: string,
  pages?: PageInfo[],
  /** Chrome 当前选中的 pageId（调用方传入，避免过滤后丢失非项目页面信息） */
  chromeSelectedPageId?: number,
): Promise<PageIdResult> {
  if (!mcp || !mcp.isRunning) {
    const reason = !mcp ? "MCP 模块未初始化" : "Chrome DevTools MCP 进程未启动";
    log.debug(`resolveChromePageId: ${reason}`);
    return { ok: false, error: reason };
  }
  if (!url) {
    return { ok: false, error: "页面 URL 为空，尚未收到上下文信息" };
  }

  try {
    // 支持传入已解析的页面列表，避免重复 list_pages 调用
    if (!pages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listResult = (await mcp.callChromeDevTool("list_pages", {})) as any;
      const text: string | undefined = listResult?.result?.content?.[0]?.text;
      if (!text) {
        return { ok: false, error: "无法获取 Chrome 页面列表，请确认已打开目标页面" };
      }
      const allPages = parseListPages(text);

      // 保存 Chrome 原始选中页（可能不在项目页面中）
      chromeSelectedPageId = allPages.find((p) => p.selected)?.pageId;

      // 只匹配项目页面，避免遍历无关标签页
      pages = allPages.filter((p) => isProjectPage(p.url, projectOrigins));
    }
    log.debug("resolveChromePageId: list_pages result", {
      pages: pages.map((p) => ({ id: p.pageId, url: p.url, title: p.title.substring(0, 40) })),
      target: { url, title },
    });

    // 仅用 sessionId 匹配（跨导航可靠，遍历所有页面 evaluate_script）
    if (sessionId) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let matchedPageId: number | null = null;

      for (const page of pages) {
        await mcp.callChromeDevTool("select_page", { pageId: page.pageId, bringToFront: false });
        const evalResult: any = await mcp.callChromeDevTool("evaluate_script", {
          function: "() => sessionStorage.getItem('_aipanel_pk')",
        });
        const rawText: string | undefined = evalResult?.result?.content?.[0]?.text;
        const extracted = extractEvalValue(rawText);
        if (extracted === sessionId) {
          matchedPageId = page.pageId;
          break;
        }
      }

      // 恢复 Chrome 原来的选中页，避免副作用影响 selected 标记
      if (chromeSelectedPageId != null && chromeSelectedPageId !== matchedPageId) {
        await mcp.callChromeDevTool("select_page", {
          pageId: chromeSelectedPageId,
          bringToFront: false,
        });
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */

      if (matchedPageId != null) {
        return { ok: true, pageId: matchedPageId };
      }
      return {
        ok: false,
        error: `未能通过会话标识找到目标页面，请确认目标页面已打开`,
      };
    }

    // 无 sessionId：不做 URL 兜底，明确报错
    return {
      ok: false,
      error: `上下文缺少会话标识（_aipanel_pk），无法定位页面，请刷新目标页面后重试`,
    };
  } catch (err) {
    const msg = `MCP 调用失败: ${(err as Error).message}`;
    log.debug("Failed to resolve pageId via MCP", { error: (err as Error).message });
    return { ok: false, error: msg };
  }
}
