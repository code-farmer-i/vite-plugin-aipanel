/**
 * AIPanel × DeepSeek Harness 插件
 *
 * 运行在 dsh 宿主进程（Cordis 插件），向 dsh agent 提供 AIPanel 能力：
 *  1. run_diagnostics 审查工具（对标 opencode 质量门禁，手动触发 ESLint + tsc）
 *  2. tools/post-execute：编辑工具（write/edit）执行后自动追加诊断回报（不做回滚）
 *
 */
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import {
  defineTool,
  type PostToolDecision,
  type ToolExecution,
  type ToolExecutionResult,
  type ToolRunContext,
  type ToolRuntime,
} from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";

export const name = "aipanel";
export const inject = ["tools", "subprocess"];

/** 来自 provider.start() 生成的 cordis overlay 注入的 config */
export interface AipanelPluginConfig {
  /** 宿主工作目录（用于诊断的默认 cwd） */
  cwd?: string;
  /** 编辑后是否自动补跑诊断 */
  autoDiagnose?: boolean;
}

/** 常见被诊断的源码扩展名 */
const JS_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
]);
const MUTATING_TOOLS = new Set(["write", "edit", "apply_patch"]);

/** 诊断子进程的输出上限与宽限时间（避免大仓库输出撑爆上下文） */
const STDOUT_MAX_BYTES = 200_000;
const STDOUT_SPILL_MAX_BYTES = 2_000_000;
const STDERR_MAX_BYTES = 100_000;
const GRACE_MS = 30_000;

export function apply(ctx: Context, config: AipanelPluginConfig = {}) {
  const cwd = config.cwd ?? process.cwd();
  const autoDiagnose = config.autoDiagnose ?? true;

  const tools: ToolRuntime = ctx.tools;
  const subprocess: SubprocessRuntime = ctx.subprocess;

  /** 以 npx 执行命令并收集 stdout；失败时返回错误信息（由调用方决定如何回报） */
  async function collectOutput(
    argv: string[],
    signal: AbortSignal,
  ): Promise<{ text: string; error?: string }> {
    try {
      const exe = await subprocess.resolveExecutable("npx", undefined, signal);
      const proc = subprocess.spawn({
        argv: [exe, ...argv],
        cwd,
        stdio: {
          stdin: "ignore",
          stdout: { maxBytes: STDOUT_MAX_BYTES, spill: { maxBytes: STDOUT_SPILL_MAX_BYTES } },
          stderr: { maxBytes: STDERR_MAX_BYTES },
        },
        graceMs: GRACE_MS,
        signal,
      });
      await proc.done;
      return { text: proc.collected.stdout?.readFrom(0)?.text ?? "" };
    } catch (e) {
      return { text: "", error: String(e) };
    }
  }

  /** 在目标目录运行 tsc/eslint，汇总诊断文本（collect 模式，带输出上限） */
  async function runDiagnostics(filePath: string, signal: AbortSignal): Promise<string> {
    const parts: string[] = [];

    // tsc：失败时注明跳过原因，便于排查宿主侧 npx 环境问题
    const tsc = await collectOutput(["tsc", "--noEmit", "--pretty", "false"], signal);
    if (tsc.error) parts.push("## tsc\n\n(diagnostics skipped: " + tsc.error + ")");
    else if (tsc.text.trim()) parts.push("## tsc\n\n" + tsc.text.trim());

    // eslint：未配置时静默忽略
    const eslint = await collectOutput(["eslint", filePath, "--format", "compact"], signal);
    if (eslint.text.trim()) parts.push("## eslint\n\n" + eslint.text.trim());

    return parts.join("\n\n");
  }

  // === 1) 审查工具：手动触发诊断 ===
  tools.register(
    defineTool({
      name: "run_diagnostics",
      description:
        "Run ESLint and TypeScript type checks on filePath and report problems. " +
        "Use after editing code to verify no lint/type errors before proceeding.",
      parameters: {
        filePath: {
          type: "string",
          required: true,
          description: "Absolute or cwd-relative file path to diagnose",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args: unknown, value: string) => [{ type: "text", text: value }],
      },
      async execute(args: { filePath: string }, exec: ToolRunContext) {
        return runDiagnostics(path.resolve(cwd, args.filePath), exec.signal).catch(
          (e) => "diagnostics failed: " + String(e),
        );
      },
    }),
  );

  // === 2) 编辑后自动诊断（不做回滚） ===
  ctx.on(
    "tools/post-execute",
    async (
      exec: ToolExecution,
      result: Readonly<ToolExecutionResult>,
      next: () => Promise<PostToolDecision>,
    ) => {
      const decision = await next();
      if (!autoDiagnose) return decision;
      if (!MUTATING_TOOLS.has(exec.name)) return decision;
      if (result.isError) return decision;
      if (decision.kind !== "accept") return decision;

      // exec.arguments 是 unknown，写工具自行校验；这里只取用到的字段
      const filePath = (exec.arguments as { filePath?: unknown } | undefined)?.filePath;
      if (typeof filePath !== "string" || !filePath) return decision;
      if (!JS_EXTENSIONS.has(path.extname(filePath))) return decision;

      const diag = await runDiagnostics(path.resolve(cwd, filePath), exec.signal).catch(
        () => "diagnostics unavailable",
      );
      const message = createUserMessage({
        content: [
          { type: "text", text: `Auto diagnostics after ${exec.name} (${filePath}):\n${diag}` },
        ],
        source: { kind: "plugin", plugin: name },
      });
      return { kind: "accept", additionalContexts: [message] };
    },
  );
}
