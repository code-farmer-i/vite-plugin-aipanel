import http from "http";
import { BRIDGE_SCRIPT_PATH } from "@aipanel/core";
import { createLogger } from "@aipanel/core/node";

const log = createLogger("ProxyServer");

export interface ProxyServerOptions {
  /** 注入到 HTML 的 Provider 侧桥接脚本（Provider 资产） */
  bridgeScript?: string;
  /** 绑定地址，需与端口检查使用的地址族一致，避免 IPv4/IPv6 不匹配 */
  hostname?: string;
  /**
   * Provider Web 服务的 browser-session 认证 Cookie（dsh 0.1.2+ 需要）。
   * 代理在转发每个请求（含 WebSocket 升级）时把该 Cookie 注入到上游请求头，
   * 使浏览器免于亲自换取/携带会话 Cookie（避免跨端口/跨站 SameSite 限制），
   * 同时通过上游 /api 的 browser-auth 门禁。
   */
  webAuthCookie?: string;
}

export interface ProxyServerResult {
  server: http.Server;
  actualPort: number;
}

export function startProxyServer(
  targetUrl: string,
  port: number,
  options: ProxyServerOptions = {},
): Promise<ProxyServerResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const bridgeScript = options.bridgeScript ?? "";
    const webAuthCookie = options.webAuthCookie ?? "";

    // 使用 keep-alive agent 复用连接，避免频繁创建/销毁 TCP 连接导致偶发 502
    const agent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 0,
    });

    const server = http.createServer((req, res) => {
      if (req.url === BRIDGE_SCRIPT_PATH) {
        const body = bridgeScript;
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }

      const requestOptions: http.RequestOptions = {
        agent,
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: target.host,
          // 注入 Provider Web 服务的 browser-session 认证 Cookie：代理作为已认证客户端
          // 替 iframe 里的浏览器完成 dsh 0.1.2+ 的会话认证（浏览器无需换取/携带该 Cookie）。
          ...(webAuthCookie ? { cookie: webAuthCookie } : {}),
          // 上游（如 dsh 的 trust fence）校验 Origin 必须匹配自身 origin；
          // 页面经代理访问时浏览器发的 Origin 是代理端口，须改写为目标 origin 否则 403
          origin: `http://${target.host}`,
          "accept-encoding": "identity",
        },
        timeout: 0,
      };

      const proxyReq = http.request(requestOptions, (proxyRes) => {
        const rawContentType = proxyRes.headers["content-type"];
        const contentType = Array.isArray(rawContentType)
          ? (rawContentType[0] ?? "")
          : (rawContentType ?? "");

        if (contentType.includes("text/html")) {
          const chunks: Buffer[] = [];

          proxyRes.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          proxyRes.on("end", () => {
            let body = Buffer.concat(chunks).toString("utf-8");

            if (body.match(/<\/head>/i)) {
              body = body.replace(
                /<\/head>/i,
                `<script src="${BRIDGE_SCRIPT_PATH}"></script></head>`,
              );
            } else if (body.match(/<\/body>/i)) {
              body = body.replace(
                /<\/body>/i,
                `<script src="${BRIDGE_SCRIPT_PATH}"></script></body>`,
              );
            } else {
              body += `<script src="${BRIDGE_SCRIPT_PATH}"></script>`;
            }

            const headers: http.OutgoingHttpHeaders = {};
            for (const [key, value] of Object.entries(proxyRes.headers)) {
              if (
                value !== undefined &&
                key !== "content-encoding" &&
                key !== "transfer-encoding" &&
                key !== "content-length"
              ) {
                headers[key] = value;
              }
            }
            headers["content-length"] = Buffer.byteLength(body);

            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(body);
          });
        } else {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        }
      });

      proxyReq.on("error", (err) => {
        log.error("Proxy error", { error: err.message, url: req.url });
        res.writeHead(502);
        res.end("Proxy error");
      });

      proxyReq.on("socket", (socket) => {
        socket.setTimeout(0);
      });

      req.on("socket", (socket) => {
        socket.setTimeout(0);
      });

      req.pipe(proxyReq);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    // WebSocket 升级转发：dsh 页面经代理连接 ws://host:port/api/remote.mux（0.1.2+ 的
    // Remote 流 mux，workspace/follow、session/follow、$events 都走这里）时，
    // 须把 upgrade 请求转发到目标并把 101 响应回给浏览器，否则 WS 直接失败。
    server.on("upgrade", (req, clientSocket, head) => {
      const upgradeOptions: http.RequestOptions = {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        // upgrade 不复用 keep-alive 连接池
        agent: false,
        headers: {
          ...req.headers,
          host: target.host,
          // 与 HTTP 分支一致：注入认证 Cookie，通过 dsh 0.1.2+ 的 browser-auth 门禁
          ...(webAuthCookie ? { cookie: webAuthCookie } : {}),
          // 与 HTTP 分支一致：改写 Origin 为目标 origin，通过 dsh 的 trust fence
          origin: `http://${target.host}`,
        },
      };
      const proxyReq = http.request(upgradeOptions);
      proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
        // 解除 http 模块对 socket 的接管，避免吞掉后续数据
        proxySocket.removeAllListeners("data");
        (proxySocket as import("net").Socket).setTimeout(0);
        (clientSocket as import("net").Socket).setTimeout(0);
        // 把目标返回的 101 响应头原样写回浏览器
        const headBuf = [
          `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`,
          ...Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`),
          "",
          "",
        ].join("\r\n");
        clientSocket.write(headBuf);
        // 客户端 upgrade 时携带的初始数据转发给目标
        if (head?.length) proxySocket.write(head);
        if (proxyHead?.length) clientSocket.write(proxyHead);
        // 双向透传
        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);
        proxySocket.on("close", () => clientSocket.destroy());
        clientSocket.on("close", () => proxySocket.destroy());
      });
      proxyReq.on("error", (err) => {
        log.warn("Proxy websocket upgrade failed", { error: err.message, url: req.url });
        clientSocket.destroy();
      });
      proxyReq.end();
    });

    server.timeout = 0;
    server.keepAliveTimeout = 0;

    server.listen(port, options.hostname || undefined, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      log.debug(`Proxy server started on port ${actualPort} -> ${targetUrl}`);
      resolve({ server, actualPort });
    });
  });
}
