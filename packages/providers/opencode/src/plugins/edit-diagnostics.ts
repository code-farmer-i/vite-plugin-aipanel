/**
 * @fileoverview 编辑后诊断插件
 * @description edit/write 工具执行后：
 *   1. ESLint 检查（Node API）
 *   2. vue-tsc 类型检查（过滤当前文件诊断）
 *   3. 诊断结果追加到工具输出，供 Agent 查看（不做回滚）
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

const log = createLogger("EditDiagnostics");

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"]);
const isLintEnabled = () => process.env.OPENCODE_ENABLE_LINT === "1";

export default {
  id: "vite-plugin-aipanel/edit-diagnostics",
  async server(): Promise<Hooks> {
    const workspace = process.env.OPENCODE_WORKSPACE || process.cwd();

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
      "tool.execute.after": async (input, output) => {
        if (!EDIT_TOOLS.has(input.tool)) return;
        if (!isLintEnabled()) return;

        const filePath = (input.args?.filePath as string) || "";
        if (!filePath || !isJsFile(filePath)) return;

        log.debug("Executing after hook", {
          tool: input.tool,
          filePath,
          processCwd: workspace,
          lintEnabled: isLintEnabled(),
        });

        // ESLint 和 vue-tsc 并行检查
        const { eslintOutput, tscOutput } = await runAllChecks(filePath, workspace);

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
          eslintError: !!eslintOutput.text,
          tscError: tscOutput.exitCode !== 0,
        });

        // 诊断信息追加到 output（供 Agent 查看，不再回滚）
        if (diagText) {
          output.output += "\n\n" + diagText;
        }

        // 写入 metadata.diagnostics 供 UI 渲染
        const anyError = !!eslintOutput.text || tscOutput.exitCode !== 0;
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
      },
      tool: {
        run_diagnostics: runDiagnosticsTool,
      },
    };
  },
};
