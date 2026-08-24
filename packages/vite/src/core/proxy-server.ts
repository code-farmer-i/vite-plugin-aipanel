import http from "http";
import { createLogger, BRIDGE_SCRIPT_PATH } from "@aipanel/core";

const log = createLogger("ProxyServer");

export interface ProxyServerOptions {
  /** 注入到 HTML 的 Provider 侧桥接脚本（Provider 资产） */
  bridgeScript?: string;
  /** 绑定地址，需与端口检查使用的地址族一致，避免 IPv4/IPv6 不匹配 */
  hostname?: string;
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
