import * as vscode from "vscode";
import * as http from "http";
import {
  DEFAULT_HOSTNAME,
  VSCODE_EXTENSION_PORT,
  VSCODE_ROUTE_FORMAT,
  VSCODE_ROUTE_HEALTH,
} from "@aipanel/core/node";

let server: http.Server | null = null;
const outputChannel = vscode.window.createOutputChannel("AIPanel Assistant");

async function formatFile(filePath: string): Promise<{ formatted: boolean }> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preserveFocus: true });
  await vscode.commands.executeCommand("editor.action.formatDocument");
  await doc.save();
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  return { formatted: true };
}

function createRequestHandler(): http.RequestListener {
  return async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === VSCODE_ROUTE_HEALTH) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const { filePath } = JSON.parse(Buffer.concat(chunks).toString()) as { filePath: string };
        if (!filePath) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Missing filePath" }));
          return;
        }
        if (req.url === VSCODE_ROUTE_FORMAT) {
          const result = await formatFile(filePath);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(404);
          res.end("Not Found");
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  };
}

function probeRunningService(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${DEFAULT_HOSTNAME}:${VSCODE_EXTENSION_PORT}${VSCODE_ROUTE_HEALTH}`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const version = context.extension.packageJSON.version;
  outputChannel.appendLine(`AIPanel Assistant v${version} 正在启动...`);

  const srv = http.createServer(createRequestHandler());

  try {
    await new Promise<void>((resolve, reject) => {
      srv.listen(VSCODE_EXTENSION_PORT, DEFAULT_HOSTNAME, resolve);
      srv.on("error", reject);
    });
    server = srv;
    outputChannel.appendLine(
      `AIPanel Assistant v${version} 已启动，端口: ${VSCODE_EXTENSION_PORT}`,
    );
  } catch (err) {
    // 端口被占 → 检查是否已有健康服务（其他窗口先启动了）
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      outputChannel.appendLine(`端口 ${VSCODE_EXTENSION_PORT} 已被占用，检查已有服务...`);
      if (await probeRunningService()) {
        outputChannel.appendLine(
          `检测到已有健康服务，复用已有 AIPanel Assistant，端口: ${VSCODE_EXTENSION_PORT}`,
        );
        return;
      }
      outputChannel.appendLine(`端口被占用但无健康服务响应，可能是僵尸进程`);
    }
    outputChannel.appendLine(`启动失败: ${String(err)}`);
    return;
  }

  context.subscriptions.push(outputChannel, {
    dispose: () => {
      outputChannel.appendLine("AIPanel Assistant 正在关闭...");
      server?.close();
    },
  });
}

export function deactivate(): void {
  outputChannel.appendLine("AIPanel Assistant 已停用");
  server?.close();
}
