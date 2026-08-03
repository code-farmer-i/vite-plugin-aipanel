import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import {
  SEVERITY_ERROR,
  SEVERITY_WARN,
  VSCODE_EXTENSION_PORT,
  VSCODE_PORT_DIR,
  findAvailablePort,
} from "@vite-plugin-opencode-assistant/shared/node";

let server: http.Server | null = null;
let portFile: string | null = null;
const outputChannel = vscode.window.createOutputChannel("OpenCode Assistant");

function toSharedSeverity(severity: vscode.DiagnosticSeverity): number {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return SEVERITY_ERROR;
    case vscode.DiagnosticSeverity.Warning:
      return SEVERITY_WARN;
    default:
      return SEVERITY_WARN;
  }
}

function mapDiagnostics(diags: readonly vscode.Diagnostic[]): unknown[] {
  return diags
    .filter(
      (d) =>
        d.severity === vscode.DiagnosticSeverity.Error ||
        d.severity === vscode.DiagnosticSeverity.Warning,
    )
    .map((d) => ({
      severity: toSharedSeverity(d.severity),
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character },
      },
      message: d.source ? `[${d.source}] ${d.message}` : d.message,
      source: d.source || "vscode",
    }));
}

async function formatFile(filePath: string): Promise<{ diagnostics: unknown[] }> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    "vscode.executeFormatDocumentProvider",
    uri,
  );
  if (edits && edits.length > 0) {
    const wsEdit = new vscode.WorkspaceEdit();
    wsEdit.set(uri, edits);
    await vscode.workspace.applyEdit(wsEdit);
    await doc.save();
  }
  return { diagnostics: mapDiagnostics(vscode.languages.getDiagnostics(uri)) };
}

async function getDiagnostics(filePath: string): Promise<{ diagnostics: unknown[] }> {
  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.openTextDocument(uri);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { diagnostics: mapDiagnostics(vscode.languages.getDiagnostics(uri)) };
}

/** 扫描 workspace 中所有 package.json，检查是否依赖了 vite-plugin-opencode-assistant */
async function hasOpenCodePlugin(): Promise<string | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return null;

  const pkgFiles = await vscode.workspace.findFiles("**/package.json", "**/node_modules/**", 100);
  for (const pkgFile of pkgFiles) {
    try {
      const content = JSON.parse((await vscode.workspace.fs.readFile(pkgFile)).toString());
      const deps = {
        ...content.dependencies,
        ...content.devDependencies,
        ...content.peerDependencies,
      };
      if (deps["vite-plugin-opencode-assistant"]) {
        const pkgDir = path.dirname(pkgFile.fsPath);
        for (const folder of folders) {
          if (pkgDir.startsWith(folder.uri.fsPath)) return folder.uri.fsPath;
        }
        return pkgDir;
      }
    } catch {
      /* skip */
    }
  }
  return null;
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
        } else if (req.url === "/diagnostics") {
          const result = await getDiagnostics(filePath);
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const projectRoot = await hasOpenCodePlugin();
  if (!projectRoot) {
    outputChannel.appendLine("未找到依赖 vite-plugin-opencode-assistant 的项目，扩展未激活");
    return;
  }

  const portDir = path.join(projectRoot, VSCODE_PORT_DIR);
  const portFilePath = path.join(portDir, "port");

  if (!fs.existsSync(portDir)) {
    fs.mkdirSync(portDir, { recursive: true });
  }

  const srv = http.createServer(createRequestHandler());

  try {
    const port = await findAvailablePort(VSCODE_EXTENSION_PORT, "127.0.0.1");
    srv.listen(port, "127.0.0.1");
    server = srv;
    portFile = portFilePath;
    fs.writeFileSync(portFilePath, String(port));
    outputChannel.appendLine(
      `OpenCode Assistant 已启动，端口: ${port}，port 文件: ${portFilePath}`,
    );
    vscode.window.showInformationMessage("OpenCode Assistant 已启动");
  } catch (err) {
    outputChannel.appendLine(`[OpenCode] 启动失败: ${String(err)}`);
    return;
  }

  context.subscriptions.push(outputChannel, {
    dispose: () => {
      server?.close();
      cleanupPortFile();
    },
  });
}

function cleanupPortFile(): void {
  if (portFile) {
    try {
      fs.unlinkSync(portFile);
    } catch {
      /* ignore */
    }
    portFile = null;
  }
}

export function deactivate(): void {
  server?.close();
  cleanupPortFile();
}
