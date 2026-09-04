/**
 * 代码诊断引擎（质量门禁）——opencode 插件与 dsh 插件共用的同一实现。
 *
 * 职责：ESLint（Node API）+ vue-tsc --build（CLI）两类检查，支持单文件诊断与
 * 全量项目诊断，输出统一的分区文本格式。
 *
 * 本模块零运行时静态依赖：eslint / vue-tsc 均通过 createRequire 动态解析
 * （eslint 从被诊断的 workspace 解析，vue-tsc 从本模块自身 node_modules 解析），
 * 因此任何宿主（opencode / dsh）bundle 本模块后都可直接使用，无需用户安装检查器。
 */
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { createRequire } from "node:module";
import { SEVERITY_ERROR, SEVERITY_WARN } from "../common/constants";
import { createLogger } from "./node-logger";

const log = createLogger("Diagnostics");

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

/** 是否为可诊断的源码文件（供宿主钩子过滤 edit/write 目标） */
export function isJsFile(filePath: string): boolean {
  return JS_EXTENSIONS.has(path.extname(filePath));
}

// ESLint severity: 2=error, 1=warn → LSP DiagnosticSeverity: 1=Error, 2=Warning
// 参考 eslint/lib/shared/severity.js、shared/constants.ts

interface LintMessage {
  severity: number;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  ruleId: string | null;
}

/** LSP 风格诊断项（供宿主写入 metadata.diagnostics 等结构化输出） */
export interface DiagnosticItem {
  /** 所属文件路径（相对/绝对，按来源解析）；跨文件诊断（全量模式）时必有 */
  file?: string;
  severity: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  source: string;
}

export interface TscResult {
  rawOutput: string;
  exitCode: number;
  diagnostics?: DiagnosticItem[];
}

export interface EslintOutput {
  text?: string;
  diagnostics?: DiagnosticItem[];
}

export interface DiagnosticsResult {
  eslintOutput: EslintOutput;
  tscOutput: TscResult;
}

type ESLintConstructor = new (opts: { cwd: string }) => {
  lintFiles: (p: string) => Promise<Array<{ filePath: string; messages: LintMessage[] }>>;
};

let ESLintClass: ESLintConstructor | undefined;

/** 从被诊断的 workspace 解析 eslint（用户项目已安装）；解析失败则跳过 ESLint 检查 */
function loadESLint(workspace: string): void {
  if (ESLintClass) return;
  log.debug("Loading eslint", { workspace });
  try {
    const req = createRequire(path.join(workspace, "package.json"));
    const eslintModule = req("eslint");
    ESLintClass ??= eslintModule.ESLint ?? eslintModule.FlatESLint;
    log.debug("eslint loaded", { hasClass: !!ESLintClass });
  } catch (e) {
    log.warn("eslint not found", { error: (e as Error).message });
  }
}

/**
 * ESLint 检查，接受文件路径或 glob 模式。
 * 结果按 error / warning 分级格式化；warnings 数量超限时截断并注明。
 */
export async function lintFiles(
  pattern: string,
  cwd: string,
  warnLimit = 5,
): Promise<EslintOutput> {
  loadESLint(cwd);
  if (!ESLintClass) return {};
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

    if (messages.length === 0) return {};

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

    const diagnostics: DiagnosticItem[] = messages.map((m) => ({
      severity:
        m.severity === ESLINT_ERROR
          ? SEVERITY_ERROR
          : m.severity === ESLINT_WARN
            ? SEVERITY_WARN
            : m.severity,
      file: m.filePath,
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
    return {};
  }
}

// ---- vue-tsc ----

let _vueTscBin: string | null | undefined;

/**
 * 解析 vue-tsc CLI 路径。
 * 从本模块自身 node_modules 解析（vue-tsc 为本包 dependency），无需用户安装。
 * 注意：模块被宿主 bundle 后，import.meta.url 指向 bundle 文件（如 dsh-plugin/dist/index.js），
 * 因此宿主也须把 vue-tsc 声明为可解析依赖。
 */
function resolveVueTscBin(): string | null {
  if (_vueTscBin !== undefined) return _vueTscBin;
  try {
    const req = createRequire(import.meta.url);
    _vueTscBin = req.resolve("vue-tsc/bin/vue-tsc.js");
  } catch {
    _vueTscBin = null;
  }
  return _vueTscBin;
}

/** 从文件路径向上查找最近的 tsconfig.json 所在目录 */
export function findTsconfigDir(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  let dir = path.dirname(resolved);
  log.debug("findTsconfigDir start", { filePath: resolved });
  while (true) {
    const tsconfigPath = path.join(dir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      log.debug("findTsconfigDir found", { dir, tsconfigPath });
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      log.warn("findTsconfigDir not found", { filePath: resolved });
      return null;
    }
    dir = parent;
  }
}

/** 在工作区子目录中查找 tsconfig.json（不包括根目录；调用方已处理根目录场景） */
export function findAllTsconfigDirs(workspace: string): string[] {
  const dirs: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (fs.existsSync(path.join(full, "tsconfig.json"))) {
        dirs.push(full);
      }
      walk(full);
    }
  }
  walk(workspace);
  log.debug("findAllTsconfigDirs result", {
    workspace,
    count: dirs.length,
    dirs: dirs.map((d) => path.relative(workspace, d)),
  });
  return dirs;
}

