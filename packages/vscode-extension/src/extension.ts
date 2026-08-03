import * as vscode from "vscode";
import * as http from "http";

let server: http.Server | null = null;

/** 将 VS Code Diagnostic 映射为纯数据 */
function mapDiagnostics(diags: readonly vscode.Diagnostic[]): unknown[] {
  return diags
    .filter(
      (d) =>
        d.severity === vscode.DiagnosticSeverity.Error ||
        d.severity === vscode.DiagnosticSeverity.Warning,
    )
    .map((d) => ({
      severity: d.severity,
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character },
      },
      message: d.source ? `[${d.source}] ${d.message}` : d.message,
      source: d.source || "vscode",
    }));
}

/** 打开 → 保存 → 返回诊断 */
async function formatFile(filePath: string): Promise<{ diagnostics: unknown[] }> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true });
  await vscode.commands.executeCommand("workbench.action.files.save");

  return { diagnostics: mapDiagnostics(vscode.languages.getDiagnostics(uri)) };
}

/** 打开文档 → 等待 LSP → 返回诊断（不保存，格式化已由 /format 完成） */
async function getDiagnostics(filePath: string): Promise<{ diagnostics: unknown[] }> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true });

  // 等待 LSP 诊断产生
  await new Promise((resolve) => setTimeout(resolve, 500));

  return { diagnostics: mapDiagnostics(vscode.languages.getDiagnostics(uri)) };
}

function startServer(port: number): http.Server {
  const srv = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
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
  });
  srv.listen(port, "127.0.0.1");
  return srv;
}

export function activate(context: vscode.ExtensionContext): void {
  const port = 51939;
  try {
    server = startServer(port);
    console.log(`[OpenCode VSCode Extension] Format server on port ${port}`);
  } catch {
    console.error(`[OpenCode VSCode Extension] Failed to start on port ${port}`);
    return;
  }
  context.subscriptions.push({ dispose: () => server?.close() });
}

export function deactivate(): void {
  server?.close();
}
