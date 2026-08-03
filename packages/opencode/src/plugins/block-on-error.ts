/**
 * @fileoverview 质量门禁插件
 * @description edit/write 工具执行后：
 *   1. ESLint 检查（Node API，绕过 LSP Bug）
 *   2. 错误硬阻止（可选，OPENCODE_BLOCK_ON_ERROR=1 时回滚）
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import type { Hooks } from "@opencode-ai/plugin";
import { setVerbose, createLogger } from "@vite-plugin-opencode-assistant/shared/node";

// 子进程通过环境变量接收 verbose 配置
if (process.env.OPENCODE_VERBOSE === "1") {
  setVerbose(true);
}

const log = createLogger("BlockOnError");

interface Snapshot {
  filePath: string;
  content: string | null;
}

const BLOCKED_TOOLS = new Set(["edit", "write"]);
const isBlocking = () => process.env.OPENCODE_BLOCK_ON_ERROR === "1";
const isLintEnabled = () => process.env.OPENCODE_ENABLE_LINT === "1";

export default {
  id: "vite-plugin-opencode-assistant/block-on-error",
  async server(): Promise<Hooks> {
    const snapshots = new Map<string, Snapshot>();

    // 通过环境变量判断 VS Code 扩展是否可用（由 vite 插件启动时探测并设置）
    const vscodeMode = process.env.OPENCODE_VSCODE_MODE === "1";
    log.info(vscodeMode ? "VS Code diagnostics mode" : "Fallback mode (ESLint + LSP)");

    interface LintMessage {
      severity: number;
      line: number;
      column: number;
      endLine?: number;
      endColumn?: number;
      message: string;
      ruleId: string | null;
    }

    interface DiagnosticItem {
      severity: number;
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      message: string;
      source: string;
    }

    type ESLintConstructor = new (opts: { cwd: string }) => {
      lintFiles: (p: string) => Promise<Array<{ messages: LintMessage[] }>>;
    };

    let ESLintClass: ESLintConstructor | undefined;

    function loadESLint() {
      if (ESLintClass) return;
      const cwd = process.cwd();
      log.debug("Loading eslint", { cwd });
      try {
        const req = createRequire(path.join(cwd, "package.json"));
        const eslintModule = req("eslint");
        ESLintClass ??= eslintModule.ESLint ?? eslintModule.FlatESLint;
        log.debug("eslint loaded", { hasClass: !!ESLintClass });
      } catch (e) {
        log.warn("eslint not found", { error: (e as Error).message });
      }
    }

    const VSCODE_PORT = Number(process.env.OPENCODE_VSCODE_PORT) || 51939;

    /** 通过 HTTP 从 VS Code 扩展获取诊断 */
    function fetchVSCodeDiagnostics(filePath: string): Promise<DiagnosticItem[]> {
      return new Promise((resolve) => {
        const body = JSON.stringify({ filePath });
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: VSCODE_PORT,
            path: "/diagnostics",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            timeout: 5000,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
              try {
                const result = JSON.parse(Buffer.concat(chunks).toString());
                resolve((result.diagnostics as DiagnosticItem[]) || []);
              } catch {
                resolve([]);
              }
            });
          },
        );
        req.on("error", () => resolve([]));
        req.on("timeout", () => {
          req.destroy();
          resolve([]);
        });
        req.write(body);
        req.end();
      });
    }

    /** ESLint 检查，返回 { 诊断文本, 结构化数据 } */
    async function lintFile(
      filePath: string,
    ): Promise<{ text?: string; diagnostics: DiagnosticItem[] }> {
      if (!ESLintClass) return { diagnostics: [] };
      try {
        const eslint = new ESLintClass({ cwd: process.cwd() });
        const results = await eslint.lintFiles(filePath);
        const messages: LintMessage[] = results[0]?.messages ?? [];
        if (messages.length === 0) return { diagnostics: [] };

        // 文本输出（给 LLM 看）
        const lines: string[] = [];
        const errors = messages.filter((m) => m.severity === 2);
        const warnings = messages.filter((m) => m.severity === 1);
        if (errors.length > 0) {
          lines.push(
            ...errors.map((m) => `ERROR [${m.line}:${m.column}] ${m.message} (${m.ruleId})`),
          );
        }
        if (warnings.length > 0) {
          lines.push(
            ...warnings
              .slice(0, 5)
              .map((m) => `WARN [${m.line}:${m.column}] ${m.message} (${m.ruleId})`),
          );
          if (warnings.length > 5) lines.push(`... and ${warnings.length - 5} more warnings`);
        }

        // 结构化数据（给 UI 渲染，和 LSP Diagnostic 格式一致）
        // ESLint severity: 2=error, 1=warning → LSP DiagnosticSeverity: 1=Error, 2=Warning
        const diagnostics = messages.map((m) => ({
          severity: m.severity === 2 ? 1 : m.severity === 1 ? 2 : m.severity,
          range: {
            start: { line: (m.line || 1) - 1, character: (m.column || 1) - 1 },
            end: {
              line: (m.endLine || m.line || 1) - 1,
              character: (m.endColumn || m.column || 1) - 1,
            },
          },
          message: `[ESLint] ${m.message} (${m.ruleId})`,
          source: "eslint",
        }));

        return {
          text:
            lines.length > 0
              ? `<diagnostics file="${filePath}">\n${lines.join("\n")}\n</diagnostics>`
              : undefined,
          diagnostics,
        };
      } catch (err) {
        log.warn("ESLint failed", { filePath, error: (err as Error).message });
      }
      return { diagnostics: [] };
    }

    return {
      "tool.execute.before": async (input, output) => {
        if (!BLOCKED_TOOLS.has(input.tool)) return;
        if (!isBlocking()) return;

        const args = output.args as Record<string, unknown>;
        const filePath = args.filePath as string | undefined;
        if (!filePath) return;

        try {
          const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
          snapshots.set(input.callID, { filePath, content });
        } catch (err) {
          log.warn("Failed to save file snapshot", { filePath, error: (err as Error).message });
        }
      },

      "tool.execute.after": async (input, output) => {
        if (!BLOCKED_TOOLS.has(input.tool)) return;
        if (!isLintEnabled()) return;

        const filePath = (input.args?.filePath as string) || "";
        if (!filePath) return;

        log.debug("Executing after hook", { tool: input.tool, filePath });

        let diagnostics: DiagnosticItem[];
        let diagText: string | undefined;

        // 0. 方案选择：VS Code 扩展可用则全走 VS Code，不可用则降级
        if (vscodeMode) {
          diagnostics = await fetchVSCodeDiagnostics(filePath);
          log.debug("Using VS Code diagnostics", { filePath, count: diagnostics.length });

          if (diagnostics.length > 0) {
            const lines = diagnostics.map((d) => {
              const level = d.severity === 1 ? "ERROR" : "WARN";
              return `${level} [${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message}`;
            });
            diagText = `<diagnostics file="${filePath}">\n${lines.join("\n")}\n</diagnostics>`;
          }
        } else {
          // 降级方案：ESLint Node API + OpenCode LSP
          loadESLint();
          const eslintResult = await lintFile(filePath);
          diagnostics = eslintResult.diagnostics;
          diagText = eslintResult.text;
        }

        const hasErrors = diagnostics.some((d) => d.severity === 1);
        // 降级模式下还需要检测 OpenCode LSP 错误
        const hasLspErrors = !vscodeMode && output.output.includes("LSP errors detected");
        const anyError = hasErrors || hasLspErrors;

        log.debug("Diagnostics result", {
          filePath,
          vscodeMode,
          count: diagnostics.length,
          errors: diagnostics.filter((d) => d.severity === 1).length,
          hasLspErrors,
        });

        // 诊断信息追加到 output（无论是否 blocking）
        if (diagText) {
          output.output += "\n\n" + diagText;
        }

        // 写入 metadata.diagnostics 供 UI 渲染
        if (diagnostics.length > 0) {
          const meta = (output.metadata ?? (output.metadata = {})) as Record<string, unknown>;
          const existing = (meta.diagnostics ?? (meta.diagnostics = {})) as Record<
            string,
            unknown[]
          >;
          existing[filePath] = [...(existing[filePath] ?? []), ...diagnostics];
        }

        // 错误回滚（仅 blocking 模式）
        if (!isBlocking()) return;

        const snap = snapshots.get(input.callID);
        if (!snap) return;
        snapshots.delete(input.callID);

        if (!anyError) return;

        // 回滚文件
        try {
          if (snap.content === null) {
            if (fs.existsSync(snap.filePath)) fs.unlinkSync(snap.filePath);
          } else {
            fs.writeFileSync(snap.filePath, snap.content, "utf-8");
          }
          log.debug("Rolled back", { filePath: snap.filePath });
        } catch (err) {
          log.error("Rollback failed", { filePath: snap.filePath, error: (err as Error).message });
        }

        if (vscodeMode) {
          output.output = [
            "❌ BLOCKED: Changes were reverted due to VS Code diagnostics errors.",
            "",
            ...diagnostics.filter((d) => d.severity === 1).map((d) => `${d.message}`),
          ].join("\n");
        } else {
          const sources: string[] = [];
          if (hasLspErrors) sources.push("TS");
          if (hasErrors) sources.push("ESLint");

          const lspBlocks = hasLspErrors
            ? (output.output.match(/<diagnostics[\s\S]*?<\/diagnostics>/g) ?? [])
            : [];

          output.output = [
            `❌ BLOCKED: Changes were reverted due to ${sources.join(" + ")} errors.`,
            "",
            ...(hasErrors
              ? [`ESLint: ${diagnostics.filter((d) => d.severity === 1).length} error(s)`]
              : []),
            ...(hasLspErrors ? ["TS: see diagnostics above"] : []),
            "",
            ...lspBlocks,
          ].join("\n");
        }
        output.title = `REJECTED: ${path.basename(snap.filePath)}`;

        log.warn("Edit blocked", { tool: input.tool, filePath: snap.filePath, vscodeMode });
      },
    };
  },
};
