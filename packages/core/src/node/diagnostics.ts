/**
 * 代码诊断引擎（质量门禁）——opencode 插件与 dsh 插件共用的同一实现。
 *
 * 职责：ESLint（Node API）+ TypeScript 类型检查（CLI）两类检查，支持单文件诊断与
 * 全量项目诊断，输出统一的分区文本格式。
 *
 * 检查器一律优先用被诊断项目自身的版本：eslint / oxlint / tsc / vue-tsc 都先按项目解析，
 * 项目没装才回落到本包自带的 vue-tsc——老项目不会因为自带检查器版本过新而误判。
 *
 * 类型检查引擎按项目自动选择：package.json 直接依赖 vue/nuxt → vue-tsc（支持 .vue）；
 * 否则优先项目自身的 tsc（版本与项目一致、无 Volar 开销）。TS 5.6 起 `--build` 才允许
 * `--noEmit`，更早的项目引擎退化为逐项目 `-p --noEmit`（按 references 展开子项目）。
 *
 * 检查器均按运行时动态解析：通过 createRequire 从被诊断的 workspace 解析，
 * 因此任何宿主（opencode / dsh）bundle 本模块后都可直接使用，无需用户安装检查器。
 */
import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
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

/**
 * run_diagnostics 工具描述（单一来源，供 opencode / dsh 两侧插件引用）：
 * 只声明能力与支持的文件类型，不涉及内部使用的检查工具。
 */
export const DIAGNOSTICS_TOOL_DESCRIPTION = [
  "运行 Lint（ESLint / oxlint）与 TypeScript 类型诊断，返回诊断结果。",
  "",
  "**支持的文件类型**：",
  `- Lint：JavaScript / TypeScript / Vue 源码（${[...JS_EXTENSIONS].map((e) => `*${e}`).join(" ")}）；两引擎均安装时并行互补运行（诊断按来源标注）`,
  "- TypeScript 类型检查：*.ts *.tsx *.vue",
  "",
  "**何时使用此工具**：",
  "- 刚完成代码修改，想验证是否有 ESLint 错误或类型错误",
  "- 在提交代码前进行质量检查",
  "- 排查编辑器未显示但实际存在的类型问题",
  "- 不传参数可全量诊断整个项目",
].join("\n");

// ---- 依赖解析（统一入口：优先项目自身安装的检查器） ----

/** 解析缓存：同一目录会解析多个工具，key 带包名，避免互相覆盖；null 表示"解析不到"，同样缓存 */
function cachedResolve<T>(cache: Map<string, T>, key: string, resolve: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = resolve();
  cache.set(key, value);
  return value;
}

const _packageBinCache = new Map<string, string | null>();

/**
 * 从 basePkgJson 出发解析依赖包的 bin 绝对路径（解析不到返回 null）。
 * 包的 exports map 通常不暴露 bin 子路径，因此经 "<pkg>/package.json" 定位后按 bin 字段拼接。
 */
function resolvePackageBin(basePkgJson: string, pkgName: string, binName: string): string | null {
  return cachedResolve(_packageBinCache, `${basePkgJson}\0${pkgName}`, () => {
    try {
      const req = createRequire(basePkgJson);
      const pkgJsonPath = req.resolve(`${pkgName}/package.json`);
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
        bin?: string | Record<string, string>;
      };
      const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
      return binRel ? path.join(path.dirname(pkgJsonPath), binRel) : null;
    } catch {
      return null;
    }
  });
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
  /** 实际使用的类型检查引擎名（"tsc" / "vue-tsc"），用于分区标题；解析失败等极端场景缺省 */
  source?: string;
}

export interface EslintOutput {
  text?: string;
  diagnostics?: DiagnosticItem[];
  /** 实际运行的 lint 引擎（"ESLint" / "oxlint"）；缺省视为 ESLint（兼容旧调用方） */
  engines?: string[];
}

export interface DiagnosticsResult {
  eslintOutput: EslintOutput;
  tscOutput: TscResult;
}

