/**
 * 代码诊断引擎（质量门禁）——opencode 插件与 dsh 插件共用的同一实现。
 *
 * 检查来源由用户经 vite 插件 `providerOptions.diagnostics.checks` 配置：内置引擎（ESLint/oxlint
 * 与 tsc/vue-tsc）或项目里的任意命令（输出经适配器归一）。对调用方只暴露一个深入口
 * {@link runDiagnostics}（目标 + 策略 + 阶段 → 有序分区），引擎探测、批量归并、命令执行、
 * 输出适配与严重度门槛都藏在实现里。
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
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import { createRequire } from "node:module";
import { SEVERITY_ERROR, SEVERITY_WARN } from "../common/constants";
import {
  BUILTIN_LINTERS,
  COMMAND_CHECK_TIMEOUT_MS,
  SOURCE_EXTENSIONS,
  checkRunsInPhase,
  checkRunsOnTarget,
  isCommandCheck,
  isLinterPreset,
  isTypecheckCheck,
  matchesExtensions,
  type CommandCheck,
  type BuiltinLinterSpec,
  type DiagnosticsAdapter,
  type DiagnosticsAdapterInput,
  type DiagnosticsAdapterOutput,
  type DiagnosticsFormat,
  type DiagnosticsPhase,
  type DiagnosticsPolicy,
  type LinterPresetCheck,
  type TypecheckCheck,
} from "../common/diagnostics";
import type { AIPanelDiagnosticEntry } from "../common/types";
import { createLogger } from "./node-logger";

const log = createLogger("Diagnostics");

/** 常见被诊断的源码扩展名（单一来源：@aipanel/core 的 SOURCE_EXTENSIONS） */
const JS_EXTENSIONS = new Set(SOURCE_EXTENSIONS);

/** 是否为可诊断的源码文件（供宿主钩子过滤 edit/write 目标） */
export function isJsFile(filePath: string): boolean {
  return JS_EXTENSIONS.has(path.extname(filePath));
}

/**
 * run_diagnostics 工具描述（单一来源，供 opencode / dsh 两侧插件引用）：
 * 只声明能力与支持的文件类型，不涉及内部使用的检查工具（检查来源由用户配置，可能是项目命令）。
 */
export const DIAGNOSTICS_TOOL_DESCRIPTION = [
  "运行项目配置的代码检查（默认 Lint 与 TypeScript 类型诊断），返回诊断结果。",
  "",
  "**支持的文件类型**：",
  `- Lint：JavaScript / TypeScript / Vue 源码（${[...JS_EXTENSIONS].map((e) => `*${e}`).join(" ")}）；项目同时装有 ESLint 与 oxlint 时互补运行（诊断按来源标注）`,
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
}

/** 把 lint 消息按 error/warning 分级格式化为文本行与 LSP 诊断项（各 lint 适配器共用） */
function formatLintMessages(
  messages: (LintMessage & { filePath: string })[],
  engine: { label: string; source: string },
  warnLimit: number,
  minSeverity: "error" | "warning" = "warning",
): EslintOutput {
  const ESLINT_ERROR = 2;
  const ESLINT_WARN = 1;
  // 门槛过滤放在格式化之前：文本与结构化条目一起收紧，两者不会漂移
  const kept =
    minSeverity === "error" ? messages.filter((m) => m.severity === ESLINT_ERROR) : messages;
  if (kept.length === 0) return {};

  const lines: string[] = [];
  const errors = kept.filter((m) => m.severity === ESLINT_ERROR);
  const warnings = kept.filter((m) => m.severity === ESLINT_WARN);

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
  };
}

// ---- oxlint 输出解析（供 oxlint 预设的适配器复用） ----

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

// ---- 分区化结果与深入口 ----

/** 诊断分区：一个检查在一段目标上的产出 */
export interface DiagnosticsSection {
  /** 分区标题：check 的 name，或内置引擎标题（ESLint + oxlint / vue-tsc） */
  name: string;
  /** 所属目标文件（相对项目根）；仅编辑后自动诊断按文件拆分时存在 */
  target?: string;
  /** 模型可见正文；无内容时缺省（自动诊断据此跳过该分区） */
  text?: string;
  /** LSP 坐标结构化条目（0-based），供 canonical 输出与诊断卡片使用 */
  diagnostics: DiagnosticItem[];
}