/** 简单解析 vue-tsc 输出为 DiagnosticItem，可选按文件过滤 */
function parseTscDiags(
  rawOutput: string,
  filePath?: string,
  projectDir?: string,
): DiagnosticItem[] {
  const errorLinePat = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/;
  const diags: DiagnosticItem[] = [];
  const resolved = filePath ? path.resolve(filePath) : undefined;
  const lines = rawOutput.split("\n");

  for (const line of lines) {
    const match = errorLinePat.exec(line);
    if (match) {
      const [, file, lineNum, col, severity, code, message] = match;
      const resolvedFile = projectDir ? path.resolve(projectDir, file) : path.resolve(file);
      if (resolved) {
        if (resolvedFile !== resolved) continue;
      }
      diags.push({
        severity: severity === "error" ? SEVERITY_ERROR : SEVERITY_WARN,
        file: resolvedFile,
        range: {
          start: { line: Number(lineNum) - 1, character: Number(col) - 1 },
          end: { line: Number(lineNum) - 1, character: Number(col) - 1 },
        },
        message: `[TS${code}] ${message}`,
        source: "vue-tsc",
      });
    }
  }

  return diags;
}

/** 运行 vue-tsc --build --noEmit，返回原始输出 */
export async function runVueTsc(filePath: string | undefined, cwd: string): Promise<TscResult> {
  const dir = cwd;
  // 如果有文件路径，从文件向上找最近的 tsconfig.json 所在目录，
  // 确保 --build 使用正确的项目 tsconfig 而非 monorepo 根目录
  const projectDir = filePath ? (findTsconfigDir(filePath) ?? dir) : dir;
  log.debug("runVueTsc", {
    filePath: filePath || "(all)",
    cwd: dir,
    projectDir,
    processCwd: process.cwd(),
  });
  const bin = resolveVueTscBin();
  if (!bin) {
    log.warn("vue-tsc bin not found", { projectDir });
    return { rawOutput: "", exitCode: 0 };
  }

  const timeout = filePath ? 60000 : 120000;
  const maxBuffer = filePath ? 10 * 1024 * 1024 : 50 * 1024 * 1024;

  return new Promise((resolve) => {
    exec(
      `node "${bin}" --build --noEmit --pretty false`,
      { cwd: projectDir, timeout, maxBuffer },
      (error, stdout, stderr) => {
        let rawOutput = stdout + stderr;
        const killed = error?.killed;
        const exitCode = typeof error?.code === "number" ? error.code : killed ? 1 : 0;

        if (killed && !rawOutput) {
          rawOutput = "vue-tsc 检查超时，请尝试缩小检查范围或优化项目配置。";
        }

        const diagnostics = parseTscDiags(rawOutput, filePath, projectDir);

        // 单文件模式：保留目标文件的错误行及其续行（缩进的多行详情）
        if (filePath) {
          const resolved = path.resolve(filePath);
          const errorLinePat = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:/;
          const lines = rawOutput.split("\n");
          const filtered: string[] = [];
          let keep = false;

          for (const line of lines) {
            const m = errorLinePat.exec(line);
            if (m) {
              keep = path.resolve(projectDir, m[1]) === resolved;
            } else if (!/^\s/.test(line)) {
              keep = false;
            }
            if (keep) filtered.push(line);
          }

          rawOutput = filtered.join("\n");
        }

        log.debug("vue-tsc finished", {
          filePath: filePath || "(all)",
          exitCode,
          outputLength: rawOutput.length,
        });
        resolve({ rawOutput, exitCode, diagnostics });
      },
    );
  });
}

/** 并行运行 ESLint + vue-tsc 检查（单文件或 glob） */
export async function runAllChecks(pattern: string, cwd: string): Promise<DiagnosticsResult> {
  log.debug("runAllChecks", { pattern, cwd });
  const [eslintOutput, tscOutput] = await Promise.all([
    lintFiles(pattern, cwd),
    runVueTsc(pattern, cwd),
  ]);
  return { eslintOutput, tscOutput };
}

/**
 * 全量项目诊断：优先从根 tsconfig 运行一次 vue-tsc --build，
 * 根无 tsconfig 时回退到逐个子目录 build；ESLint 以 "." 全量扫描。
 */
export async function runProjectDiagnostics(workspace: string): Promise<DiagnosticsResult> {
  const tscDirs = fs.existsSync(path.join(workspace, "tsconfig.json"))
    ? [workspace]
    : findAllTsconfigDirs(workspace);
  log.debug("Tsc dirs to check", { count: tscDirs.length, dirs: tscDirs });

  const [eslintOutput, ...tscOutputs] = await Promise.all([
    lintFiles(".", workspace, 10),
    ...tscDirs.map((dir) => runVueTsc(undefined, dir)),
  ]);

  const mergedTsc: TscResult = {
    rawOutput: tscOutputs
      .flatMap((o) => o.rawOutput)
      .filter(Boolean)
      .join("\n"),
    exitCode: tscOutputs.reduce((max, o) => Math.max(max, o.exitCode), 0),
    diagnostics: tscOutputs.flatMap((o) => o.diagnostics ?? []),
  };

  return { eslintOutput, tscOutput: mergedTsc };
}

/** 组装统一的分区诊断文本（ESLint / vue-tsc，空结果显示占位文案） */
export function formatDiagnosticsSections(
  title: string,
  eslintOutput: EslintOutput,
  tscOutput: TscResult,
): string {
  const parts: string[] = [];

  parts.push("## ESLint\n\n" + (eslintOutput.text || "没有发现问题"));

  const tscLines = tscOutput.rawOutput.trim();
  parts.push("## vue-tsc\n\n" + (tscLines || "没有发现类型错误"));

  return `${title}\n\n` + parts.join("\n\n");
}
