/**
 * @fileoverview 质量门禁插件
 * @description edit/write 工具执行后：
 *   1. Prettier 格式化（自动）
 *   2. ESLint 检查（Node API，绕过 LSP Bug 2）
 *   3. 错误硬阻止（可选，OPENCODE_BLOCK_ON_ERROR=1 时回滚）
 */

import fs from "node:fs";
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
const LSP_ERROR_MARKER = "LSP errors detected";
const isBlocking = () => process.env.OPENCODE_BLOCK_ON_ERROR === "1";
const isLintEnabled = () => process.env.OPENCODE_ENABLE_LINT === "1";

export default {
  id: "vite-plugin-opencode-assistant/block-on-error",
  async server(): Promise<Hooks> {
    const snapshots = new Map<string, Snapshot>();

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

    // 懒加载项目中的 prettier / eslint
    let prettierModule: typeof import("prettier") | undefined;
    let ESLintClass: ESLintConstructor | undefined;

    function loadTools() {
      if (prettierModule && ESLintClass) return;
      const cwd = process.cwd();
      log.debug("Loading tools", { cwd });
      try {
        const req = createRequire(path.join(cwd, "package.json"));
        prettierModule ??= req("prettier");
        log.debug("prettier loaded");
      } catch (e) {
        log.warn("prettier not found", { error: (e as Error).message });
      }
      try {
        const req = createRequire(path.join(cwd, "package.json"));
        const eslintModule = req("eslint");
        ESLintClass ??= eslintModule.ESLint ?? eslintModule.FlatESLint;
        log.debug("eslint loaded", { hasClass: !!ESLintClass });
      } catch (e) {
        log.warn("eslint not found", { error: (e as Error).message });
      }
    }

    /** Prettier 格式化，有变更则写回 */
    async function formatFile(filePath: string): Promise<string | undefined> {
      if (!prettierModule) return undefined;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const config = await prettierModule.resolveConfig(filePath);
        const formatted = await prettierModule.format(content, {
          ...(config ?? {}),
          filepath: filePath,
        });
        if (formatted !== content) {
          fs.writeFileSync(filePath, formatted, "utf-8");
          log.debug("Prettier formatted", { filePath });
          return "File has been formatted with Prettier.";
        }
      } catch (err) {
        log.warn("Prettier failed", { filePath, error: (err as Error).message });
      }
      return undefined;
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

        loadTools();

        // 1. Prettier 格式化
        const formatMsg = await formatFile(filePath);
        if (formatMsg) log.debug("Format applied", { filePath });

        // 2. ESLint 检查
        const eslintResult = await lintFile(filePath);
        log.debug("Lint result", {
          filePath,
          diagCount: eslintResult.diagnostics.length,
          hasText: !!eslintResult.text,
          errors: eslintResult.diagnostics.filter((d) => d.severity === 1).length,
          warnings: eslintResult.diagnostics.filter((d) => d.severity === 2).length,
        });

        // 拼接到返回值（文本 + 结构化 metadata）
        const extraLines: string[] = [];
        if (formatMsg) extraLines.push(formatMsg);
        if (eslintResult.text) extraLines.push(eslintResult.text);
        if (extraLines.length > 0) {
          output.output += "\n\n" + extraLines.join("\n\n");
        }

        // 写入 metadata.diagnostics 供 UI 渲染
        if (eslintResult.diagnostics.length > 0) {
          const meta = (output.metadata ?? (output.metadata = {})) as Record<string, unknown>;
          const existing = (meta.diagnostics ?? (meta.diagnostics = {})) as Record<
            string,
            unknown[]
          >;
          existing[filePath] = [...(existing[filePath] ?? []), ...eslintResult.diagnostics];
          log.debug("Metadata updated", {
            filePath,
            total: existing[filePath].length,
            keys: Object.keys(existing),
          });
        }

        // 3. 错误回滚（仅 blocking 模式）
        if (!isBlocking()) return;

        const snap = snapshots.get(input.callID);
        if (!snap) return;
        snapshots.delete(input.callID);

        const hasLspErrors = output.output.includes(LSP_ERROR_MARKER);
        const hasEslintErrors = eslintResult.diagnostics.some((d) => d.severity === 1);
        if (!hasLspErrors && !hasEslintErrors) return;

        // 提取所有诊断信息（从 output 文本中）
        const outputDiagnosticBlocks =
          output.output.match(/<diagnostics[\s\S]*?<\/diagnostics>/g) ?? [];

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

        const sources: string[] = [];
        if (hasLspErrors) sources.push("TS");
        if (hasEslintErrors) sources.push("ESLint");

        output.output = [
          `❌ BLOCKED: Changes were reverted due to ${sources.join(" + ")} errors.`,
          "",
          ...(hasEslintErrors
            ? [
                `ESLint: ${eslintResult.diagnostics.filter((d) => d.severity === 1).length} error(s)`,
              ]
            : []),
          ...(hasLspErrors ? ["TS: see diagnostics above"] : []),
          "",
          ...outputDiagnosticBlocks,
        ].join("\n");
        output.title = `REJECTED: ${path.basename(snap.filePath)}`;

        log.warn("Edit blocked", { tool: input.tool, filePath: snap.filePath, sources });
      },
    };
  },
};
