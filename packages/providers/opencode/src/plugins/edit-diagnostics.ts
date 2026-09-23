/**
 * @fileoverview 编辑后诊断插件（OpenCode 侧）
 * @description
 *   - 编辑后诊断：write/edit 工具执行后按配置的检查跑一次，结果追加到工具输出（不做回滚），
 *     结构化条目写进 metadata 供 UI 渲染；
 *   - run_diagnostics 工具：agent 主动触发（受策略 exposeTool 管辖）。
 *
 * 诊断策略由 provider 经 `OPENCODE_ENV.DIAGNOSTICS`（DiagnosticsPolicy JSON）下发——
 * 与 dsh 侧**同一份契约、同一套 runDiagnostics**，"内置 linter 预设"与"用户自定义检查"
 * 在这里也走完全相同的执行与适配逻辑。
 */

import fs from "node:fs";
import path from "node:path";
import type { Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import {
  setVerbose,
  createLogger,
  collectDiagnostics,
  renderDiagnostics,
  resolveDiagnosticsPolicy,
  runDiagnostics,
  DEFAULT_DIAGNOSTICS_POLICY,
  MUTATING_TOOLS,
  OPENCODE_ENV,
  DIAGNOSTICS_TOOL_DESCRIPTION,
  type DiagnosticItem,
  type DiagnosticsPolicy,
  type DiagnosticsTarget,
} from "@aipanel/core/node";

// 子进程通过环境变量接收 verbose 配置
if (process.env[OPENCODE_ENV.VERBOSE] === "1") {
  setVerbose(true);
}

const log = createLogger("EditDiagnostics");

const EDIT_TOOLS = MUTATING_TOOLS; // 单一来源 @aipanel/core：与 dsh 插件共用同一写类工具名单

/** 读取 provider 下发的诊断策略（缺失/非法 → 默认策略 + 告警） */
function readPolicy(): DiagnosticsPolicy {
  const raw = process.env[OPENCODE_ENV.DIAGNOSTICS];
  let parsed: Partial<DiagnosticsPolicy> | undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Partial<DiagnosticsPolicy>;
    } catch {
      log.warn("OPENCODE_DIAGNOSTICS is not valid JSON; falling back to defaults");
    }
  }
  return resolveDiagnosticsPolicy([DEFAULT_DIAGNOSTICS_POLICY, parsed], (message) =>
    log.warn(message),
  );
}

/** 自动诊断注入的字符上限截断（完整结果仍可调 run_diagnostics） */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n…（诊断输出过长，已截断；可调用 run_diagnostics 查看完整结果）`;
}

export default {
  id: "vite-plugin-aipanel/edit-diagnostics",
  async server(): Promise<Hooks> {
    const workspace = process.env[OPENCODE_ENV.WORKSPACE] || process.cwd();
    const policy = readPolicy();

    // run_diagnostics：agent 主动触发（受策略 exposeTool 管辖）
    const runDiagnosticsTool = tool({
      description: DIAGNOSTICS_TOOL_DESCRIPTION,
      args: {
        filePath: tool.schema
          .string()
          .optional()
          .describe("要诊断的文件路径（绝对路径或相对路径），不传则全量诊断整个项目"),
      },
      async execute(args, context) {
        const cwd = context.directory;
        let target: DiagnosticsTarget;
        let title: string;

        if (args.filePath) {
          const resolved = path.resolve(cwd, args.filePath);
          if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
          target = { kind: "file", file: resolved, cwd };
          title = `诊断结果: ${path.relative(cwd, resolved)}`;
        } else {
          target = { kind: "project", cwd };
          title = "全量诊断结果";
        }

        const body = renderDiagnostics(await runDiagnostics(target, policy, "manual"));
        return body ? `${title}\n\n${body}` : title;
      },
    });

    const hooks: Hooks = {
      "tool.execute.after": async (input, output) => {
        if (!EDIT_TOOLS.has(input.tool)) return;
        if (!policy.auto) return;

        const filePath = (input.args?.filePath as string) || "";
        if (!filePath) return;
        // 不再在这里按扩展名预过滤：跑哪些检查由各 check 的 extensions 决定
        const resolved = path.resolve(workspace, filePath);

        log.debug("Executing after hook", { tool: input.tool, filePath, processCwd: workspace });

        const result = await runDiagnostics(
          { kind: "edited", files: [resolved], cwd: workspace },
          policy,
          "edit",
        );

        const text = renderDiagnostics(result, {
          onlyFindings: true,
          maxFindingsPerSection: policy.maxFindingsPerSection,
        });
        if (text) output.output += "\n\n" + truncate(text, policy.maxMessageChars);

        // 结构化条目写进 metadata 供 UI 渲染
        const items = collectDiagnostics(result);
        if (items.length > 0) {
          const meta = (output.metadata ?? (output.metadata = {})) as Record<string, unknown>;
          const existing = (meta.diagnostics ?? (meta.diagnostics = {})) as Record<
            string,
            DiagnosticItem[]
          >;
          for (const item of items) {
            const key = item.file ?? resolved;
            existing[key] = [...(existing[key] ?? []), item];
          }
        }
      },
    };

    return policy.exposeTool ? { ...hooks, tool: { run_diagnostics: runDiagnosticsTool } } : hooks;
  },
};
