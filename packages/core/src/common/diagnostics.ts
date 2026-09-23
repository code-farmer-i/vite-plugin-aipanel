/**
 * 诊断的用户配置契约（provider 无关）。
 *
 * 用户配置面只有一处：vite 插件的 `providerOptions.diagnostics`。核心层在这里定义策略形状、
 * 检查来源（内置引擎 / 项目命令）、输出适配器协议与默认值；两个 provider（deepseek / opencode）
 * 与两侧宿主插件共用同一份语义，因此"用户配置了什么"在每个宿主上含义一致。
 *
 * 不在这里定义的东西：排除规则（ignore）—— 那是底层工具的事（ESLint 自身 ignore、tsconfig
 * `exclude`、命令自己的 glob），我们不复制一套 glob 语义。
 */
import type { AIPanelDiagnosticEntry } from "./types";

/** 诊断阶段：编辑后自动诊断 / agent 手动调用工具 */
export type DiagnosticsPhase = "edit" | "manual";

/** 检查在哪些阶段执行（缺省 both） */
export type DiagnosticsRun = DiagnosticsPhase | "both";

/**
 * 诊断目标形态（与 `run` 正交：`run` 管阶段，这里管"跑什么样的目标"）：
 * - `edited`：编辑后自动诊断（本步编辑过的文件）
 * - `file`：`run_diagnostics({ filePath })` 单文件
 * - `project`：`run_diagnostics()` 全量
 */
export type DiagnosticsTargetKind = "edited" | "file" | "project";

/**
 * 类型检查检查：唯一的"引擎级"内置（要 tsconfig 感知的批量归并、项目本地 tsc/vue-tsc 探测
 * 与自带 vue-tsc 兜底，不是一条命令能表达的）。其余一切检查都走同一条命令执行路径。
 */
export interface TypecheckCheck {
  builtin: "typecheck";
  run?: DiagnosticsRun;
  /** 只在这些目标形态下跑（如 ["project"] = 仅全量诊断）；缺省 = 不限 */
  targets?: DiagnosticsTargetKind[];
  /** 只吃这些扩展名（如 [".ts", ".vue"]）；缺省 = 可诊断源码扩展名（与历史行为一致） */
  extensions?: string[];
}

/** 命令输出的内置适配器名（内置适配器由我们开发维护） */
export type DiagnosticsFormat =
  "text" | "tsc" | "eslint-json" | "oxlint-json" | "stylelint-json" | "aipanel-json";

/**
 * 命令检查：跑用户项目里的一条命令（或项目本地某个包的 bin），输出经适配器归一成分区。
 *
 * 命令按 argv 直传、不经 shell（见 ADR-0002）；需要 shell 语义时由用户显式选择解释器。
 * `command` 与 `bin` 二选一：`bin` 走"项目本地包解析"（与内置预设同一策略），
 * 因此 stylelint / biome / 自研工具包都是同一条路，不需要为每个工具内置特判。
 */
export interface CommandCheck {
  /** 分区标题（模型与诊断卡片都看到它） */
  name: string;
  /** argv[0]：命令名（PATH 解析）或路径；与 `bin` 二选一 */
  command?: string;
  /** 项目本地包的 bin 名（同时也是包名）：解析不到时给明确文案；与 `command` 二选一 */
  bin?: string;
  /** argv[1..]；可含 `{file}`（逐文件）与 `{files}`（一次传全部）占位符 */
  args?: string[];
  /**
   * 无目标文件（全量诊断）时的 argv。
   * 含占位符的检查没写它 → 全量诊断跳过该检查；不带占位符的检查三种目标都跑同一个 argv。
   */
  projectArgs?: string[];
  /** 只吃这些扩展名（如 [".css", ".scss"]）；缺省 = 不限 */
  extensions?: string[];
  /** 只在这些目标形态下跑（如 ["project"] = 仅全量诊断）——想知道"这次是不是全量"就用它；缺省 = 不限 */
  targets?: DiagnosticsTargetKind[];
  /** 相对项目根，默认项目根 */
  cwd?: string;
  run?: DiagnosticsRun;
  /** 内置适配器名；与 `adapter` 同时给出时 `adapter` 优先 */
  format?: DiagnosticsFormat;
  /** 用户适配器模块路径（相对项目根）；default export 一个 {@link DiagnosticsAdapter} */
  adapter?: string;
  /** 命令超时（ms），默认 {@link COMMAND_CHECK_TIMEOUT_MS} */
  timeoutMs?: number;
}

