/**
 * @fileoverview 质量门禁插件
 * @description edit/write 工具执行后：
 *   1. ESLint 检查（Node API）
 *   2. vue-tsc 类型检查（过滤当前文件诊断）
 *   3. 错误硬阻止（可选，OPENCODE_BLOCK_ON_ERROR=1 时回滚）
 *
 * 诊断引擎（ESLint/vue-tsc/格式化/全量诊断）统一由 @aipanel/core/node 提供，
 * 与 dsh 侧审查工具共用同一实现，保证行为一致。
 */

import fs from "node:fs";
import path from "node:path";
import type { Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import {
  setVerbose,
  createLogger,
  runAllChecks,
  runProjectDiagnostics,
  formatDiagnosticsSections,
  isJsFile,
  type DiagnosticItem,
} from "@aipanel/core/node";

// 子进程通过环境变量接收 verbose 配置
if (process.env.OPENCODE_VERBOSE === "1") {
  setVerbose(true);
}

const log = createLogger("BlockOnError");

interface Snapshot {
  filePath: string;
  content: string | null;
}

const BLOCKED_TOOLS = new Set(["edit", "write", "apply_patch"]);
const isBlocking = () => process.env.OPENCODE_BLOCK_ON_ERROR === "1";
const isLintEnabled = () => process.env.OPENCODE_ENABLE_LINT === "1";

export default {
  id: "vite-plugin-aipanel/block-on-error",
  async server(): Promise<Hooks> {
    const workspace = process.env.OPENCODE_WORKSPACE || process.cwd();
    const snapshots = new Map<string, Snapshot>();

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
        const workspace = context.directory;

        if (filePath) {
          // 单文件诊断
          const resolved = path.resolve(workspace, filePath);

          log.debug("run_diagnostics called (single file)", {
            filePath: resolved,
            workspace,
            sessionID: context.sessionID,
          });

          if (!fs.existsSync(resolved)) {
            return `文件不存在: ${resolved}`;
          }

          const { eslintOutput, tscOutput } = await runAllChecks(resolved, workspace);

          return formatDiagnosticsSections(
            `诊断结果: ${path.relative(workspace, resolved)}`,
            eslintOutput,
            tscOutput,
          );
        }

        // 全量诊断
        log.debug("run_diagnostics called (full project)", {
          workspace,
          sessionID: context.sessionID,
        });

        const { eslintOutput, tscOutput } = await runProjectDiagnostics(workspace);

        return formatDiagnosticsSections("全量诊断结果", eslintOutput, tscOutput);
      },
    });

    return {
      "tool.execute.before": async (input, output) => {
        if (!BLOCKED_TOOLS.has(input.tool)) return;
        if (!isBlocking()) return;

        const args = output.args as Record<string, unknown>;
        const filePath = args.filePath as string | undefined;
        if (!filePath || !isJsFile(filePath)) return;

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
        if (!filePath || !isJsFile(filePath)) return;

        log.debug("Executing after hook", {
          tool: input.tool,
          filePath,
          processCwd: workspace,
          lintEnabled: isLintEnabled(),
          blocking: isBlocking(),
        });

        // ESLint 和 vue-tsc 并行检查
        const { eslintOutput, tscOutput } = await runAllChecks(filePath, workspace);

        // 判断是否有错误
        const eslintError = !!eslintOutput.text;
        const tscError = tscOutput.exitCode !== 0;
        const anyError = eslintError || tscError;

        // 构建诊断原文
        const parts: string[] = [];
        if (tscOutput.rawOutput.trim()) {
          parts.push("## vue-tsc\n\n" + tscOutput.rawOutput.trim());
        }
        if (eslintOutput.text) {
          parts.push("## ESLint\n\n" + eslintOutput.text);
        }
        const diagText = parts.join("\n\n");

        log.debug("Diagnostics result", {
          filePath,
          eslintError,
          tscError,
          anyError,
        });

        // 诊断信息追加到 output（无论是否 blocking）
        if (diagText) {
          output.output += "\n\n" + diagText;
        }

        // 写入 metadata.diagnostics 供 UI 渲染
        if (anyError) {
          const meta = (output.metadata ?? (output.metadata = {})) as Record<string, unknown>;
          const existing = (meta.diagnostics ?? (meta.diagnostics = {})) as Record<
            string,
            DiagnosticItem[]
          >;
          const diags: DiagnosticItem[] = [
            ...(eslintOutput.diagnostics ?? []),
            ...(tscOutput.diagnostics ?? []),
          ];
          existing[filePath] = [...(existing[filePath] ?? []), ...diags];
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
        if (eslintError) sources.push("ESLint");
        if (tscError) sources.push("vue-tsc");

        output.output = [
          `❌ BLOCKED: Changes were reverted due to ${sources.join(" + ")} errors.`,
          "",
          diagText,
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
