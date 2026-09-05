import type { ViteDevServer } from "vite";
import { HOST_EVENTS_API_PATH, type ProviderEvent } from "@aipanel/core";
import { RequestContext } from "@aipanel/core/node";
import type { EndpointContext } from "./types";

/**
 * 宿主侧事件推送端点（dsh-plugin 等 Host 插件 → core → SSE 广播）。
 * 只允许无浏览器 Origin 的服务端请求：携带每轮启动随机令牌（x-aipanel-token 头或 body.token），
 * 通过校验后按 SESSION_EVENT 广播给全部 SSE 客户端（与 provider.subscribeEvents 同一通道）。
 */
export function setupHostEventsEndpoint(server: ViteDevServer, ctx: EndpointContext) {
  server.middlewares.use(HOST_EVENTS_API_PATH, async (req, res) => {
    const reqCtx = new RequestContext(req.method || "GET", HOST_EVENTS_API_PATH);
    res.setHeader("Content-Type", "application/json");

    // 浏览器跨站请求一律拒绝：服务端推送不应带 Origin；非浏览器探测（无 Origin 的 OPTIONS）也放行不了
    if (req.headers.origin) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "forbidden" }));
      reqCtx.end(403);
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      reqCtx.end(204);
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
      reqCtx.end(405);
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("error", () => {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "request error" }));
      reqCtx.end(400);
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body) as { token?: unknown; event?: unknown };
        const expected = ctx.eventsToken;
        if (!expected || data.token !== expected) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "invalid token" }));
          reqCtx.end(403);
          return;
        }
        const event = data.event;
        if (!isProviderEvent(event)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "invalid event" }));
          reqCtx.end(400);
          return;
        }
        ctx.pushProviderEvent(event);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        reqCtx.end(200);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid json" }));
        reqCtx.end(400);
      }
    });
  });
}

/** 轻量校验：只信任 ProviderEvent 三种形态并做必填字段检查（不引入运行时 schema） */
function isProviderEvent(value: unknown): value is ProviderEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type === "session.status" || v.type === "thinking") {
    return typeof v.sessionId === "string" && v.sessionId.length > 0;
  }
  if (v.type === "session.updated") {
    const s = v.session as Record<string, unknown> | undefined;
    return typeof s === "object" && s !== null && typeof s.id === "string";
  }
  if (v.type === "connected") return true;
  return false;
}