/**
 * 内置 linter 预设：只写 `builtin: "eslint"` 就能用——包名 / bin / 默认 argv / 输出格式 /
 * 扩展名都取 {@link BUILTIN_LINTERS} 的目录项，展开后与用户自定义的 {@link CommandCheck}
 * **完全同形**，走同一条执行与适配逻辑。可局部覆盖（args / extensions / format / run …）。
 */
export type LinterPresetCheck = {
  builtin: BuiltinLinterId;
  args?: string[];
  projectArgs?: string[];
  extensions?: string[];
  targets?: DiagnosticsTargetKind[];
  format?: DiagnosticsFormat;
  cwd?: string;
  run?: DiagnosticsRun;
  timeoutMs?: number;
};

export type DiagnosticsCheck = TypecheckCheck | LinterPresetCheck | CommandCheck;

/** 诊断策略：用户可自定义的全部行为 */
export interface DiagnosticsPolicy {
  /** 检查来源；缺省（或归一化后为空）= 内置 lint + typecheck */
  checks: DiagnosticsCheck[];
  /** 编辑后自动诊断（tools/post-execute 登记 → agent/pre-step 收尾注入） */
  auto: boolean;
  /** 是否把 run_diagnostics 暴露给模型 */
  exposeTool: boolean;
  /** 投递门槛：`error` 只报错误，`warning` 错误与警告都报 */
  severity: "error" | "warning";
  /** 自动诊断每个分区最多列出的发现条数 */
  maxFindingsPerSection: number;
  /** 自动诊断注入消息的字符上限 */
  maxMessageChars: number;
}

/** 用户适配器入参：命令的原始产物 + 本次目标 */
export interface DiagnosticsAdapterInput {
  /** 分区名（check.name） */
  name: string;
  stdout: string;
  stderr: string;
  /** 超时 / 被信号杀死时为 undefined */
  exitCode: number | undefined;
  /** 本次目标文件（绝对路径）；项目级检查为空数组 */
  files: string[];
  /** 项目根 */
  cwd: string;
}

/**
 * 用户适配器出参。
 * 提供 `diagnostics` 时文本由 AIPanel 统一渲染（保证 severity 门槛与诊断卡片一致）；
 * 只有需要自定义叙述时才只给 `text`（此时无结构化条目、也不参与 severity 过滤）。
 */
export interface DiagnosticsAdapterOutput {
  text?: string;
  diagnostics?: AIPanelDiagnosticEntry[];
}

export type DiagnosticsAdapter = (
  input: DiagnosticsAdapterInput,
) => DiagnosticsAdapterOutput | Promise<DiagnosticsAdapterOutput>;

/** 命令检查默认超时 */
export const COMMAND_CHECK_TIMEOUT_MS = 60_000;

/**
 * 可诊断源码扩展名（内置 lint / typecheck 的默认匹配集）。
 * node 侧的 `JS_EXTENSIONS` 引它，保持单一来源。
 */
export const SOURCE_EXTENSIONS: readonly string[] = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
];

/**
 * 目标文件是否命中检查声明的扩展名。
 * 未声明（undefined / 空）表示不限；实现保持 client-safe（不引 node:path）。
 */
export function matchesExtensions(
  filePath: string,
  extensions: readonly string[] | undefined,
): boolean {
  if (!extensions?.length) return true;
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return extensions.includes(base.slice(dot).toLowerCase());
}