type ESLintConstructor = new (opts: { cwd: string }) => {
  lintFiles: (p: string) => Promise<Array<{ filePath: string; messages: LintMessage[] }>>;
};

/** 各 workspace 的 ESLint 构造器缓存（用户项目装了什么大版本就用什么；解析失败缓存 null） */
const _eslintClassByBase = new Map<string, ESLintConstructor | null>();

/** 从被诊断的 workspace 解析 eslint（用户项目已安装）；解析失败则跳过 ESLint 检查 */
function loadESLint(workspace: string): ESLintConstructor | null {
  const basePkgJson = path.join(workspace, "package.json");
  return cachedResolve(_eslintClassByBase, basePkgJson, () => {
    log.debug("Loading eslint", { workspace });
    try {
      const req = createRequire(basePkgJson);
      const eslintModule = req("eslint") as {
        ESLint?: ESLintConstructor;
        FlatESLint?: ESLintConstructor;
      };
      const eslintClass = eslintModule.ESLint ?? eslintModule.FlatESLint ?? null;
      log.debug("eslint loaded", { hasClass: !!eslintClass });
      return eslintClass;
    } catch (e) {
      log.warn("eslint not found", { error: (e as Error).message });
      return null;
    }
  });
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
  const eslintClass = loadESLint(cwd);

  // create-vue 官方约定 ESLint + oxlint 互补并用（规则去重由项目的 eslint-plugin-oxlint 承担）：
  // 两引擎均可用时并行跑；仅可用其一则用其一；均不可用明确报"未运行"，不静默假装干净
  const [eslintOutput, oxlintOutput] = await Promise.all([
    eslintClass ? runEslintFiles(eslintClass, pattern, cwd, warnLimit) : Promise.resolve(null),
    runOxlintFiles(pattern, cwd, warnLimit),
  ]);

  const engines: string[] = [];
  const texts: string[] = [];
  const diagnostics: DiagnosticItem[] = [];
  for (const output of [eslintOutput, oxlintOutput]) {
    if (!output) continue;
    engines.push(...(output.engines ?? []));
    if (output.text) texts.push(output.text);
    diagnostics.push(...(output.diagnostics ?? []));
  }

  if (engines.length === 0) {
    return {
      text: `[Lint] 未运行：无法在 workspace "${cwd}" 解析到 eslint 或 oxlint`,
      diagnostics: [],
    };
  }

  return { text: texts.join("\n\n") || undefined, diagnostics, engines };
}

/** 把 lint 消息按 error/warning 分级格式化为文本行与 LSP 诊断项（ESLint / oxlint 共用） */
function formatLintMessages(
  messages: (LintMessage & { filePath: string })[],
  engine: { label: string; source: string },
  warnLimit: number,
): EslintOutput {
  if (messages.length === 0) return { engines: [engine.label] };

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
    message: `[${engine.label}] ${m.message} (${m.ruleId})`,
    source: engine.source,
  }));

  return {
    text: lines.length > 0 ? lines.join("\n") : undefined,
    diagnostics,
    engines: [engine.label],
  };
}

/** ESLint Node API 检查（引擎可用时由 lintFiles 调度） */
async function runEslintFiles(
  eslintClass: ESLintConstructor,
  pattern: string,
  cwd: string,
  warnLimit: number,
): Promise<EslintOutput> {
  try {
    const eslint = new eslintClass({ cwd });
    const results = await eslint.lintFiles(pattern);
    const messages: (LintMessage & { filePath: string })[] = results.flatMap((r) =>
      (r.messages ?? []).map((m) => ({ ...m, filePath: r.filePath })),
    );
    log.debug("ESLint lint", {
      pattern,
      fileCount: results.length,
      messageCount: messages.length,
    });
    return formatLintMessages(messages, { label: "ESLint", source: "eslint" }, warnLimit);
  } catch (err) {
    log.warn("ESLint failed", { pattern, error: (err as Error).message });
    return {
      text: `[ESLint] 运行失败：${(err as Error).message}（仅显示 TypeScript 诊断）`,
      diagnostics: [],
      engines: ["ESLint"],
    };
  }
}