/** 诊断结果：有序分区列表（历史上是写死的 { eslintOutput, tscOutput }，现已泛化） */
export interface DiagnosticsResult {
  sections: DiagnosticsSection[];
}

/** 诊断目标：agent 调工具（单文件 / 全量）或编辑后自动诊断（本步编辑过的文件） */
export type DiagnosticsTarget =
  | { kind: "file"; file: string; cwd: string }
  | { kind: "project"; cwd: string }
  | { kind: "edited"; files: string[]; cwd: string };

/** 渲染选项 */
export interface RenderDiagnosticsOptions {
  /** 只输出有发现的分区（编辑后自动诊断；全空返回空串） */
  onlyFindings?: boolean;
  /** 每个分区的发现条数上限（超出折叠成一行提示） */
  maxFindingsPerSection?: number;
}

/** 类型检查分区标题（单一来源：跟随实际引擎 tsc / vue-tsc） */
/** 类型检查分区标题（单一来源：跟随实际引擎 tsc / vue-tsc） */
export function tscSectionTitle(tscOutput: TscResult): string {
  return tscOutput.source ?? "tsc";
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

/** 展示用路径：项目内用相对路径，项目外（会走出项目根）直接用绝对路径 */
function displayPath(cwd: string, file: string): string {
  const rel = path.relative(cwd, file);
  return rel.startsWith("..") || path.isAbsolute(rel) ? file : rel;
}

/** 目标文件绝对路径清单（项目级为空） */
function targetFiles(target: DiagnosticsTarget): string[] {
  if (target.kind === "file") return [path.resolve(target.file)];
  if (target.kind === "edited") return [...new Set(target.files.map((file) => path.resolve(file)))];
  return [];
}

/** 编辑后自动诊断按文件拆分区（单文件 / 全量诊断不拆） */
function splitsByFile(target: DiagnosticsTarget): boolean {
  return target.kind === "edited";
}

/** 严重度门槛过滤（结构化条目） */
function filterBySeverity(
  items: readonly DiagnosticItem[],
  severity: "error" | "warning",
): DiagnosticItem[] {
  return severity === "error"
    ? items.filter((item) => item.severity === SEVERITY_ERROR)
    : [...items];
}

/** 把结构化条目渲染成统一文本行（用户适配器提供 diagnostics 时由这里统一渲染） */
function renderDiagnosticLines(items: readonly DiagnosticItem[]): string {
  return items
    .map((item) => {
      const level = item.severity === SEVERITY_ERROR ? "ERROR" : "WARN";
      const file = item.file ?? "";
      const { line, character } = item.range.start;
      return `${level} [${file}:${line + 1}:${character + 1}] ${item.message}`;
    })
    .join("\n");
}

/** 1-based 展示条目（client 卡片协议）→ 0-based LSP 条目 */
function entryToDiagnosticItem(entry: AIPanelDiagnosticEntry, source: string): DiagnosticItem {
  return {
    file: entry.file,
    severity: entry.severity === "error" ? SEVERITY_ERROR : SEVERITY_WARN,
    range: {
      start: { line: entry.line - 1, character: entry.column - 1 },
      end: { line: entry.line - 1, character: entry.column - 1 },
    },
    message: entry.message,
    source,
  };
}

/** 校验并转换用户适配器 / `aipanel-json` 协议给出的条目（1-based） */
function normalizeEntries(value: unknown, source: string): DiagnosticItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("diagnostics 必须是数组");
  return value.map((raw, index) => {
    const at = `diagnostics[${index}]`;
    if (!raw || typeof raw !== "object") throw new Error(`${at} 必须是对象`);
    const entry = raw as Partial<AIPanelDiagnosticEntry>;
    if (typeof entry.file !== "string" || !entry.file)
      throw new Error(`${at}.file 必须是非空字符串`);
    if (typeof entry.line !== "number" || entry.line < 1)
      throw new Error(`${at}.line 必须是 ≥ 1 的数字`);
    if (typeof entry.column !== "number" || entry.column < 1)
      throw new Error(`${at}.column 必须是 ≥ 1 的数字`);
    if (entry.severity !== "error" && entry.severity !== "warning")
      throw new Error(`${at}.severity 必须是 "error" 或 "warning"`);
    if (typeof entry.message !== "string") throw new Error(`${at}.message 必须是字符串`);
    return entryToDiagnosticItem(entry as AIPanelDiagnosticEntry, source);
  });
}