/** 内置 linter 目录项：一个预设 = 一条命令检查的全部默认值（纯数据） */
export interface BuiltinLinterSpec {
  /** 分区标题 */
  label: string;
  /** 项目本地包名（bin 从项目 package.json 解析，解析不到即视为未安装） */
  package: string;
  /** bin 名；缺省与包名相同 */
  bin?: string;
  /** 默认 argv（可含 `{file}` / `{files}` 占位符） */
  args: string[];
  /** 全量诊断时的 argv（含占位符的预设必须给，否则全量时跳过） */
  projectArgs?: string[];
  /** 默认匹配的扩展名 */
  extensions: string[];
  /** 默认输出适配器（内置工具一律能出结构化诊断，因此卡片/severity 都生效） */
  format: DiagnosticsFormat;
}

/**
 * 内置 linter 目录（数据表）。加一个常见 lint = 加一行；预设展开后与用户自定义检查同形，
 * 走同一条执行 + 适配逻辑，所以"内置"与"自定义"没有第二套底层实现。
 */
export const BUILTIN_LINTERS = {
  eslint: {
    label: "ESLint",
    package: "eslint",
    args: ["--format", "json", "{files}"],
    projectArgs: ["--format", "json", "."],
    extensions: [...SOURCE_EXTENSIONS],
    format: "eslint-json",
  },
  oxlint: {
    label: "oxlint",
    package: "oxlint",
    args: ["--format=json", "--ignore-pattern", "node_modules", "{files}"],
    projectArgs: ["--format=json", "--ignore-pattern", "node_modules", "."],
    extensions: [...SOURCE_EXTENSIONS],
    format: "oxlint-json",
  },
  stylelint: {
    label: "Stylelint",
    package: "stylelint",
    args: ["--formatter", "json", "{files}"],
    projectArgs: ["--formatter", "json", "**/*.{css,scss,less}"],
    extensions: [".css", ".scss", ".less"],
    format: "stylelint-json",
  },
} as const satisfies Record<string, BuiltinLinterSpec>;

/** 内置 linter 预设 id */
export type BuiltinLinterId = keyof typeof BUILTIN_LINTERS;

/** 自动诊断默认分区条数上限（与历史行为一致） */
export const DEFAULT_MAX_FINDINGS_PER_SECTION = 3;

/** 自动诊断默认注入字符上限（与历史行为一致） */
export const DEFAULT_MAX_MESSAGE_CHARS = 4000;

/**
 * 缺省检查来源（= 未配置 diagnostics 时的行为）：
 * 项目装了哪个内置 linter 就跑哪个（没装的自动跳过），类型检查始终在。
 */
export const DEFAULT_BUILTIN_CHECKS: readonly DiagnosticsCheck[] = Object.freeze([
  Object.freeze({ builtin: "eslint" as const }),
  Object.freeze({ builtin: "oxlint" as const }),
  Object.freeze({ builtin: "typecheck" as const }),
]);

/** 策略默认值（单一来源：provider 的默认值、插件的兜底都引它） */
export const DEFAULT_DIAGNOSTICS_POLICY: DiagnosticsPolicy = Object.freeze({
  checks: DEFAULT_BUILTIN_CHECKS.map((check) => ({ ...check })),
  auto: true,
  exposeTool: true,
  severity: "warning",
  maxFindingsPerSection: DEFAULT_MAX_FINDINGS_PER_SECTION,
  maxMessageChars: DEFAULT_MAX_MESSAGE_CHARS,
});

/** 是否为命令检查（用户自定义：既无内置 linter 预设也无内置引擎） */
export function isCommandCheck(check: DiagnosticsCheck): check is CommandCheck {
  return !("builtin" in check);
}

/** 是否为内置 linter 预设 */
export function isLinterPreset(check: DiagnosticsCheck): check is LinterPresetCheck {
  return "builtin" in check && check.builtin !== "typecheck";
}