// ---- oxlint（Rust linter，与 ESLint 互补；create-vue 约定 oxlint 先跑） ----

/** oxlint CLI 路径（从被诊断 workspace 解析，用户项目已安装才会启用） */
function resolveOxlintBin(workspace: string): string | null {
  return resolvePackageBin(path.join(workspace, "package.json"), "oxlint", "oxlint");
}

/** oxlint --format=json 的诊断条目（自有格式，非 ESLint 兼容数组） */
interface OxlintJsonDiagnostic {
  message?: string;
  /** 规则标识，形如 "eslint(no-unused-vars)" */
  code?: string;
  severity?: string;
  filename?: string;
  labels?: Array<{ span?: { line?: number; column?: number; length?: number } }>;
}

interface OxlintJsonOutput {
  diagnostics?: OxlintJsonDiagnostic[];
}

/** 从 oxlint JSON 输出提取规则名："eslint(no-unused-vars)" → "no-unused-vars" */
function oxlintRuleName(code: string | undefined): string | null {
  if (!code) return null;
  const match = /\(([^)]*)\)$/.exec(code);
  return match ? match[1] : code;
}

/** 解析 oxlint --format=json 输出（容忍 stdout 中混入的人类可读前缀消息） */
function parseOxlintOutput(stdout: string, cwd: string): (LintMessage & { filePath: string })[] {
  let parsed: OxlintJsonOutput | undefined;
  try {
    parsed = JSON.parse(stdout) as OxlintJsonOutput;
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(stdout.slice(start, end + 1)) as OxlintJsonOutput;
      } catch {
        parsed = undefined;
      }
    }
  }
  if (!parsed) throw new Error("无法解析 oxlint JSON 输出");

  return (parsed.diagnostics ?? []).flatMap((d) => {
    const filePath = d.filename
      ? path.isAbsolute(d.filename)
        ? d.filename
        : path.resolve(cwd, d.filename)
      : "";
    if (!filePath) return [];
    const span = d.labels?.[0]?.span;
    const line = span?.line ?? 1;
    const column = span?.column ?? 1;
    return [
      {
        // oxlint 无 endLine/endColumn，同行按 span.length 延伸近似
        severity: d.severity === "error" ? 2 : 1,
        line,
        column,
        endLine: line,
        endColumn: column + (span?.length ?? 0),
        message: d.message ?? "未知诊断",
        ruleId: oxlintRuleName(d.code),
        filePath,
      },
    ];
  });
}

/** oxlint CLI 检查（--format=json；未安装时静默跳过，由 ESLint 路径兜底报"未运行"） */
async function runOxlintFiles(
  pattern: string,
  cwd: string,
  warnLimit: number,
): Promise<EslintOutput> {
  const bin = resolveOxlintBin(cwd);
  if (!bin) return {};

  // 与 ESLint 默认行为对齐：忽略 node_modules（oxlint 默认不排除）
  const result = await execa(
    "node",
    [bin, "--format=json", "--ignore-pattern", "node_modules", pattern],
    { cwd, timeout: 60000, maxBuffer: 50 * 1024 * 1024, reject: false },
  );

  if (result.timedOut || result.isTerminated || result.isMaxBuffer) {
    log.warn("oxlint timed out", { pattern });
    return {
      text: "[oxlint] 运行失败：检查超时，请尝试缩小检查范围。",
      diagnostics: [],
      engines: ["oxlint"],
    };
  }

  try {
    const messages = parseOxlintOutput(result.stdout, cwd);
    log.debug("oxlint lint", {
      pattern,
      messageCount: messages.length,
      stderr: result.stderr || undefined,
    });
    return formatLintMessages(messages, { label: "oxlint", source: "oxlint" }, warnLimit);
  } catch (e) {
    log.warn("oxlint failed", { pattern, error: (e as Error).message });
    return {
      text: `[oxlint] 运行失败：${(e as Error).message}`,
      diagnostics: [],
      engines: ["oxlint"],
    };
  }
}

// ---- TypeScript 类型检查（引擎按项目自动选择，优先项目自身版本） ----

