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
import { tool } from "@opencode-ai/plugin";
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
      lintFiles: (p: string) => Promise<Array<{ filePath: string; messages: LintMessage[] }>>;
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

    // ---- 格式化辅助 ----

    function formatSeverity(d: DiagnosticItem): string {
      return d.severity === SEVERITY_ERROR ? "ERROR" : "WARN";
    }

    function formatTscLine(d: DiagnosticItem): string {
      return `${formatSeverity(d)} [${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message}`;
    }

    function formatDiagnosticsSections(
      title: string,
      eslintResult: { text?: string },
      tscDiagnostics: DiagnosticItem[],
      tscLimit: number = Infinity,
    ): string {
      const parts: string[] = [];

      if (eslintResult.text) {
        parts.push("## ESLint\n\n" + eslintResult.text);
      } else {
        parts.push("## ESLint\n\n没有发现问题");
      }

      if (tscDiagnostics.length > 0) {
        const tscLines = tscDiagnostics.slice(0, tscLimit).map(formatTscLine);
        const suffix =
          tscDiagnostics.length > tscLimit
            ? `\n... 还有 ${tscDiagnostics.length - tscLimit} 条类型诊断`
            : "";
        parts.push("## vue-tsc\n\n" + tscLines.join("\n") + suffix);
      } else {
        parts.push("## vue-tsc\n\n没有发现类型错误");
      }

      return `${title}\n\n` + parts.join("\n\n");
    }

    // ---- ESLint ----

    /** ESLint 检查，接受文件路径或 glob 模式 */
    async function lintFiles(
      pattern: string,
      cwd: string,
      warnLimit = 5,
    ): Promise<{ text?: string; diagnostics: DiagnosticItem[] }> {
      loadESLint();
      if (!ESLintClass) return { diagnostics: [] };
      try {
        const eslint = new ESLintClass({ cwd });
        const results = await eslint.lintFiles(pattern);
        const messages: (LintMessage & { filePath: string })[] = results.flatMap((r) =>
          (r.messages ?? []).map((m) => ({ ...m, filePath: r.filePath })),
        );
        log.debug("ESLint lint", {
          pattern,
          fileCount: results.length,
          messageCount: messages.length,
        });

        if (messages.length === 0) return { diagnostics: [] };

        const ESLINT_ERROR = 2;
        const ESLINT_WARN = 1;
        const lines: string[] = [];
        const errors = messages.filter((m) => m.severity === ESLINT_ERROR);
        const warnings = messages.filter((m) => m.severity === ESLINT_WARN);

        if (errors.length > 0) {
          lines.push(
            ...errors.map(
              (m) => `ERROR [${m.filePath}:${m.line}:${m.column}] ${m.message} (${m.ruleId})`,
            ),
          );
        }
        if (warnings.length > 0) {
          lines.push(
            ...warnings
              .slice(0, warnLimit)
              .map((m) => `WARN [${m.filePath}:${m.line}:${m.column}] ${m.message} (${m.ruleId})`),
          );
          if (warnings.length > warnLimit)
            lines.push(`... and ${warnings.length - warnLimit} more warnings`);
        }

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

        return { text: lines.length > 0 ? lines.join("\n") : undefined, diagnostics };
      } catch (err) {
        log.warn("ESLint failed", { pattern, error: (err as Error).message });
        return { diagnostics: [] };
      }
    }

    // ---- vue-tsc ----

    let _vueTscBin: string | null | undefined;

    /** 解析 vue-tsc CLI 路径（从插件自身 node_modules，无需用户安装） */
    function resolveVueTscBin(projectDir?: string): string | null {
      if (_vueTscBin !== undefined) return _vueTscBin;
      try {
        const dir = projectDir ?? process.cwd();
        const req = createRequire(path.join(dir, "package.json"));
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

    /** 解析 tsc/vue-tsc 输出，可选按文件过滤 */
    function parseTscOutput(output: string, filePath?: string): DiagnosticItem[] {
      const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/gm;
      const diags: DiagnosticItem[] = [];
      const resolved = filePath ? path.resolve(filePath) : undefined;

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(output)) !== null) {
        const [, matchedFile, line, col, severity, code, message] = match;
        if (resolved && path.resolve(matchedFile) !== resolved) continue;

        diags.push({
          severity: severity === "error" ? SEVERITY_ERROR : SEVERITY_WARN,
          range: {
            start: { line: Number(line) - 1, character: Number(col) - 1 },
            end: { line: Number(line) - 1, character: Number(col) - 1 },
          },
          message: `[TS${code}] [${matchedFile}] ${message}`,
          source: "vue-tsc",
        });
      }
      return diags;
    }

    /** 运行 vue-tsc --build --noEmit，可选按文件过滤 */
    function runVueTsc(filePath?: string, cwd?: string): Promise<DiagnosticItem[]> {
      const dir = cwd ?? process.cwd();
      const bin = resolveVueTscBin(dir);
      if (!bin) return Promise.resolve([]);

      const timeout = filePath ? 60000 : 120000;
      const maxBuffer = filePath ? 10 * 1024 * 1024 : 50 * 1024 * 1024;

      return new Promise((resolve) => {
        exec(
          `node "${bin}" --build --noEmit --pretty false`,
          { cwd: dir, timeout, maxBuffer },
          (error, stdout, stderr) => {
            const output = stdout + stderr;
            log.debug("vue-tsc finished", {
              filePath: filePath || "(all)",
              exitCode: error?.code,
              outputLength: output.length,
            });
            resolve(parseTscOutput(output, filePath));
          },
        );
      });
    }

    /** 并行运行 ESLint + vue-tsc 检查 */
    async function runAllChecks(pattern: string, cwd: string) {
      const [eslintResult, tscDiagnostics] = await Promise.all([
        lintFiles(pattern, cwd),
        runVueTsc(pattern, cwd),
      ]);
      return { eslintResult, tscDiagnostics };
    }

    // 定义 run_diagnostics 工具，让 agent 可以主动触发诊断
    const runDiagnosticsTool = tool({
      description: `运行 ESLint 和 vue-tsc 类型检查，返回诊断结果。

**何时使用此工具**：
- 刚完成代码修改，想验证是否有 ESLint 错误或类型错误
- 在提交代码前进行质量检查
- 排查编辑器未显示但实际存在的类型问题
- 不传参数可全量诊断整个项目

**诊断内容**：
- ESLint 规则检查（error 和 warning）
- vue-tsc 类型检查（TypeScript 类型错误和警告）`,
      args: {
        filePath: tool.schema
          .string()
          .optional()
          .describe("要诊断的文件路径（绝对路径或相对路径），不传则全量诊断整个项目"),
      },
      async execute(args, context) {
        const { filePath } = args;
        const cwd = context.directory;

        if (filePath) {
          // 单文件诊断
          const resolved = path.resolve(cwd, filePath);

          log.debug("run_diagnostics called (single file)", {
            filePath: resolved,
            sessionID: context.sessionID,
          });

          if (!fs.existsSync(resolved)) {
            return `文件不存在: ${resolved}`;
          }

          const { eslintResult, tscDiagnostics } = await runAllChecks(resolved, cwd);

          return formatDiagnosticsSections(
            `诊断结果: ${path.relative(cwd, resolved)}`,
            eslintResult,
            tscDiagnostics,
          );
        }

        // 全量诊断
        log.debug("run_diagnostics called (full project)", {
          sessionID: context.sessionID,
        });

        const [eslintResult, tscDiagnostics] = await Promise.all([
          lintFiles(".", cwd, 10),
          runVueTsc(undefined, cwd),
        ]);

        return formatDiagnosticsSections("全量诊断结果", eslintResult, tscDiagnostics, 30);
      },
    });

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
        const { eslintResult, tscDiagnostics } = await runAllChecks(filePath, process.cwd());

        // 合并诊断
        const diagnostics = [...eslintResult.diagnostics, ...tscDiagnostics];
        const eslintErrors = eslintResult.diagnostics.some((d) => d.severity === SEVERITY_ERROR);
        const tscErrors = tscDiagnostics.some((d) => d.severity === SEVERITY_ERROR);
        const anyError = eslintErrors || tscErrors;

        // 构建诊断文本
        const lines: string[] = [];
        if (tscDiagnostics.length > 0) {
          lines.push(...tscDiagnostics.map(formatTscLine));
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
      tool: {
        run_diagnostics: runDiagnosticsTool,
      },
    };
  },
};