/** 是否为内置类型检查（引擎级） */
export function isTypecheckCheck(check: DiagnosticsCheck): check is TypecheckCheck {
  return "builtin" in check && check.builtin === "typecheck";
}

/** 该检查是否在指定阶段执行 */
export function checkRunsInPhase(check: DiagnosticsCheck, phase: DiagnosticsPhase): boolean {
  const run = check.run ?? "both";
  return run === "both" || run === phase;
}

/** 该检查是否在指定目标形态下执行（未声明 targets = 不限） */
export function checkRunsOnTarget(check: DiagnosticsCheck, kind: DiagnosticsTargetKind): boolean {
  return check.targets === undefined || check.targets.includes(kind);
}

const FORMATS: readonly DiagnosticsFormat[] = [
  "text",
  "tsc",
  "eslint-json",
  "oxlint-json",
  "stylelint-json",
  "aipanel-json",
];
const RUNS: readonly DiagnosticsRun[] = ["edit", "manual", "both"];
const TARGET_KINDS: readonly DiagnosticsTargetKind[] = ["edited", "file", "project"];

/** 归一化单个检查；非法项返回 undefined（由调用方告警并丢弃） */
/** 归一化扩展名列表：去空白、补前导点、小写；空列表视为未声明 */
function normalizeExtensions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const extensions = raw
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => {
      const trimmed = item.trim().toLowerCase();
      return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
    });
  return extensions.length > 0 ? [...new Set(extensions)] : undefined;
}

/** 归一化目标形态列表（只保留合法值并去重；空列表视为未声明） */
function normalizeTargets(raw: unknown): DiagnosticsTargetKind[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const targets = raw.filter((item): item is DiagnosticsTargetKind =>
    TARGET_KINDS.includes(item as DiagnosticsTargetKind),
  );
  return targets.length > 0 ? [...new Set(targets)] : undefined;
}

/** 归一化 argv 列表（只保留字符串项） */
function normalizeArgs(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const args = raw.filter((item): item is string => typeof item === "string");
  return args.length > 0 ? args : undefined;
}

function normalizeCheck(raw: unknown): DiagnosticsCheck | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const run = RUNS.includes(value.run as DiagnosticsRun)
    ? (value.run as DiagnosticsRun)
    : undefined;
  const extensions = normalizeExtensions(value.extensions);
  const targets = normalizeTargets(value.targets);
  const cwd = typeof value.cwd === "string" && value.cwd ? { cwd: value.cwd } : {};
  const timeout =
    typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) && value.timeoutMs > 0
      ? { timeoutMs: Math.floor(value.timeoutMs) }
      : {};
  const format = FORMATS.includes(value.format as DiagnosticsFormat)
    ? { format: value.format as DiagnosticsFormat }
    : {};

  if (value.builtin !== undefined) {
    // 引擎级内置：类型检查
    if (value.builtin === "typecheck") {
      return {
        builtin: "typecheck",
        ...(run ? { run } : {}),
        ...(targets ? { targets } : {}),
        ...(extensions ? { extensions } : {}),
      };
    }
    // 内置 linter 预设（目录表里没有的 id 视为非法）
    if (typeof value.builtin === "string" && value.builtin in BUILTIN_LINTERS) {
      const presetArgs = normalizeArgs(value.args);
      const presetProjectArgs = normalizeArgs(value.projectArgs);
      return {
        builtin: value.builtin as BuiltinLinterId,
        ...(presetArgs ? { args: presetArgs } : {}),
        ...(presetProjectArgs ? { projectArgs: presetProjectArgs } : {}),
        ...(extensions ? { extensions } : {}),
        ...(targets ? { targets } : {}),
        ...(run ? { run } : {}),
        ...format,
        ...cwd,
        ...timeout,
      };
    }
    return undefined;
  }

  if (typeof value.name !== "string" || !value.name) return undefined;
  const command = typeof value.command === "string" && value.command ? value.command : undefined;
  const bin = typeof value.bin === "string" && value.bin ? value.bin : undefined;
  if (!command && !bin) return undefined;

  const args = normalizeArgs(value.args);
  const projectArgs = normalizeArgs(value.projectArgs);
  return {
    name: value.name,
    ...(command ? { command } : {}),
    ...(bin ? { bin } : {}),
    ...(args ? { args } : {}),
    ...(projectArgs ? { projectArgs } : {}),
    ...(extensions ? { extensions } : {}),
    ...(targets ? { targets } : {}),
    ...cwd,
    ...(run ? { run } : {}),
    ...format,
    ...(typeof value.adapter === "string" && value.adapter ? { adapter: value.adapter } : {}),
    ...timeout,
  };
}