/** 从可能夹带人类可读内容的输出里取出 JSON 值（对象或数组都可） */
function extractJsonValue(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // 容忍前后夹带：取第一个 { 或 [ 到最后一个 } 或 ]
    const starts = [raw.indexOf("{"), raw.indexOf("[")].filter((index) => index >= 0);
    if (starts.length === 0) throw new Error("未找到 JSON 输出");
    const start = Math.min(...starts);
    const close = raw[start] === "{" ? "}" : "]";
    const end = raw.lastIndexOf(close);
    if (end <= start) throw new Error("未找到 JSON 输出");
    return JSON.parse(raw.slice(start, end + 1));
  }
}

/** 解析 `eslint --format json` 输出（容忍前后夹带的人类可读内容），忽略提示单独返回 */
function parseEslintJson(
  raw: string,
  cwd: string,
): { messages: (LintMessage & { filePath: string })[]; ignored: string[] } {
  const parsed = extractJsonValue(raw) as Array<{
    filePath?: string;
    messages?: LintMessage[];
  }>;
  if (!Array.isArray(parsed)) throw new Error("顶层必须是数组");
  const all = parsed.flatMap((file) =>
    (file.messages ?? []).map((message) => ({
      ...message,
      filePath: file.filePath ? path.resolve(cwd, file.filePath) : "",
    })),
  );
  return {
    messages: all.filter((message) => message.filePath && !isEslintIgnoreNotice(message)),
    ignored: all
      .filter((message) => message.filePath && isEslintIgnoreNotice(message))
      .map((m) => m.filePath),
  };
}

/**
 * ESLint 对"被显式传入、但不在配置范围内"的文件会回一条 ruleId=null 的忽略提示
 * （`File ignored because no matching configuration was supplied`）。
 * 它不是发现：编辑后阶段每步都投递会变成噪音，因此从发现里剔除；手动诊断时另给一行说明
 * （否则会"假装干净"——用户以为查过了，其实这个文件根本没被 lint）。
 */
function isEslintIgnoreNotice(message: LintMessage): boolean {
  return (
    (message.ruleId ?? null) === null &&
    typeof message.message === "string" &&
    message.message.startsWith("File ignored because")
  );
}

/** 只保留达门槛的 tsc 输出行（含缩进续行），行格式与 parseTscDiags 保持一致 */
function filterTscOutputBySeverity(rawOutput: string, minSeverity: "error" | "warning"): string {
  if (minSeverity === "warning" || !rawOutput) return rawOutput;
  const errorLinePat = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:/;
  const kept: string[] = [];
  let keep = false;
  for (const line of rawOutput.split("\n")) {
    const match = errorLinePat.exec(line);
    if (match) keep = match[4] === "error";
    else if (!/^\s/.test(line)) keep = false;
    if (keep) kept.push(line);
  }
  return kept.join("\n");
}

/** 按门槛收窄类型检查结果（文本与结构化条目一起，避免两者漂移） */
function applyTscSeverity(result: TscResult, minSeverity: "error" | "warning"): TscResult {
  if (minSeverity === "warning") return result;
  return {
    ...result,
    rawOutput: filterTscOutputBySeverity(result.rawOutput, minSeverity),
    diagnostics: (result.diagnostics ?? []).filter((item) => item.severity === SEVERITY_ERROR),
  };
}

/** 空分区占位：手动诊断要正面回答"有没有问题"；自动诊断不投递占位噪音 */
function emptySectionText(
  kind: "lint" | "typecheck" | "command",
  phase: DiagnosticsPhase,
  severity: "error" | "warning",
): string | undefined {
  if (phase !== "manual") return undefined;
  if (kind === "typecheck") return "没有发现类型错误";
  return severity === "error" ? "没有发现错误" : "没有发现问题";
}

/** 一个检查在一段目标上的原始产出（notes 是"没跑/没检查"之类的说明，只在手动诊断里展示） */
interface CheckOutcome {
  text?: string;
  diagnostics: DiagnosticItem[];
  notes?: string[];
}

