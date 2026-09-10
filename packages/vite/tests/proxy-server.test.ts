/**
 * core/proxy-server.ts（startProxyServer）vitest 单元测试。
 *
 * 覆盖目标：构造与监听（端口 0 取实际端口）、桥接脚本直出、HTML 注入（</head>/</body>/追加）、
 * 无桥接脚本时原样透传、非 HTML 响应透传、上游认证 Cookie 与 Origin 改写、
 * 上游不可达时 502、端口占用 EADDRINUSE、WebSocket upgrade 101 转发。
 *
 * stub 策略：用 node 内置 http/net 起本机临时目标服务与代理服务（端口 0 自动分配，
 * 不依赖外网）；afterEach 统一 closeAllConnections + close，避免句柄泄漏。
 * 路径常量引用 @aipanel/core 的 BRIDGE_SCRIPT_PATH。
 */
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BRIDGE_SCRIPT_PATH } from "@aipanel/core";
import { startProxyServer, type ProxyServerResult } from "../src/core/proxy-server";

const proxyServers: ProxyServerResult[] = [];
const targetServers: http.Server[] = [];
/** 跟踪底层连接：upgrade 后的 socket 不随 server.close() 自动释放，需显式销毁 */
const openSockets = new Set<net.Socket>();

function track(server: http.Server): http.Server {
  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
  });
  return server;
}

async function closeServer(server: http.Server) {
  server.closeAllConnections?.();
  await Promise.race([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 300)),
  ]);
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

interface Target {
  url: string;
  port: number;
  requests: Array<{ url?: string; method?: string; headers: http.IncomingHttpHeaders }>;
}

async function startTarget(
  respond: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<Target> {
  const requests: Target["requests"] = [];
  const server = track(
    http.createServer((req, res) => {
      requests.push({ url: req.url, method: req.method, headers: req.headers });
      respond(req, res);
    }),
  );
  targetServers.push(server);
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, port, requests };
}

function startProxy(
  targetUrl: string,
  port: number,
  options: { bridgeScript?: string; webAuthCookie?: string } = {},
): Promise<ProxyServerResult> {
  return startProxyServer(targetUrl, port, { hostname: "127.0.0.1", ...options }).then((result) => {
    proxyServers.push(result);
    track(result.server);
    return result;
  });
}

function get(
  port: number,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
  });
}

function htmlResponse(body: string) {
  return (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  };
}

afterEach(async () => {
  while (proxyServers.length) {
    const { server } = proxyServers.pop()!;
    await closeServer(server);
  }
  while (targetServers.length) {
    await closeServer(targetServers.pop()!);
  }
  for (const socket of openSockets) socket.destroy();
  openSockets.clear();
});