/** 类型检查引擎（bin / 标题名 / 归属 / 背后的 TypeScript 版本） */
interface TypeCheckEngine {
  /** CLI 入口绝对路径 */
  bin: string;
  /** 分区标题与 DiagnosticItem.source */
  source: "tsc" | "vue-tsc";
  /** 项目自身安装 / 本包自带兜底（日志用） */
  origin: "workspace" | "bundled";
  /** 引擎背后的 TypeScript 版本（决定 CLI 参数）；解析不到为 null，走最保守的 -p 模式 */
  tsVersion: string | null;
}

/** 没有项目 package.json 时共用同一份自带引擎解析结果 */
const BUNDLED_ENGINE_KEY = "<bundled>";

const _engineCache = new Map<string, TypeCheckEngine | null>();
const _tsVersionCache = new Map<string, string | null>();

/** 从起始目录向上查找最近的 package.json 所在目录（找不到返回 null） */
function nearestPackageJsonDir(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** package.json 直接依赖（含 dev）是否含 vue / nuxt（Vue 技术栈信号） */
function isVuePackage(pkgDir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "vue" in deps || "nuxt" in deps;
  } catch {
    return false;
  }
}

/** 读取 package.json 的 name / version（读不到返回 null） */
function readPackageMeta(pkgJsonPath: string): { name?: string; version?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { name?: string; version?: string };
  } catch {
    return null;
  }
}

/**
 * 引擎背后的 TypeScript 版本：tsc 直接看自己所在包的版本；
 * vue-tsc 则解析它实际会加载的那份 typescript（peer 依赖）。
 */
function resolveEngineTsVersion(bin: string): string | null {
  const pkgDir = nearestPackageJsonDir(path.dirname(bin));
  if (!pkgDir) return null;
  return cachedResolve(_tsVersionCache, pkgDir, () => {
    const own = readPackageMeta(path.join(pkgDir, "package.json"));
    if (own?.name === "typescript" && own.version) return own.version;

    try {
      const req = createRequire(path.join(pkgDir, "package.json"));
      return readPackageMeta(req.resolve("typescript/package.json"))?.version ?? null;
    } catch {
      return null;
    }
  });
}

/** 把 bin 解析结果包装成引擎描述（解析不到返回 null） */
function toEngine(
  bin: string | null,
  source: TypeCheckEngine["source"],
  origin: TypeCheckEngine["origin"],
): TypeCheckEngine | null {
  return bin ? { bin, source, origin, tsVersion: resolveEngineTsVersion(bin) } : null;
}

/** 项目自身安装的 tsc / vue-tsc（版本与项目一致） */
function resolveWorkspaceEngine(pkgDir: string, kind: "tsc" | "vue-tsc"): TypeCheckEngine | null {
  const basePkgJson = path.join(pkgDir, "package.json");
  return kind === "tsc"
    ? toEngine(resolvePackageBin(basePkgJson, "typescript", "tsc"), "tsc", "workspace")
    : toEngine(resolvePackageBin(basePkgJson, "vue-tsc", "vue-tsc"), "vue-tsc", "workspace");
}

/**
 * 本包自带的 vue-tsc（项目没装检查器时的兜底；tsc 超集，能检查 .vue）。
 * 注意：模块被宿主 bundle 后 import.meta.url 指向 bundle 文件（如 dsh-plugin/dist/index.js），
 * 因此宿主也须把 vue-tsc 声明为可解析依赖。
 */
function resolveBundledVueTscEngine(): TypeCheckEngine | null {
  return toEngine(resolvePackageBin(import.meta.url, "vue-tsc", "vue-tsc"), "vue-tsc", "bundled");
}

/**
 * 解析类型检查引擎：一律优先项目自身的版本（与项目的 tsconfig / TypeScript 版本匹配，老项目
 * 不会因为自带检查器版本过新而误判）。Vue 项目（vue/nuxt 依赖）用 vue-tsc——只有它能检查
 * .vue；非 Vue 项目优先项目自身的 tsc（React 等纯 TS 项目无需 Volar 层）。项目都没装才回落
 * 到本包自带的 vue-tsc。
 */