/** 组装一个分区：门槛过滤 + 文本兜底（有条目时由我们统一渲染） */
function buildSection(
  name: string,
  target: string | undefined,
  outcome: { text?: string; diagnostics?: readonly DiagnosticItem[]; notes?: readonly string[] },
  phase: DiagnosticsPhase,
  severity: "error" | "warning",
  kind: "lint" | "typecheck" | "command",
): DiagnosticsSection {
  const diagnostics = filterBySeverity(outcome.diagnostics ?? [], severity);
  const explicit = (outcome.text ?? "").trim();
  const body =
    explicit ||
    (diagnostics.length > 0
      ? renderDiagnosticLines(diagnostics)
      : (emptySectionText(kind, phase, severity) ?? ""));
  // 说明性备注（如"该文件不在 Lint 配置范围内"）只在手动诊断里给：编辑后阶段每步都投递，
  // 全丢会"假装干净"、全留是噪音，因此按阶段取舍。
  const notes = phase === "manual" ? (outcome.notes ?? []).filter(Boolean) : [];
  const text = [body, ...notes].filter(Boolean).join("\n\n");
  return {
    name,
    ...(target ? { target } : {}),
    ...(text ? { text } : {}),
    diagnostics,
  };
}

// ---- 命令检查：执行 + 输出适配 ----

/** 命令原始产物 */
interface CommandOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  failed: boolean;
  timedOut: boolean;
  overflowed: boolean;
  message?: string;
}

/** 命令来源：`command`（PATH/路径）或 `bin`（项目本地包，按 node <bin> 执行） */
interface CommandSource {
  command: string;
  /** 固定前缀（bin 模式 = 解析出的绝对路径） */
  prefix: string[];
  /** 不可用时的原因（如项目里解析不到该包） */
  error?: string;
  /** `command` 模式下的展示名（失败文案用） */
  label: string;
}

/** 解析命令来源：`bin` 走项目本地包解析（与内置 oxlint/tsc 同一策略） */
function resolveCommandSource(check: CommandCheck, cwd: string): CommandSource {
  if (check.command) {
    return { command: check.command, prefix: [], label: check.command };
  }
  const binName = check.bin as string;
  const bin = resolvePackageBin(path.join(cwd, "package.json"), binName, binName);
  if (!bin) {
    return {
      command: "node",
      prefix: [],
      label: binName,
      error: `项目里解析不到 ${binName}（请先安装该依赖，或改用 command 指定可执行文件）`,
    };
  }
  return { command: "node", prefix: [bin], label: binName };
}