function normalizeChecks(
  raw: unknown,
  onInvalid: (message: string) => void,
): DiagnosticsCheck[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    onInvalid("diagnostics.checks 必须是数组，已回退为内置检查");
    return undefined;
  }
  const checks: DiagnosticsCheck[] = [];
  for (const item of raw) {
    const check = normalizeCheck(item);
    if (check) checks.push(check);
    else onInvalid(`diagnostics.checks 含非法检查项，已跳过：${JSON.stringify(item)}`);
  }
  if (checks.length === 0) {
    onInvalid("diagnostics.checks 归一化后为空，已回退为内置检查");
    return undefined;
  }
  return checks;
}

function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/** 是否为合法的正整数字段值 */
function isValidPositiveInt(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1;
}

function normalizePositiveInt(raw: unknown, fallback: number): number {
  return isValidPositiveInt(raw) ? Math.floor(raw) : fallback;
}

/**
 * 逐层覆盖 + 逐字段归一化：后面的层覆盖前面的层，非法值回退默认并通过 `onInvalid` 告警。
 * 调用方（provider）负责把告警写进日志，核心层保持无副作用、可单测。
 */
export function resolveDiagnosticsPolicy(
  layers: readonly (Partial<DiagnosticsPolicy> | undefined)[],
  onInvalid: (message: string) => void = () => {},
): DiagnosticsPolicy {
  let policy: DiagnosticsPolicy = {
    ...DEFAULT_DIAGNOSTICS_POLICY,
    checks: DEFAULT_BUILTIN_CHECKS.map((check) => ({ ...check })),
  };

  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    const checks = normalizeChecks(layer.checks, onInvalid);
    if (
      layer.severity !== undefined &&
      layer.severity !== "error" &&
      layer.severity !== "warning"
    ) {
      onInvalid(`diagnostics.severity 取值非法（${String(layer.severity)}），已回退上一层`);
    }
    if (
      layer.maxFindingsPerSection !== undefined &&
      !isValidPositiveInt(layer.maxFindingsPerSection)
    ) {
      onInvalid("diagnostics.maxFindingsPerSection 必须是 ≥ 1 的整数，已回退上一层");
    }
    if (layer.maxMessageChars !== undefined && !isValidPositiveInt(layer.maxMessageChars)) {
      onInvalid("diagnostics.maxMessageChars 必须是 ≥ 1 的整数，已回退上一层");
    }
    for (const key of ["auto", "exposeTool"] as const) {
      if (layer[key] !== undefined && typeof layer[key] !== "boolean") {
        onInvalid(`diagnostics.${key} 必须是布尔值，已回退上一层`);
      }
    }
    policy = {
      checks: checks ? checks.map((check) => ({ ...check })) : policy.checks,
      auto: normalizeBoolean(layer.auto, policy.auto),
      exposeTool: normalizeBoolean(layer.exposeTool, policy.exposeTool),
      severity:
        layer.severity === "error" || layer.severity === "warning"
          ? layer.severity
          : policy.severity,
      maxFindingsPerSection: normalizePositiveInt(
        layer.maxFindingsPerSection,
        policy.maxFindingsPerSection,
      ),
      maxMessageChars: normalizePositiveInt(layer.maxMessageChars, policy.maxMessageChars),
    };
  }

  return policy;
}