function resolveTypeCheckEngine(projectDir: string): TypeCheckEngine | null {
  const pkgDir = nearestPackageJsonDir(projectDir);
  return cachedResolve(_engineCache, pkgDir ?? BUNDLED_ENGINE_KEY, () => {
    if (!pkgDir) return resolveBundledVueTscEngine();

    const candidates = isVuePackage(pkgDir)
      ? [resolveWorkspaceEngine(pkgDir, "vue-tsc")]
      : [resolveWorkspaceEngine(pkgDir, "tsc"), resolveWorkspaceEngine(pkgDir, "vue-tsc")];
    for (const engine of candidates) {
      if (engine) return engine;
    }
    return resolveBundledVueTscEngine();
  });
}

/** TS 5.6 起 `--build` 才允许 `--noEmit`（更早版本直接报 TS5094） */
const BUILD_NO_EMIT_MIN_TS = { major: 5, minor: 6 } as const;

/**
 * 引擎的 TypeScript 是否**确定**支持 `--build --noEmit`（TS 5.6 起才允许）。
 * 版本解析不到时按不支持处理：`-p` 模式在任何 TS 版本上都成立，
 * 而猜错方向的代价是老项目直接收到 TS5094、类型检查整体落空。
 */
function supportsBuildNoEmit(tsVersion: string | null): boolean {
  if (!tsVersion) return false;
  const [major, minor] = tsVersion.split(".").map((part) => Number.parseInt(part, 10));
  return (
    major > BUILD_NO_EMIT_MIN_TS.major ||
    (major === BUILD_NO_EMIT_MIN_TS.major && minor >= BUILD_NO_EMIT_MIN_TS.minor)
  );
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

/** 简单解析 tsc 输出为 DiagnosticItem，可选按文件过滤 */
function parseTscDiags(
  rawOutput: string,
  filePath?: string,
  projectDir?: string,
  source = "tsc",
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
        source,
      });
    }
  }

  return diags;
}

/**
 * 只保留目标文件的类型检查输出（含缩进续行）：tsc 输出行形如 `path(line,col): error TSxxxx: msg`，
 * 详情续行以空白开头。单文件路径与批量路径共用同一过滤规则。
 */
function filterTscOutputForFile(rawOutput: string, filePath: string, projectDir: string): string {
  const resolved = path.resolve(filePath);
  const errorLinePat = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:/;
  const filtered: string[] = [];
  let keep = false;

  for (const line of rawOutput.split("\n")) {
    const m = errorLinePat.exec(line);
    if (m) {
      keep = path.resolve(projectDir, m[1]) === resolved;
    } else if (!/^\s/.test(line)) {
      keep = false;
    }
    if (keep) filtered.push(line);
  }

  return filtered.join("\n");
}

/** tsc --showConfig 输出（只取展开项目图所需字段） */
interface ResolvedTsconfig {
  files?: string[];
  include?: string[];
  references?: Array<{ path?: string }>;
}

/**
 * 让引擎自己解析 tsconfig（会展开 extends）；失败返回 null。
 * 配置路径一律相对 projectDir 传入：tsc 对绝对 -p 与相对 -p 的输出路径基准不同，
 * 相对写法才能让诊断路径稳定地相对 cwd（= projectDir）解析。
 */
async function readResolvedTsconfig(
  engine: TypeCheckEngine,
  configPath: string,
  projectDir: string,
): Promise<ResolvedTsconfig | null> {
  const result = await execa(
    "node",
    [
      engine.bin,
      "-p",
      projectRelativeConfig(projectDir, configPath),
      "--showConfig",
      "--pretty",
      "false",
    ],
    { cwd: projectDir, timeout: 30000, maxBuffer: 10 * 1024 * 1024, reject: false },
  ).catch(() => null);
  if (!result || result.timedOut || result.isTerminated || result.isMaxBuffer) return null;

  const stdout = result.stdout ?? "";
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as ResolvedTsconfig;
  } catch {
    return null;
  }
}

