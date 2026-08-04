import * as vscode from "vscode";
import * as http from "http";
import { VSCODE_EXTENSION_PORT } from "@vite-plugin-opencode-assistant/shared/node";

let server: http.Server | null = null;
const outputChannel = vscode.window.createOutputChannel("OpenCode Assistant");

/** 模拟用户在 VS Code 中保存文件的行为：格式化 + codeActionsOnSave */
async function formatFile(filePath: string): Promise<{ formatted: boolean }> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);

  // 1. 格式化（formatOnSave）
  const formatEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    "vscode.executeFormatDocumentProvider",
    uri,
  );
  if (formatEdits && formatEdits.length > 0) {
    const wsEdit = new vscode.WorkspaceEdit();
    wsEdit.set(uri, formatEdits);
    await vscode.workspace.applyEdit(wsEdit);
  }

  // 2. codeActionsOnSave（organizeImports、fixAll 等）
  const codeActionsOnSave =
    vscode.workspace
      .getConfiguration("editor")
      .get<Record<string, boolean | object>>("codeActionsOnSave") ?? {};
  const enabledActions = new Set(
    Object.entries(codeActionsOnSave)
      .filter(([, v]) => {
        if (v === true) return true;
        // 排除 { "explicit": true } 等仅手动触发的配置
        if (typeof v === "object" && v !== null && !(v as Record<string, unknown>).explicit)
          return true;
        return false;
      })
      .map(([k]) => k),
  );
  if (enabledActions.size > 0) {
    const lastLine = doc.lineCount - 1;
    const fullRange = new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).text.length);
    const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      "vscode.executeCodeActionProvider",
      uri,
      fullRange,
    );
    if (codeActions && codeActions.length > 0) {
      const wsEdit = new vscode.WorkspaceEdit();
      for (const action of codeActions) {
        if (action.kind && enabledActions.has(action.kind.value)) {
          if (action.edit) {
            for (const [targetUri, edits] of action.edit.entries()) {
              wsEdit.set(targetUri, edits);
            }
          }
        }
      }
      // 有编辑才 apply，避免空操作
      if (wsEdit.size > 0) {
        await vscode.workspace.applyEdit(wsEdit);
      }
    }
  }

  await doc.save();
  return { formatted: true };
}

/** 扫描 workspace 中所有 package.json，检查是否依赖了 vite-plugin-opencode-assistant */
async function hasOpenCodePlugin(): Promise<boolean> {
  const pkgFiles = await vscode.workspace.findFiles("**/package.json", "**/node_modules/**", 100);
  for (const pkgFile of pkgFiles) {
    try {
      const content = JSON.parse((await vscode.workspace.fs.readFile(pkgFile)).toString());
      const deps = {
        ...content.dependencies,
        ...content.devDependencies,
        ...content.peerDependencies,
      };
      if (deps["vite-plugin-opencode-assistant"]) return true;
    } catch {
      /* skip */
    }
  }
  return false;
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
    if (req.method === "GET" && req.url === "/health") {
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
        if (req.url === "/format") {
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
    const req = http.get(`http://127.0.0.1:${VSCODE_EXTENSION_PORT}/health`, (res) => {
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
  if (!(await hasOpenCodePlugin())) {
    outputChannel.appendLine("未找到依赖 vite-plugin-opencode-assistant 的项目，扩展未激活");
    return;
  }

  const srv = http.createServer(createRequestHandler());

  try {
    await new Promise<void>((resolve, reject) => {
      srv.listen(VSCODE_EXTENSION_PORT, "127.0.0.1", resolve);
      srv.on("error", reject);
    });
    server = srv;
    outputChannel.appendLine(`OpenCode Assistant 已启动，端口: ${VSCODE_EXTENSION_PORT}`);
    vscode.window.showInformationMessage("OpenCode Assistant 已启动");
  } catch (err) {
    // 端口被占 → 检查是否已有健康服务（其他窗口先启动了）
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      if (await probeRunningService()) {
        outputChannel.appendLine(
          `复用已有 OpenCode Assistant 服务，端口: ${VSCODE_EXTENSION_PORT}`,
        );
        return;
      }
    }
    outputChannel.appendLine(`[OpenCode] 启动失败: ${String(err)}`);
    return;
  }

  context.subscriptions.push(outputChannel, {
    dispose: () => {
      server?.close();
    },
  });
}

export function deactivate(): void {
  server?.close();
}