/** 跑一次用户命令（argv 直传、不经 shell；reject:false 让失败走诊断文案而不是异常） */
async function runCommand(
  check: CommandCheck,
  source: CommandSource,
  argv: string[],
  cwd: string,
): Promise<CommandOutcome> {
  const result = await execa(source.command, [...source.prefix, ...argv], {
    cwd,
    timeout: check.timeoutMs ?? COMMAND_CHECK_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    reject: false,
    stdin: "ignore",
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    exitCode: typeof result.exitCode === "number" ? result.exitCode : undefined,
    failed: result.failed,
    timedOut: Boolean(result.timedOut || result.isTerminated),
    overflowed: Boolean(result.isMaxBuffer),
    message: (result as { originalMessage?: string }).originalMessage,
  };
}

/** 命令失败时的明确文案（不静默假装干净） */
function commandFailureText(
  check: CommandCheck,
  source: CommandSource,
  outcome: CommandOutcome,
): string | undefined {
  if (outcome.timedOut) {
    return `[${check.name}] 运行失败：检查超时（${check.timeoutMs ?? COMMAND_CHECK_TIMEOUT_MS}ms），可提高 diagnostics.timeoutMs 或缩小检查范围。`;
  }
  if (outcome.overflowed) return `[${check.name}] 运行失败：输出超过上限，请缩小检查范围。`;
  if (outcome.failed && outcome.exitCode === undefined) {
    return `[${check.name}] 运行失败：无法执行 ${source.label}（${outcome.message ?? "spawn failed"}）。`;
  }
  return undefined;
}

/** 命令的可见原文（stdout 优先，stderr 追加） */
function rawCommandOutput(outcome: CommandOutcome): string {
  return [outcome.stdout, outcome.stderr]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
}

/** 展开 `{file}` / `{files}` 占位符（作为独立 argv 项时按项展开） */
function expandArgs(args: readonly string[], files: readonly string[]): string[] {
  return args.flatMap((arg) => {
    // 独立占位符：{files} 展开成多个 argv 项（{file} 一项）；只有嵌入写法才退化为单个字符串
    if (arg === "{file}") return files[0] ? [files[0]] : [];
    if (arg === "{files}") return [...files];
    return [
      arg.replace(/\{file\}|\{files\}/g, (match) =>
        match === "{file}" ? (files[0] ?? "") : files.join(" "),
      ),
    ];
  });
}

/** 用户适配器模块（default export 一个函数）；加载/执行/返回值异常都转成分区文案 */
async function runAdapterModule(
  check: CommandCheck,
  outcome: CommandOutcome,
  cwd: string,
  files: readonly string[],
): Promise<CheckOutcome> {
  const adapterPath = path.resolve(cwd, check.adapter as string);
  const fail = (reason: string) => ({
    text: `[${check.name}] 适配器不可用：${check.adapter}（${reason}）`,
    diagnostics: [],
  });

  let moduleExports: { default?: unknown };
  try {
    moduleExports = (await import(pathToFileURL(adapterPath).href)) as { default?: unknown };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (typeof moduleExports.default !== "function") {
    return fail("模块必须 default export 一个适配器函数");
  }

  const input: DiagnosticsAdapterInput = {
    name: check.name,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    exitCode: outcome.exitCode,
    files: [...files],
    cwd,
  };
  let output: DiagnosticsAdapterOutput;
  try {
    output = (await (moduleExports.default as DiagnosticsAdapter)(
      input,
    )) as DiagnosticsAdapterOutput;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (!output || typeof output !== "object") return fail("适配器必须返回对象");

  try {
    const diagnostics = normalizeEntries(output.diagnostics, check.name);
    // 有条目时文本由我们统一渲染，保证 severity 门槛与诊断卡片一致
    return { text: diagnostics.length > 0 ? undefined : output.text, diagnostics };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** stylelint --formatter json 的条目 */
interface StylelintJsonWarning {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity?: string;
  text?: string;
  rule?: string;
}

/** 解析 `stylelint --formatter json` 输出（容忍前后夹带的人类可读内容） */
function parseStylelintJson(raw: string, cwd: string): (LintMessage & { filePath: string })[] {
  const parsed = extractJsonValue(raw) as Array<{
    source?: string;
    warnings?: StylelintJsonWarning[];
  }>;
  if (!Array.isArray(parsed)) throw new Error("顶层必须是数组");
  return parsed.flatMap((file) => {
    const filePath = file.source ? path.resolve(cwd, file.source) : "";
    if (!filePath) return [];
    return (file.warnings ?? []).map((warning) => ({
      severity: warning.severity === "error" ? 2 : 1,
      line: warning.line ?? 1,
      column: warning.column ?? 1,
      endLine: warning.endLine,
      endColumn: warning.endColumn,
      message: warning.text ?? "未知诊断",
      ruleId: warning.rule ?? null,
      filePath,
    }));
  });
}

/** 内置适配器：命令输出 → 分区产出（新增一种工具只需在这里加一个 case） */
function adaptBuiltinFormat(
  format: DiagnosticsFormat,
  check: CommandCheck,
  raw: string,
  cwd: string,
  severity: "error" | "warning",
): CheckOutcome {
  const lintFromMessages = (messages: (LintMessage & { filePath: string })[]): CheckOutcome => {
    const output = formatLintMessages(
      messages,
      { label: check.name, source: check.name },
      10,
      severity,
    );
    return { text: output.text, diagnostics: output.diagnostics ?? [] };
  };

  switch (format) {
    case "tsc":
      return {
        text: filterTscOutputBySeverity(raw, severity),
        diagnostics: parseTscDiags(raw, undefined, cwd, check.name),
      };
    case "eslint-json": {
      const { messages, ignored } = parseEslintJson(raw, cwd);
      return {
        ...lintFromMessages(messages),
        notes: ignored.map((file) => `${file} 不在 ESLint 配置范围内，未检查`),
      };
    }
    case "oxlint-json":
      return lintFromMessages(parseOxlintOutput(raw, cwd));
    case "stylelint-json":
      return lintFromMessages(parseStylelintJson(raw, cwd));
    case "aipanel-json": {
      const value = extractJsonValue(raw);
      // 协议既接受 { diagnostics, text }，也接受裸数组
      const payload = (
        Array.isArray(value) ? { diagnostics: value } : value
      ) as DiagnosticsAdapterOutput;
      const diagnostics = normalizeEntries(payload?.diagnostics, check.name);
      return { text: diagnostics.length > 0 ? undefined : payload?.text, diagnostics };
    }
    case "text":
    default:
      return { text: raw, diagnostics: [] };
  }
}

/** 展开内置 linter 预设：目录项 + 用户局部覆盖 → 与自定义检查同形的 CommandCheck */
function expandLinterPreset(check: LinterPresetCheck): CommandCheck {
  const spec: BuiltinLinterSpec = BUILTIN_LINTERS[check.builtin];
  return {
    name: spec.label,
    bin: spec.bin ?? spec.package,
    args: check.args ?? [...spec.args],
    ...((check.projectArgs ?? spec.projectArgs)
      ? { projectArgs: [...(check.projectArgs ?? spec.projectArgs ?? [])] }
      : {}),
    extensions: check.extensions ?? [...spec.extensions],
    format: check.format ?? spec.format,
    ...(check.run ? { run: check.run } : {}),
    ...(check.cwd ? { cwd: check.cwd } : {}),
    ...(check.timeoutMs ? { timeoutMs: check.timeoutMs } : {}),
  };
}

/** 执行一次命令检查（可能展开成多个分区） */
async function runCommandCheck(
  check: CommandCheck,
  target: DiagnosticsTarget,
  phase: DiagnosticsPhase,
  severity: "error" | "warning",
  /** 内置预设：项目没装该包属正常情况（编辑后阶段静默跳过）；用户自定义则视为配置问题，明确报出 */
  optional = false,
): Promise<DiagnosticsSection[]> {
  const cwd = check.cwd ? path.resolve(target.cwd, check.cwd) : target.cwd;
  const args = check.args ?? [];
  const hasPlaceholder = args.some((arg) => arg.includes("{file}") || arg.includes("{files}"));
  const perFile = args.some((arg) => arg.includes("{file}"));
  const split = splitsByFile(target);

  // 先判断"这一轮要不要吃文件"，再解析命令：不适用于这些文件的检查直接跳过，
  // 不会出现"检查压根不跑、却报项目里没装该工具"的误报（也省掉一次 bin 解析）。
  const targeted = target.kind !== "project";
  const files = targeted
    ? targetFiles(target).filter((file) => matchesExtensions(file, check.extensions))
    : [];
  if (targeted && hasPlaceholder && files.length === 0) {
    log.debug("skip command check: no matching file target", { name: check.name, phase });
    return [];
  }

  const source = resolveCommandSource(check, cwd);
  if (source.error) {
    if (optional && phase === "edit") {
      log.debug("skip uninstalled builtin linter", { name: check.name });
      return [];
    }
    const text = optional
      ? `[${check.name}] 未运行：${source.error}`
      : `[${check.name}] ${source.error}`;
    return [buildSection(check.name, undefined, { text }, phase, severity, "command")];
  }

  const execute = async (
    argvTemplate: readonly string[],
    fileSet: string[],
  ): Promise<CheckOutcome> => {
    const outcome = await runCommand(check, source, expandArgs(argvTemplate, fileSet), cwd);
    const failure = commandFailureText(check, source, outcome);
    if (failure) return { text: failure, diagnostics: [] };
    const raw = rawCommandOutput(outcome);
    // 适配器解析/校验失败也转成分区文案，不让异常冲出 runDiagnostics（手动诊断要能回答"为什么没有结果"）
    try {
      if (check.adapter) return await runAdapterModule(check, outcome, cwd, fileSet);
      return adaptBuiltinFormat(check.format ?? "text", check, raw, cwd, severity);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const excerpt = raw.replace(/\s+/g, " ").trim().slice(0, 200);
      return {
        text: `[${check.name}] 运行失败：输出解析失败（${reason}）${excerpt ? `：${excerpt}` : ""}`,
        diagnostics: [],
      };
    }
  };

  const targetLabel = (file: string): string | undefined =>
    split ? displayPath(target.cwd, file) : undefined;

  // 不含文件占位符：三种目标都跑同一个 argv（项目级命令）
  if (!hasPlaceholder) {
    return [
      buildSection(check.name, undefined, await execute(args, []), phase, severity, "command"),
    ];
  }

  // 目标为全量：用 projectArgs（未声明则跳过——不把空占位符塞进 argv）
  if (target.kind === "project") {
    if (!check.projectArgs) {
      log.debug("skip command check: no project args", { name: check.name });
      return [];
    }
    return [
      buildSection(
        check.name,
        undefined,
        await execute(check.projectArgs, []),
        phase,
        severity,
        "command",
      ),
    ];
  }

  // 目标为文件（files 已按扩展名筛过）
  if (perFile) {
    const sections: DiagnosticsSection[] = [];
    for (const file of files) {
      const produced = await execute(args, [file]);
      sections.push(
        buildSection(check.name, targetLabel(file), produced, phase, severity, "command"),
      );
    }
    return sections;
  }

  const produced = await execute(args, files);
  const label = files.length === 1 ? targetLabel(files[0]) : undefined;
  return [buildSection(check.name, label, produced, phase, severity, "command")];
}

// ---- 内置检查：复用既有引擎探测 ----

/** 全量类型检查：根有 tsconfig 就跑根，否则逐子目录跑并合并（历史行为） */
async function runProjectTypeCheck(
  workspace: string,
  severity: "error" | "warning",
): Promise<TscResult> {
  const dirs = fs.existsSync(path.join(workspace, "tsconfig.json"))
    ? [workspace]
    : findAllTsconfigDirs(workspace);
  log.debug("Tsc dirs to check", { count: dirs.length, dirs });
  const results = await Promise.all(dirs.map((dir) => runTypeCheck(undefined, dir)));
  return applyTscSeverity(
    {
      rawOutput: results
        .flatMap((output) => output.rawOutput)
        .filter(Boolean)
        .join("\n"),
      exitCode: results.reduce((max, output) => Math.max(max, output.exitCode), 0),
      diagnostics: results.flatMap((output) => output.diagnostics ?? []),
      source: results.find((output) => output.source)?.source,
    },
    severity,
  );
}

/** 执行类型检查检查（唯一的内置引擎检查：tsconfig 归并 + 项目本地/自带引擎探测） */
async function runTypecheckCheck(
  check: TypecheckCheck,
  target: DiagnosticsTarget,
  phase: DiagnosticsPhase,
  severity: "error" | "warning",
): Promise<DiagnosticsSection[]> {
  const cwd = target.cwd;
  const split = splitsByFile(target);
  // 目标为全量时整项目跑（不看扩展名）；按文件诊断时先按扩展名筛（缺省 = 可诊断源码扩展名）
  const files =
    target.kind === "project"
      ? []
      : targetFiles(target).filter((file) =>
          matchesExtensions(file, check.extensions ?? SOURCE_EXTENSIONS),
        );
  if (target.kind !== "project" && files.length === 0) {
    log.debug("skip builtin check: no matching file target", { builtin: check.builtin, phase });
    return [];
  }

  if (split) {
    const results = await runTypeChecksForFiles(files, cwd);
    return files.map((file) => {
      const result = applyTscSeverity(
        results.get(path.resolve(file)) ?? { rawOutput: "", exitCode: 0 },
        severity,
      );
      return buildSection(
        tscSectionTitle(result),
        displayPath(cwd, file),
        { text: result.rawOutput.trim(), diagnostics: result.diagnostics },
        phase,
        severity,
        "typecheck",
      );
    });
  }

  const result =
    target.kind === "file"
      ? applyTscSeverity(await runTypeCheck(files[0], cwd), severity)
      : await runProjectTypeCheck(cwd, severity);
  return [
    buildSection(
      tscSectionTitle(result),
      undefined,
      { text: result.rawOutput.trim(), diagnostics: result.diagnostics },
      phase,
      severity,
      "typecheck",
    ),
  ];
}

/**
 * 诊断深入口：按策略与阶段执行配置的检查，返回有序分区。
 *
 * 三类检查：`typecheck`（引擎级内置）、内置 linter 预设（展开成 CommandCheck）、
 * 用户自定义检查——后两类走**完全同一条**执行与适配逻辑。
 * 检查按声明顺序串行执行，输出顺序确定、进程数可控；
 * `severity` 门槛在分区归一化处生效，文本与结构化条目一起收紧。
 */
export async function runDiagnostics(
  target: DiagnosticsTarget,
  policy: DiagnosticsPolicy,
  phase: DiagnosticsPhase,
): Promise<DiagnosticsResult> {
  // 阶段（run）与目标形态（targets）两个维度独立过滤：后者让"只在全量诊断时跑"成为一等配置
  const checks = policy.checks.filter(
    (check) => checkRunsInPhase(check, phase) && checkRunsOnTarget(check, target.kind),
  );
  log.debug("runDiagnostics", { phase, target: target.kind, checks: checks.length });

  // 各检查彼此独立：并发执行，Promise.all 保序 → 输出仍按声明顺序，墙钟时间取最慢的那个
  // （一次编辑后收尾通常是 eslint + oxlint + stylelint + tsc 四个进程，串行会白等前三个）。
  const results = await Promise.all(
    checks.map((check) => {
      if (isTypecheckCheck(check)) {
        return runTypecheckCheck(check, target, phase, policy.severity);
      }
      if (isLinterPreset(check)) {
        // 内置预设 → 与用户自定义检查同形的 CommandCheck（项目没装则视为未安装，编辑后阶段跳过）
        return runCommandCheck(expandLinterPreset(check), target, phase, policy.severity, true);
      }
      if (isCommandCheck(check)) {
        return runCommandCheck(check, target, phase, policy.severity);
      }
      return Promise.resolve<DiagnosticsSection[]>([]);
    }),
  );
  // 空分区（无正文、无条目）不携带任何信息：编辑后阶段它们本就该静默，手动阶段各有占位文案
  const sections = results
    .flat()
    .filter((section) => section.text !== undefined || section.diagnostics.length > 0);

  // 手动诊断要正面回答"有没有跑"：目标文件没有任何检查匹配时给一条明确说明，而不是空结果
  if (sections.length === 0 && phase === "manual") {
    return {
      sections: [
        {
          name: "检查",
          text: "没有可运行的检查：已配置的检查都不匹配本轮目标（检查的 extensions / run 阶段 / 目标类型）。",
          diagnostics: [],
        },
      ],
    };
  }
  return { sections };
}

/** 汇总结构化条目（canonical 输出 / 诊断卡片用） */
export function collectDiagnostics(result: DiagnosticsResult): DiagnosticItem[] {
  return result.sections.flatMap((section) => section.diagnostics);
}

/**
 * 把分区结果渲染成模型可见文本。
 * `onlyFindings: true` 只输出有发现的分区、全空返回空串（编辑后自动诊断不刷占位噪音）；
 * `maxFindingsPerSection` 把每个分区的发现折叠成有界摘要——编辑后自动诊断每个 step 都会投递，
 * 因此用条数上限控制重复成本，完整结果仍由不带上限的 run_diagnostics 给出。
 * 编辑后自动诊断（分区带 target）保留 `### 文件` 结构。
 */
export function renderDiagnostics(
  result: DiagnosticsResult,
  options: RenderDiagnosticsOptions = {},
): string {
  const sections = options.onlyFindings
    ? result.sections.filter((section) => (section.text ?? "").trim())
    : result.sections;
  if (sections.length === 0) return "";

  const groups = new Map<string, DiagnosticsSection[]>();
  for (const section of sections) {
    const key = section.target ?? "";
    const group = groups.get(key);
    if (group) group.push(section);
    else groups.set(key, [section]);
  }

  const blocks: string[] = [];
  for (const [key, group] of groups) {
    const body = group
      .map((section) => {
        const text = boundFindings(section.text, options.maxFindingsPerSection);
        return `## ${section.name}\n\n${text || "没有发现问题"}`;
      })
      .join("\n\n");
    blocks.push(key ? `### ${key}\n\n${body}` : body);
  }
  return blocks.join("\n\n");
}