/**
 * 老版本 TS 需要逐个 `-p` 检查的项目配置：solution 式根配置（files 为空、只声明 references）
 * 自身没有程序，必须跟着 references 展开到真正的子项目，否则会"跑了检查但什么都没查"。
 */
async function resolveProjectConfigs(
  engine: TypeCheckEngine,
  projectDir: string,
): Promise<string[]> {
  const configs: string[] = [];
  const visited = new Set<string>();

  const visit = async (configPath: string): Promise<void> => {
    const resolved = path.resolve(configPath);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    // 解析不出配置时按"自身有程序"处理：让 -p 直接报错，而不是静默跳过
    const config = await readResolvedTsconfig(engine, resolved, projectDir);
    const hasProgram =
      !config || (config.files?.length ?? 0) > 0 || (config.include?.length ?? 0) > 0;
    if (hasProgram) configs.push(resolved);
    for (const ref of config?.references ?? []) {
      if (ref.path) await visit(path.resolve(path.dirname(resolved), ref.path));
    }
  };

  const rootConfig = path.join(projectDir, "tsconfig.json");
  await visit(fs.existsSync(rootConfig) ? rootConfig : projectDir);
  return configs;
}

/** 配置相对 projectDir 的写法（tsc 相对 -p 才有稳定的输出路径基准） */
function projectRelativeConfig(projectDir: string, configPath: string): string {
  return path.relative(projectDir, configPath) || ".";
}

/**
 * 类型检查的参数组：TS 5.6 起一次 `--build --noEmit` 覆盖整个项目图；
 * 更早的 TS 不允许该组合（`-b` 不带 --noEmit 会真实写产物），退化为逐项目 `-p --noEmit`。
 */
async function typeCheckArgGroups(
  engine: TypeCheckEngine,
  projectDir: string,
): Promise<string[][]> {
  const pretty = ["--pretty", "false"];
  if (supportsBuildNoEmit(engine.tsVersion)) return [["--build", "--noEmit", ...pretty]];
  const configs = await resolveProjectConfigs(engine, projectDir);
  return configs.map((config) => [
    "-p",
    projectRelativeConfig(projectDir, config),
    "--noEmit",
    ...pretty,
  ]);
}

/** 跑一次类型检查 CLI，返回原始输出与退出码（超时/被杀按失败处理） */
async function runTypeCheckCli(
  engine: TypeCheckEngine,
  args: string[],
  cwd: string,
  timeout: number,
  maxBuffer: number,
): Promise<{ rawOutput: string; exitCode: number }> {
  const result = await execa("node", [engine.bin, ...args], {
    cwd,
    timeout,
    maxBuffer,
    reject: false,
  });
  let rawOutput = result.stdout + result.stderr;
  const killed = result.timedOut || result.isTerminated || result.isMaxBuffer;
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : killed ? 1 : 0;
  if (killed && !rawOutput) {
    rawOutput = `${engine.source} 检查超时，请尝试缩小检查范围或优化项目配置。`;
  }
  return { rawOutput, exitCode };
}

