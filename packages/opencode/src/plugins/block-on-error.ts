/**
 * @fileoverview 质量门禁插件
 * @description edit/write 工具执行后：
 *   1. ESLint 检查（Node API）
 *   2. vue-tsc 类型检查（过滤当前文件诊断）
 *   3. 错误硬阻止（可选，OPENCODE_BLOCK_ON_ERROR=1 时回滚）
 */

import fs from "node:fs";
import { exec } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import type { Hooks } from "@opencode-ai/plugin";
import {
  setVerbose,
  createLogger,
  SEVERITY_ERROR,
  SEVERITY_WARN,
} from "@vite-plugin-opencode-assistant/shared/node";

// 子进程通过环境变量接收 verbose 配置
if (process.env.OPENCODE_VERBOSE === "1") {
  setVerbose(true);
}

const log = createLogger("BlockOnError");

interface Snapshot {
  filePath: string;
  content: string | null;
}

// ESLint severity: 2=error, 1=warn → LSP DiagnosticSeverity: 1=Error, 2=Warning
// 参考 eslint/lib/shared/severity.js、shared/constants.ts

const BLOCKED_TOOLS = new Set(["edit", "write", "apply_patch"]);
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

    /** ESLint 检查，返回 { 诊断文本, 结构化数据 } */
    async function lintFile(
      filePath: string,
    ): Promise<{ text?: string; diagnostics: DiagnosticItem[] }> {
      if (!ESLintClass) return { diagnostics: [] };
      try {
        const eslint = new ESLintClass({ cwd: process.cwd() });
        const results = await eslint.lintFiles(filePath);
        const messages: LintMessage[] = results[0]?.messages ?? [];
        log.debug("ESLint raw messages", {
          filePath,
          count: messages.length,
          severities: messages.map((m) => m.severity),
          ruleIds: messages.map((m) => m.ruleId),
        });
        if (messages.length === 0) return { diagnostics: [] };

        // 文本输出（给 LLM 看），使用 ESLint 原生 severity 过滤
        const ESLINT_ERROR = 2;
        const ESLINT_WARN = 1;
        const lines: string[] = [];
        const errors = messages.filter((m) => m.severity === ESLINT_ERROR);
        const warnings = messages.filter((m) => m.severity === ESLINT_WARN);
        log.debug("ESLint filtered", {
          errors: errors.length,
          warnings: warnings.length,
        });
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

        // 结构化数据（LSP severity: 1=Error, 2=Warning），ESLint 2/1 映射到 LSP 1/2
        const diagnostics = messages.map((m) => ({
          severity:
            m.severity === ESLINT_ERROR
              ? SEVERITY_ERROR
              : m.severity === ESLINT_WARN
                ? SEVERITY_WARN
                : m.severity,
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

        const result = {
          text: lines.length > 0 ? lines.join("\n") : undefined,
          diagnostics,
        };
        log.debug("ESLint lintFile result", {
          hasText: !!result.text,
          textLength: result.text?.length,
          diagCount: diagnostics.length,
          textPreview: result.text?.slice(0, 200),
        });
        return result;
      } catch (err) {
        log.warn("ESLint failed", { filePath, error: (err as Error).message });
      }
      return { diagnostics: [] };
    }

    let _vueTscBin: string | null | undefined;

    /** 解析 vue-tsc CLI 路径（从插件自身 node_modules，无需用户安装） */
    function resolveVueTscBin(): string | null {
      if (_vueTscBin !== undefined) return _vueTscBin;
      try {
        const cwd = process.cwd();
        const req = createRequire(path.join(cwd, "package.json"));
        const pkgDir = path.dirname(
          path.dirname(req.resolve("@vite-plugin-opencode-assistant/opencode")),
        );
        const pluginReq = createRequire(path.join(pkgDir, "package.json"));
        _vueTscBin = pluginReq.resolve("vue-tsc/bin/vue-tsc.js");
      } catch {
        _vueTscBin = null;
      }
      return _vueTscBin;
    }

    /** 解析 tsc/vue-tsc 输出，过滤当前文件的诊断 */
    function parseTscOutput(output: string, filePath: string): DiagnosticItem[] {
      // 匹配格式: src/file.ts(10,5): error TS2345: message
      const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/gm;
      const diags: DiagnosticItem[] = [];
      const resolved = path.resolve(filePath);

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(output)) !== null) {
        const [, matchedFile, line, col, severity, code, message] = match;
        if (path.resolve(matchedFile) !== resolved) continue;

        diags.push({
          severity: severity === "error" ? SEVERITY_ERROR : SEVERITY_WARN,
          range: {
            start: { line: Number(line) - 1, character: Number(col) - 1 },
            end: { line: Number(line) - 1, character: Number(col) - 1 },
          },
          message: `[TS${code}] ${message}`,
          source: "vue-tsc",
        });
      }
      return diags;
    }

    /** 运行 vue-tsc --noEmit 并过滤当前文件的类型错误 */
    function runVueTsc(filePath: string): Promise<DiagnosticItem[]> {
      const bin = resolveVueTscBin();
      if (!bin) return Promise.resolve([]);

      return new Promise((resolve) => {
        exec(
          `node "${bin}" --noEmit --pretty false`,
          { cwd: process.cwd(), timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            const output = stdout + stderr;
            log.debug("vue-tsc finished", {
              filePath,
              exitCode: error?.code,
              outputLength: output.length,
            });
            resolve(parseTscOutput(output, filePath));
          },
        );
      });
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

        // ESLint 和 vue-tsc 并行检查
        loadESLint();
        const [eslintResult, tscDiagnostics] = await Promise.all([
          lintFile(filePath),
          runVueTsc(filePath),
        ]);

        // 合并诊断
        const diagnostics = [...eslintResult.diagnostics, ...tscDiagnostics];
        const eslintErrors = eslintResult.diagnostics.some((d) => d.severity === SEVERITY_ERROR);
        const tscErrors = tscDiagnostics.some((d) => d.severity === SEVERITY_ERROR);
        const anyError = eslintErrors || tscErrors;

        // 构建诊断文本
        const lines: string[] = [];
        if (tscDiagnostics.length > 0) {
          lines.push(
            ...tscDiagnostics.map((d) => {
              const level = d.severity === SEVERITY_ERROR ? "ERROR" : "WARN";
              return `${level} [${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message}`;
            }),
          );
        }
        if (eslintResult.text) {
          lines.push(eslintResult.text);
        }
        const diagText = lines.length > 0 ? lines.join("\n") : undefined;

        log.debug("Diagnostics result", {
          filePath,
          totalCount: diagnostics.length,
          eslintCount: eslintResult.diagnostics.length,
          tscCount: tscDiagnostics.length,
          anyError,
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

        // 构建阻塞输出
        const sources: string[] = [];
        if (eslintErrors) sources.push("ESLint");
        if (tscErrors) sources.push("vue-tsc");

        output.output = [
          `❌ BLOCKED: Changes were reverted due to ${sources.join(" + ")} errors.`,
          "",
          ...diagnostics.filter((d) => d.severity === SEVERITY_ERROR).map((d) => d.message),
        ].join("\n");
        output.title = `REJECTED: ${path.basename(snap.filePath)}`;

        log.warn("Edit blocked", { tool: input.tool, filePath: snap.filePath });
      },
    };
  },
};