describe("startProxyServer", () => {
  it("监听端口 0 时返回系统分配的实际端口", async () => {
    const target = await startTarget(htmlResponse("<html><head></head><body>hi</body></html>"));
    const result = await startProxy(target.url, 0);
    expect(result.actualPort).toBeGreaterThan(0);
    expect(result.server.listening).toBe(true);
  });

  it("桥接脚本路径直出脚本内容，不转发上游", async () => {
    const target = await startTarget(htmlResponse("<html></html>"));
    const script = "window.__bridge__ = 1;";
    const { actualPort } = await startProxy(target.url, 0, { bridgeScript: script });

    const res = await get(actualPort, BRIDGE_SCRIPT_PATH);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toBe(script);
    expect(target.requests).toHaveLength(0);
  });

  it("HTML 响应在 </head> 前注入桥接脚本并修正 content-length", async () => {
    const target = await startTarget(
      htmlResponse("<html><head><title>t</title></head><body>hi</body></html>"),
    );
    const { actualPort } = await startProxy(target.url, 0, { bridgeScript: "console.log(1)" });

    const res = await get(actualPort, "/");
    expect(res.status).toBe(200);
    expect(res.body).toContain(`<script src="${BRIDGE_SCRIPT_PATH}"></script></head>`);
    expect(res.headers["content-length"]).toBe(String(Buffer.byteLength(res.body)));
  });

  it("无 </head> 时注入到 </body> 前；两者都无时追加到末尾", async () => {
    const bodyOnly = await startTarget(htmlResponse("<div>only body</div></body>"));
    const p1 = await startProxy(bodyOnly.url, 0, { bridgeScript: "x" });
    const r1 = await get(p1.actualPort, "/");
    expect(r1.body).toContain(`<script src="${BRIDGE_SCRIPT_PATH}"></script></body>`);

    const none = await startTarget(htmlResponse("<div>bare</div>"));
    const p2 = await startProxy(none.url, 0, { bridgeScript: "x" });
    const r2 = await get(p2.actualPort, "/");
    expect(r2.body.endsWith(`<script src="${BRIDGE_SCRIPT_PATH}"></script>`)).toBe(true);
  });

  it("未提供桥接脚本时 HTML 原样透传", async () => {
    const html = "<html><head></head><body>hi</body></html>";
    const target = await startTarget(htmlResponse(html));
    const { actualPort } = await startProxy(target.url, 0);

    const res = await get(actualPort, "/");
    expect(res.body).toBe(html);
    expect(res.body).not.toContain(BRIDGE_SCRIPT_PATH);
  });

  it("非 HTML 响应透传状态码与响应体", async () => {
    const target = await startTarget((_req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    const { actualPort } = await startProxy(target.url, 0);

    const res = await get(actualPort, "/api");
    expect(res.status).toBe(201);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.body).toBe('{"ok":true}');
  });

  it("注入 webAuthCookie 并把 Origin 改写为目标 origin", async () => {
    const target = await startTarget((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const { actualPort } = await startProxy(target.url, 0, { webAuthCookie: "sid=abc" });

    await get(actualPort, "/x");
    const seen = target.requests[target.requests.length - 1]!;
    expect(seen.headers.cookie).toBe("sid=abc");
    expect(seen.headers.origin).toBe(`http://127.0.0.1:${target.port}`);
  });

  it("未配置 webAuthCookie 时不注入 cookie 头", async () => {
    const target = await startTarget((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const { actualPort } = await startProxy(target.url, 0);

    await get(actualPort, "/x");
    expect(target.requests[target.requests.length - 1]!.headers.cookie).toBeUndefined();
  });

  it("上游不可达时返回 502 Proxy error", async () => {
    // 先占用再释放一个端口，保证是「无人监听」的地址
    const probe = http.createServer();
    const deadPort = await listen(probe);
    await closeServer(probe);

    const { actualPort } = await startProxy(`http://127.0.0.1:${deadPort}`, 0);
    const res = await get(actualPort, "/");
    expect(res.status).toBe(502);
    expect(res.body).toBe("Proxy error");
  });

  it("端口被占用时以 EADDRINUSE 拒绝", async () => {
    const target = await startTarget(htmlResponse("<html></html>"));
    const first = await startProxy(target.url, 0);
    await expect(
      startProxyServer(target.url, first.actualPort, { hostname: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("WebSocket upgrade 转发上游 101 响应并双向透传数据", async () => {
    const server = track(http.createServer());
    server.on("upgrade", (req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      socket.on("data", (chunk) => socket.write(chunk));
    });
    targetServers.push(server);
    const targetPort = await listen(server);

    const { actualPort } = await startProxy(`http://127.0.0.1:${targetPort}`, 0);

    const socket = net.connect(actualPort, "127.0.0.1");
    const statusLine = await new Promise<string>((resolve, reject) => {
      let buf = "";
      socket.on("data", function onData(chunk: Buffer) {
        buf += chunk.toString();
        if (buf.includes("\r\n\r\n")) {
          socket.off("data", onData);
          resolve(buf.split("\r\n")[0]);
        }
      });
      socket.on("error", reject);
      socket.on("connect", () => {
        socket.write(
          `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${actualPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
        );
      });
      setTimeout(() => reject(new Error("upgrade timeout")), 3000);
    });
    expect(statusLine).toContain("101");

    const echoed = await new Promise<string>((resolve) => {
      socket.once("data", (chunk: Buffer) => resolve(chunk.toString()));
      socket.write("ping");
    });
    expect(echoed).toBe("ping");
    socket.destroy();
  });
});