/** 运行 TypeScript 类型检查（引擎按项目自动选择，优先项目自身版本），返回原始输出 */
export async function runTypeCheck(filePath: string | undefined, cwd: string): Promise<TscResult> {
  const dir = cwd;
  // 如果有文件路径，从文件向上找最近的 tsconfig.json 所在目录，
  // 确保使用正确的项目 tsconfig 而非 monorepo 根目录
  const projectDir = filePath ? (findTsconfigDir(filePath) ?? dir) : dir;
  log.debug("runTypeCheck", {
    filePath: filePath || "(all)",
    cwd: dir,
    projectDir,
    processCwd: process.cwd(),
  });
  const engine = resolveTypeCheckEngine(projectDir);
  if (!engine) {
    log.warn("type-check bin not found", { projectDir });
    return { rawOutput: "", exitCode: 0 };
  }

  const timeout = filePath ? 60000 : 120000;
  const maxBuffer = filePath ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  const argGroups = await typeCheckArgGroups(engine, projectDir);
  const results = await Promise.all(
    argGroups.map((args) => runTypeCheckCli(engine, args, projectDir, timeout, maxBuffer)),
  );

  let rawOutput = results
    .map((result) => result.rawOutput)
    .filter(Boolean)
    .join("\n");
  const exitCode = results.reduce((max, result) => Math.max(max, result.exitCode), 0);

  const diagnostics = parseTscDiags(rawOutput, filePath, projectDir, engine.source);

  // 单文件模式：保留目标文件的错误行及其续行（缩进的多行详情）
  if (filePath) {
    rawOutput = filterTscOutputForFile(rawOutput, filePath, projectDir);
  }

  log.debug("type-check finished", {
    engine: engine.source,
    engineOrigin: engine.origin,
    tsVersion: engine.tsVersion,
    filePath: filePath || "(all)",
    exitCode,
    outputLength: rawOutput.length,
  });

  return { rawOutput, exitCode, diagnostics, source: engine.source };
}

/**
 * 多文件类型检查：按最近的 tsconfig 项目分组，每个项目只检查一次
 * （TS >= 5.6 为一次 `--build --noEmit`，更早的 TS 按 references 逐项目 `-p`），
 * 再把项目输出切分回各文件（与单文件路径共用 filterTscOutputForFile）。
 * 一次编辑批次里的 N 个文件因此从 N 次项目构建降到 1 次。
 */
export async function runTypeChecksForFiles(
  files: string[],
  cwd: string,
): Promise<Map<string, TscResult>> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const resolved = path.resolve(file);
    const projectDir = findTsconfigDir(resolved) ?? cwd;
    const group = groups.get(projectDir);
    if (group) group.push(resolved);
    else groups.set(projectDir, [resolved]);
  }

  const results = new Map<string, TscResult>();
  for (const [projectDir, group] of groups) {
    // 单个项目失败降级为空结果，不让整批诊断落空
    const whole = await runTypeCheck(undefined, projectDir).catch((): TscResult => ({
      rawOutput: "",
      exitCode: 0,
    }));
    for (const file of group) {
      results.set(file, {
        rawOutput: filterTscOutputForFile(whole.rawOutput, file, projectDir),
        exitCode: whole.exitCode,
        diagnostics: (whole.diagnostics ?? []).filter((d) => d.file === file),
        source: whole.source,
      });
    }
  }
  return results;
}

/** 并行运行 ESLint + 类型检查（单文件或 glob） */
export async function runAllChecks(pattern: string, cwd: string): Promise<DiagnosticsResult> {
  log.debug("runAllChecks", { pattern, cwd });
  const [eslintOutput, tscOutput] = await Promise.all([
    lintFiles(pattern, cwd),
    runTypeCheck(pattern, cwd),
  ]);
  return { eslintOutput, tscOutput };
}

/**
 * 批量运行 ESLint + 类型检查：Lint 逐文件（ESLint 进程内、oxlint 单次 CLI），
 * 类型检查按 tsconfig 项目合并为一次（见 runTypeChecksForFiles）。
 * 返回"文件绝对路径 → 诊断结果"，供 step 边界的一次性收尾诊断使用。
 */
export async function runAllChecksForFiles(
  files: string[],
  cwd: string,
): Promise<Map<string, DiagnosticsResult>> {
  const targets = [...new Set(files.map((file) => path.resolve(file)))];
  // 耗时主体是类型检查：按 tsconfig 项目合并为一次。
  // Lint 逐文件串行执行，避免一次批量编辑同时拉起 N 个 linter 进程。
  const tscByFile = await runTypeChecksForFiles(targets, cwd);
  const results = new Map<string, DiagnosticsResult>();
  for (const file of targets) {
    results.set(file, {
      eslintOutput: await lintFiles(file, cwd),
      tscOutput: tscByFile.get(file) ?? { rawOutput: "", exitCode: 0 },
    });
  }
  return results;
}

/**
 * 全量项目诊断：优先从根 tsconfig 运行一次类型检查 --build，
 * 根无 tsconfig 时回退到逐个子目录 build；ESLint 以 "." 全量扫描。
 */
export async function runProjectDiagnostics(workspace: string): Promise<DiagnosticsResult> {
  const tscDirs = fs.existsSync(path.join(workspace, "tsconfig.json"))
    ? [workspace]
    : findAllTsconfigDirs(workspace);
  log.debug("Tsc dirs to check", { count: tscDirs.length, dirs: tscDirs });

  const [eslintOutput, ...tscOutputs] = await Promise.all([
    lintFiles(".", workspace, 10),
    ...tscDirs.map((dir) => runTypeCheck(undefined, dir)),
  ]);

  const mergedTsc: TscResult = {
    rawOutput: tscOutputs
      .flatMap((o) => o.rawOutput)
      .filter(Boolean)
      .join("\n"),
    exitCode: tscOutputs.reduce((max, o) => Math.max(max, o.exitCode), 0),
    diagnostics: tscOutputs.flatMap((o) => o.diagnostics ?? []),
    source: tscOutputs.find((o) => o.source)?.source,
  };

  return { eslintOutput, tscOutput: mergedTsc };
}

/** 类型检查分区标题（单一来源：跟随实际引擎 tsc / vue-tsc） */
export function tscSectionTitle(tscOutput: TscResult): string {
  return tscOutput.source ?? "tsc";
}

/** Lint 分区标题（单一来源：跟随实际运行的引擎组合，如 "ESLint + oxlint"） */
export function lintSectionTitle(lintOutput: EslintOutput): string {
  return lintOutput.engines?.length ? lintOutput.engines.join(" + ") : "ESLint";
}

/** 分区发现被条数上限折叠时的提示（自动诊断摘要与 run_diagnostics 完整输出的分界） */
export function omittedFindingsHint(omitted: number): string {
  return `…还有 ${omitted} 条，完整结果请调用 run_diagnostics`;
}

/**
 * 把分区正文的发现限制在 maxFindings 条以内，超出部分折叠成一行省略提示。
 * 不传上限或未超限时原样返回（run_diagnostics 手动路径的完整输出语义不变）。
 */
function boundFindings(
  text: string | undefined,
  maxFindings: number | undefined,
): string | undefined {
  if (!maxFindings || !text) return text;
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length <= maxFindings) return text;
  return [...lines.slice(0, maxFindings), omittedFindingsHint(lines.length - maxFindings)].join(
    "\n",
  );
}

/**
 * 组装统一的分区诊断文本（Lint / 类型检查）。
 * 默认保留空分区的占位文案（run_diagnostics 要正面回答"有没有问题"）；
 * `onlyFindings: true` 只输出有发现的分区、全空返回空串（编辑后自动诊断不刷占位噪音）；
 * `maxFindingsPerSection` 把每个分区的发现折叠成有界摘要——编辑后自动诊断每个 step 都会投递，
 * 因此用条数上限控制重复成本，完整结果仍由不带上限的 run_diagnostics 给出。
 * `title` 允许为空串，此时直接返回分区正文（追加式投递场景无需标题）。
 */
export function formatDiagnosticsSections(
  title: string,
  eslintOutput: EslintOutput,
  tscOutput: TscResult,
  options: { onlyFindings?: boolean; maxFindingsPerSection?: number } = {},
): string {
  const lintLines = boundFindings(eslintOutput.text, options.maxFindingsPerSection);
  const tscLines = boundFindings(tscOutput.rawOutput.trim(), options.maxFindingsPerSection);
  const parts: string[] = [];

  if (!options.onlyFindings || lintLines) {
    parts.push(`## ${lintSectionTitle(eslintOutput)}\n\n` + (lintLines || "没有发现问题"));
  }
  if (!options.onlyFindings || tscLines) {
    parts.push(`## ${tscSectionTitle(tscOutput)}\n\n` + (tscLines || "没有发现类型错误"));
  }

  if (parts.length === 0) return "";
  const body = parts.join("\n\n");
  return title ? `${title}\n\n${body}` : body;
}
