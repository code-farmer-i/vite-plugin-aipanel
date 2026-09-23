/**
 * @fileoverview 诊断引擎单测（packages/core/src/common/diagnostics.ts + src/node/diagnostics.ts，node 环境）
 *
 * 覆盖策略：
 * - 策略归一化（resolveDiagnosticsPolicy）、渲染与汇总为纯函数，直接断言；
 * - 深入口 runDiagnostics 的外部进程（execa）整体 mock；项目本地 bin 解析由临时目录里真实的
 *   node_modules/<pkg>/package.json 夹具驱动（node:module 的 createRequire 由 mock 转发到同一套解析）；
 * - 依赖模块级缓存的解析（内置检查器 / bin / tsconfig 归并）每用例 vi.resetModules + 动态 import
 *   取全新模块实例，避免用例间缓存串味。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEVERITY_ERROR, SEVERITY_WARN } from "../src/common/constants";
import { configureLogger, LogLevel } from "../src/common/logger-core";
import {
  BUILTIN_LINTERS,
  DEFAULT_BUILTIN_CHECKS,
  DEFAULT_MAX_FINDINGS_PER_SECTION,
  DEFAULT_MAX_MESSAGE_CHARS,
  isCommandCheck,
  isLinterPreset,
  isTypecheckCheck,
  matchesExtensions,
  resolveDiagnosticsPolicy,
  SOURCE_EXTENSIONS,
  type CommandCheck,
  type DiagnosticsPhase,
  type DiagnosticsPolicy,
  type LinterPresetCheck,
} from "../src/common/diagnostics";
import {
  collectDiagnostics,
  DIAGNOSTICS_TOOL_DESCRIPTION,
  isJsFile,
  omittedFindingsHint,
  renderDiagnostics,
  tscSectionTitle,
  type DiagnosticsResult,
  type DiagnosticsTarget,
} from "../src/node/diagnostics";

type DiagnosticModule = typeof import("../src/node/diagnostics");

interface FakeExecaResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  failed?: boolean;
  timedOut?: boolean;
  isTerminated?: boolean;
  isMaxBuffer?: boolean;
  originalMessage?: string;
}

type ExecaImpl = (file: string, args: string[], opts: { cwd?: string }) => FakeExecaResult;

// --- node:module / execa mock（hoisted） ---
vi.mock("node:module", () => ({ createRequire: vi.fn() }));
vi.mock("execa", () => ({ execa: vi.fn() }));

const mockedCreateRequire = vi.mocked(createRequire);
const mockedExeca = vi.mocked(execa);

// --- 每用例可调状态 ---
let execaImpl: ExecaImpl;
/** 本包自带的 vue-tsc 是否可解析（项目没装检查器时的兜底） */
let bundledVueTscResolvable: boolean;

/** 在 <root>/node_modules/<name>/package.json 写一个假包（bin / version 由用例决定） */
function writePackage(
  root: string,
  name: string,
  pkg: { version?: string; bin?: string | Record<string, string> },
): string {
  const pkgDir = path.join(root, "node_modules", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  const pkgJsonPath = path.join(pkgDir, "package.json");
  fs.writeFileSync(pkgJsonPath, JSON.stringify({ name, version: "1.0.0", ...pkg }));
  return pkgJsonPath;
}

/**
 * 模拟 Node 的包解析：从 createRequire 起点向上找 node_modules/<pkg>/package.json。
 * 项目自身安装的检查器读的就是临时项目里真实的 package.json（bin / version 可控）；
 * 起点是 file://（本模块自身）时走的正是仓库里真实安装的 vue-tsc / typescript。
 */
function resolvePackageJson(base: string | URL, pkgName: string): string {
  const from = typeof base === "string" ? base : base.href;
  if (from.startsWith("file://")) {
    if (pkgName === "vue-tsc" && !bundledVueTscResolvable) {
      throw new Error("Cannot find module 'vue-tsc/package.json'");
    }
    return walkUp(fileURLToPath(from), pkgName);
  }
  return walkUp(from, pkgName);
}

/** 从起点目录向上找 node_modules/<pkg>/package.json（与 Node 解析同序） */
function walkUp(from: string, pkgName: string): string {
  let dir = path.dirname(from);
  while (true) {
    const candidate = path.join(dir, "node_modules", pkgName, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot find module '${pkgName}/package.json'`);
}

function makeFakeRequire(base: string | URL): NodeRequire {
  const req = ((id: string) => {
    throw new Error(`Cannot find module '${id}'`);
  }) as unknown as NodeRequire;

  req.resolve = ((id: string) => {
    const pkgName = /^(.+)\/package\.json$/.exec(id)?.[1];
    if (!pkgName) throw new Error("Cannot resolve '" + id + "'");
    return resolvePackageJson(base, pkgName);
  }) as NodeRequire["resolve"];
  return req;
}

function silenceConsole(): void {
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
}

/** 临时目录夹具：用例结束统一清理 */
const tmpDirs: string[] = [];

/** 临时项目目录：写真实 package.json，并按 packages 造 node_modules/<name>/package.json */
function makeProject(
  packages: Record<string, { version?: string; bin?: string | Record<string, string> }> = {},
  pkg: Record<string, unknown> = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-diag-"));
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "probe", version: "1.0.0", ...pkg }),
  );
  for (const [name, spec] of Object.entries(packages)) writePackage(dir, name, spec);
  return dir;
}

/** 带 tsconfig.json 的临时项目（类型检查相关用例） */
function makeTsProject(
  deps: Record<string, string> = {},
  packages: Record<string, { version?: string; bin?: string | Record<string, string> }> = {},
): string {
  const dir = makeProject(packages, { dependencies: deps });
  fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
  return dir;
}

beforeEach(() => {
  configureLogger({ level: LogLevel.NONE });
  silenceConsole();
  bundledVueTscResolvable = true;
  execaImpl = () => ({ stdout: "", stderr: "", exitCode: 0 });
  mockedCreateRequire.mockImplementation((base) => makeFakeRequire(base));
  (mockedExeca as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (file: unknown, args: unknown, opts: unknown) => ({
      stdout: "",
      stderr: "",
      ...execaImpl(file as string, args as string[], opts as { cwd?: string }),
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function freshModule(): Promise<DiagnosticModule> {
  vi.resetModules();
  const mod = await import("../src/node/diagnostics");
  // resetModules 会重建 logger-core 实例（配置回到默认），重新静音 + 关闭日志
  silenceConsole();
  return mod;
}

/** 记录 execa 调用并按需返回固定产物 */
function trackExeca(result: FakeExecaResult | (() => FakeExecaResult) = {}) {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  execaImpl = (command, args, opts) => {
    calls.push({ command, args, cwd: opts.cwd });
    return typeof result === "function" ? result() : result;
  };
  return calls;
}

/** 单层策略（checks 之外的字段走缺省） */
function resolvePolicy(layer: Partial<DiagnosticsPolicy> = {}): DiagnosticsPolicy {
  return resolveDiagnosticsPolicy([layer]);
}

/** 用一条检查跑一次诊断（每个用例都取全新模块实例，避免解析缓存串味） */
async function runOneCheck(
  check: CommandCheck | LinterPresetCheck | { builtin: "typecheck" },
  target: DiagnosticsTarget,
  phase: DiagnosticsPhase = "manual",
  overrides: Partial<DiagnosticsPolicy> = {},
): Promise<DiagnosticsResult> {
  const mod = await freshModule();
  return mod.runDiagnostics(target, resolvePolicy({ checks: [check], ...overrides }), phase);
}

describe("isJsFile", () => {
  it("accepts all documented source extensions", () => {
    for (const ext of ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "vue"]) {
      expect(isJsFile("src/foo." + ext)).toBe(true);
    }
  });

  it("rejects non-source files", () => {
    expect(isJsFile("a.css")).toBe(false);
    expect(isJsFile("a.json")).toBe(false);
    expect(isJsFile("a.md")).toBe(false);
    expect(isJsFile("README")).toBe(false);
    expect(isJsFile("a.TS")).toBe(false); // 大小写敏感
  });
});

describe("DIAGNOSTICS_TOOL_DESCRIPTION", () => {
  it("documents the configurable checks and every supported extension", () => {
    expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain("运行项目配置的代码检查");
    expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain("TypeScript 类型检查：*.ts *.tsx *.vue");
    // 扩展名清单与 SOURCE_EXTENSIONS 单一来源
    for (const ext of SOURCE_EXTENSIONS) {
      expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain(`*${ext}`);
    }
  });
});

describe("resolveDiagnosticsPolicy", () => {
  it("缺省 checks 回填为内置 lint + typecheck，其余字段取默认值", () => {
    const policy = resolveDiagnosticsPolicy([]);
    expect(policy.checks).toEqual([
      { builtin: "eslint" },
      { builtin: "oxlint" },
      { builtin: "typecheck" },
    ]);
    expect(policy.checks).toEqual([...DEFAULT_BUILTIN_CHECKS]);
    expect(policy.auto).toBe(true);
    expect(policy.exposeTool).toBe(true);
    expect(policy.severity).toBe("warning");
    expect(policy.maxFindingsPerSection).toBe(DEFAULT_MAX_FINDINGS_PER_SECTION);
    expect(policy.maxMessageChars).toBe(DEFAULT_MAX_MESSAGE_CHARS);
  });

  it("后面的层覆盖前面的层，未声明的字段沿用上一层", () => {
    const policy = resolveDiagnosticsPolicy([
      { checks: [{ builtin: "eslint" }], severity: "error", maxFindingsPerSection: 5, auto: false },
      { checks: [{ builtin: "oxlint" }], maxFindingsPerSection: 9 },
    ]);
    expect(policy.checks).toEqual([{ builtin: "oxlint" }]);
    expect(policy.severity).toBe("error");
    expect(policy.maxFindingsPerSection).toBe(9);
    expect(policy.auto).toBe(false);
  });

  it("severity 乱值回退上一层并触发 onInvalid", () => {
    const messages: string[] = [];
    const policy = resolveDiagnosticsPolicy(
      [{ severity: "error" }, { severity: "fatal" as never }],
      (message) => messages.push(message),
    );
    expect(policy.severity).toBe("error");
    expect(messages).toEqual([expect.stringContaining("severity 取值非法")]);
    expect(messages[0]).toContain("fatal");
  });

  it("maxFindingsPerSection / maxMessageChars 非法时回退并触发 onInvalid", () => {
    const messages: string[] = [];
    const policy = resolveDiagnosticsPolicy(
      [{ maxFindingsPerSection: 0, maxMessageChars: -3 }],
      (message) => messages.push(message),
    );
    expect(policy.maxFindingsPerSection).toBe(DEFAULT_MAX_FINDINGS_PER_SECTION);
    expect(policy.maxMessageChars).toBe(DEFAULT_MAX_MESSAGE_CHARS);
    expect(messages).toEqual([
      expect.stringContaining("maxFindingsPerSection 必须是 ≥ 1 的整数"),
      expect.stringContaining("maxMessageChars 必须是 ≥ 1 的整数"),
    ]);
  });

  it("checks 非数组时回退内置检查并触发 onInvalid", () => {
    const messages: string[] = [];
    const policy = resolveDiagnosticsPolicy([{ checks: "eslint" as never }], (message) =>
      messages.push(message),
    );
    expect(policy.checks).toEqual([...DEFAULT_BUILTIN_CHECKS]);
    expect(messages).toEqual([expect.stringContaining("checks 必须是数组")]);
  });

  it("未知 builtin id / 缺 command+bin 的检查被丢弃并触发 onInvalid", () => {
    const messages: string[] = [];
    const policy = resolveDiagnosticsPolicy(
      [
        {
          checks: [
            { builtin: "typecheck" },
            { builtin: "biome" as never },
            { name: "无命令" } as never,
          ],
        },
      ],
      (message) => messages.push(message),
    );
    expect(policy.checks).toEqual([{ builtin: "typecheck" }]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("已跳过");
    expect(messages[1]).toContain("已跳过");
  });

  it("checks 归一化后为空时回退内置检查", () => {
    const messages: string[] = [];
    const policy = resolveDiagnosticsPolicy([{ checks: [null as never] }], (message) =>
      messages.push(message),
    );
    expect(policy.checks).toEqual([...DEFAULT_BUILTIN_CHECKS]);
    expect(messages.some((message) => message.includes("归一化后为空"))).toBe(true);
  });

  it("extensions 归一化：补前导点、小写、去重、丢空项", () => {
    const policy = resolveDiagnosticsPolicy([
      { checks: [{ builtin: "stylelint", extensions: ["CSS", " .Scss ", "css", "   ", ".less"] }] },
    ]);
    const check = policy.checks[0] as LinterPresetCheck;
    expect(check.builtin).toBe("stylelint");
    expect(check.extensions).toEqual([".css", ".scss", ".less"]);
  });

  it("自定义命令检查同样归一化 extensions，并保留 adapter / format / timeoutMs", () => {
    const policy = resolveDiagnosticsPolicy([
      {
        checks: [
          {
            name: "自研工具",
            bin: "my-tool",
            args: ["--json", 3 as never],
            extensions: ["TS"],
            format: "text",
            adapter: "tools/a.mjs",
            timeoutMs: 1500.7,
          },
        ],
      },
    ]);
    expect(policy.checks[0]).toEqual({
      name: "自研工具",
      bin: "my-tool",
      args: ["--json"],
      extensions: [".ts"],
      format: "text",
      adapter: "tools/a.mjs",
      timeoutMs: 1500,
    });
  });

  it("非法 run / format / 非正 timeoutMs 被忽略", () => {
    const policy = resolveDiagnosticsPolicy([
      {
        checks: [
          { builtin: "eslint", run: "sometimes" as never, format: "yaml" as never, timeoutMs: 0 },
        ],
      },
    ]);
    expect(policy.checks[0]).toEqual({ builtin: "eslint" });
  });
});

describe("检查形状判定与扩展名匹配", () => {
  it("isTypecheckCheck / isLinterPreset / isCommandCheck 互斥且正确", () => {
    expect(isTypecheckCheck({ builtin: "typecheck" })).toBe(true);
    expect(isLinterPreset({ builtin: "typecheck" })).toBe(false);
    expect(isLinterPreset({ builtin: "eslint" })).toBe(true);
    expect(isCommandCheck({ name: "x", command: "c" })).toBe(true);
    expect(isCommandCheck({ builtin: "eslint" })).toBe(false);
  });

  it("matchesExtensions：未声明不限，声明则按后缀匹配（大小写不敏感）", () => {
    expect(matchesExtensions("a/b/c.ts", undefined)).toBe(true);
    expect(matchesExtensions("a/b/c.ts", [])).toBe(true);
    expect(matchesExtensions("a/b/c.ts", [".ts"])).toBe(true);
    expect(matchesExtensions("a/b/c.ts", [".css"])).toBe(false);
    expect(matchesExtensions("a/b/C.TS", [".ts"])).toBe(true);
    expect(matchesExtensions("README", [".ts"])).toBe(false);
    expect(matchesExtensions("a\\b\\c.ts", [".ts"])).toBe(true);
  });
});

describe("内置预设：项目本地 bin 解析与未安装语义", () => {
  const ESLINT_BIN = { eslint: { bin: { eslint: "bin/eslint.js" } } };

  it("eslint 预设展开成 node <项目本地 bin> --format json <files>", async () => {
    const ws = makeProject(ESLINT_BIN);
    const file = path.join(ws, "a.ts");
    const calls = trackExeca({
      stdout: JSON.stringify([
        {
          filePath: file,
          messages: [{ severity: 2, line: 4, column: 2, message: "boom", ruleId: "no-x" }],
        },
      ]),
      exitCode: 1,
    });

    const result = await runOneCheck({ builtin: "eslint" }, { kind: "file", file, cwd: ws });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("node");
    expect(calls[0].args).toEqual([
      path.join(ws, "node_modules/eslint/bin/eslint.js"),
      ...BUILTIN_LINTERS.eslint.args.slice(0, -1),
      file,
    ]);
    expect(calls[0].cwd).toBe(ws);

    const section = result.sections[0];
    expect(section.name).toBe(BUILTIN_LINTERS.eslint.label);
    expect(section.text).toContain(`ERROR [${file}:4:2] boom (no-x)`);
    expect(section.diagnostics).toEqual([
      {
        file,
        severity: SEVERITY_ERROR,
        range: { start: { line: 3, character: 1 }, end: { line: 3, character: 1 } },
        message: "[ESLint] boom (no-x)",
        source: "ESLint",
      },
    ]);
  });

  it("project 目标用预设的 projectArgs 全量跑一次", async () => {
    const ws = makeProject(ESLINT_BIN);
    const calls = trackExeca({ stdout: "[]", exitCode: 0 });

    const result = await runOneCheck({ builtin: "eslint" }, { kind: "project", cwd: ws });

    expect(calls[0].args).toEqual([
      path.join(ws, "node_modules/eslint/bin/eslint.js"),
      ...BUILTIN_LINTERS.eslint.projectArgs,
    ]);
    expect(result.sections[0].name).toBe(BUILTIN_LINTERS.eslint.label);
    expect(result.sections[0].text).toBe("没有发现问题");
  });

  it("项目没装 eslint：edit 阶段静默跳过，manual 阶段给未运行分区", async () => {
    const ws = makeProject();
    const target: DiagnosticsTarget = { kind: "edited", files: [path.join(ws, "a.ts")], cwd: ws };
    const calls = trackExeca();

    const mod = await freshModule();
    const policy = resolvePolicy({ checks: [{ builtin: "eslint" }] });
    const edited = await mod.runDiagnostics(target, policy, "edit");
    expect(edited.sections).toEqual([]);

    const manual = await mod.runDiagnostics(target, policy, "manual");
    expect(calls).toHaveLength(0);
    expect(manual.sections).toHaveLength(1);
    expect(manual.sections[0].name).toBe(BUILTIN_LINTERS.eslint.label);
    expect(manual.sections[0].text).toContain("未运行");
    expect(manual.sections[0].text).toContain("eslint");
    expect(manual.sections[0].diagnostics).toEqual([]);
  });
});

describe("extensions 过滤", () => {
  const LIBS = {
    eslint: { bin: { eslint: "bin/eslint.js" } },
    stylelint: { bin: { stylelint: "bin/stylelint.js" } },
  };
  const STYLELINT_JSON = JSON.stringify([
    {
      source: "a.css",
      warnings: [
        { line: 2, column: 5, severity: "warning", text: "Unexpected color", rule: "color-no-hex" },
      ],
    },
  ]);

  it("编辑 .css：eslint 预设不产出分区，stylelint 预设产出", async () => {
    const ws = makeProject(LIBS);
    const css = path.join(ws, "a.css");
    const calls = trackExeca({ stdout: STYLELINT_JSON, exitCode: 0 });
    const target: DiagnosticsTarget = { kind: "edited", files: [css], cwd: ws };

    const mod = await freshModule();
    const eslintOnly = await mod.runDiagnostics(
      target,
      resolvePolicy({ checks: [{ builtin: "eslint" }] }),
      "edit",
    );
    expect(eslintOnly.sections).toEqual([]);
    expect(calls).toHaveLength(0);

    const stylelint = await mod.runDiagnostics(
      target,
      resolvePolicy({ checks: [{ builtin: "stylelint", extensions: [".css"] }] }),
      "edit",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      path.join(ws, "node_modules/stylelint/bin/stylelint.js"),
      ...BUILTIN_LINTERS.stylelint.args.slice(0, -1),
      css,
    ]);
    expect(stylelint.sections).toHaveLength(1);
    expect(stylelint.sections[0].name).toBe(BUILTIN_LINTERS.stylelint.label);
    expect(stylelint.sections[0].target).toBe("a.css");
    expect(stylelint.sections[0].text).toContain(
      `WARN [${css}:2:5] Unexpected color (color-no-hex)`,
    );
  });

  it("单文件目标 .css 同理：eslint 被过滤，stylelint 产出（无 target 拆分）", async () => {
    const ws = makeProject(LIBS);
    const css = path.join(ws, "a.css");
    const calls = trackExeca({ stdout: STYLELINT_JSON, exitCode: 0 });

    const filtered = await runOneCheck(
      { builtin: "eslint" },
      { kind: "file", file: css, cwd: ws },
      "manual",
    );
    expect(filtered.sections[0].name).toBe("检查");
    expect(filtered.sections[0].text).toContain("没有可运行的检查");
    expect(calls).toHaveLength(0);

    const stylelint = await runOneCheck(
      { builtin: "stylelint", extensions: [".css"] },
      { kind: "file", file: css, cwd: ws },
      "manual",
    );
    expect(calls).toHaveLength(1);
    expect(stylelint.sections).toHaveLength(1);
    expect(stylelint.sections[0].target).toBeUndefined();
  });

  it("全部检查被过滤时 manual 返回一条没有可运行的检查分区", async () => {
    const ws = makeProject(LIBS);
    const css = path.join(ws, "a.css");
    const calls = trackExeca();

    const edited = await runOneCheck(
      { builtin: "eslint" },
      { kind: "edited", files: [css], cwd: ws },
      "edit",
    );
    expect(edited.sections).toEqual([]);

    const manual = await runOneCheck(
      { builtin: "eslint" },
      { kind: "edited", files: [css], cwd: ws },
      "manual",
    );
    expect(calls).toHaveLength(0);
    expect(manual.sections).toHaveLength(1);
    expect(manual.sections[0].name).toBe("检查");
    expect(manual.sections[0].text).toContain("没有可运行的检查");
    expect(manual.sections[0].diagnostics).toEqual([]);
  });
});

describe("占位符与目标", () => {
  it("{file} 逐文件各调用一次，分区带各自 target", async () => {
    const ws = makeProject();
    const a = path.join(ws, "a.ts");
    const b = path.join(ws, "b.ts");
    const calls = trackExeca({ stdout: "ok", exitCode: 0 });

    const result = await runOneCheck(
      { name: "PerFile", command: "fake-tool", args: ["--check", "{file}"], extensions: [".ts"] },
      { kind: "edited", files: [a, b], cwd: ws },
      "edit",
    );

    expect(calls.map((call) => call.args)).toEqual([
      ["--check", a],
      ["--check", b],
    ]);
    expect(calls.every((call) => call.command === "fake-tool" && call.cwd === ws)).toBe(true);
    expect(result.sections.map((section) => section.target)).toEqual(["a.ts", "b.ts"]);
    expect(result.sections.map((section) => section.text)).toEqual(["ok", "ok"]);
  });

  it("{files} 一次传入全部目标文件", async () => {
    const ws = makeProject();
    const a = path.join(ws, "a.ts");
    const b = path.join(ws, "b.ts");
    const calls = trackExeca({ stdout: "ok", exitCode: 0 });

    const result = await runOneCheck(
      { name: "AllFiles", command: "fake-tool", args: ["--check", "{files}"], extensions: [".ts"] },
      { kind: "edited", files: [a, b], cwd: ws },
      "edit",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["--check", `${a} ${b}`]);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].target).toBeUndefined();
    expect(result.sections[0].text).toBe("ok");
  });

  it("无占位符的检查在 file / project / edited 三种目标都各跑一次", async () => {
    const ws = makeProject();
    const a = path.join(ws, "a.ts");
    const calls = trackExeca({ stdout: "all-clean", exitCode: 0 });

    const mod = await freshModule();
    const policy = resolvePolicy({
      checks: [{ name: "ProjectWide", command: "fake-tool", args: ["--all"] }],
    });
    const file = await mod.runDiagnostics({ kind: "file", file: a, cwd: ws }, policy, "manual");
    const project = await mod.runDiagnostics({ kind: "project", cwd: ws }, policy, "manual");
    const edited = await mod.runDiagnostics(
      { kind: "edited", files: [a], cwd: ws },
      policy,
      "edit",
    );

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.args)).toEqual([["--all"], ["--all"], ["--all"]]);
    expect(calls.every((call) => call.args.length === 1 && call.args[0] === "--all")).toBe(true);
    expect(file.sections[0].text).toBe("all-clean");
    expect(project.sections[0].name).toBe("ProjectWide");
    expect(edited.sections[0].text).toBe("all-clean");
  });

  it("project 目标用 projectArgs；未声明 projectArgs 且含占位符则跳过", async () => {
    const ws = makeProject();
    const calls = trackExeca({ stdout: "proj", exitCode: 0 });

    const mod = await freshModule();
    const withProjectArgs = await mod.runDiagnostics(
      { kind: "project", cwd: ws },
      resolvePolicy({
        checks: [
          {
            name: "WithProject",
            command: "fake-tool",
            args: ["--file", "{file}"],
            projectArgs: ["--project"],
          },
        ],
      }),
      "manual",
    );
    expect(calls.map((call) => call.args)).toEqual([["--project"]]);
    expect(withProjectArgs.sections[0].name).toBe("WithProject");

    calls.length = 0;
    const skipped = await mod.runDiagnostics(
      { kind: "project", cwd: ws },
      resolvePolicy({
        checks: [{ name: "NoProject", command: "fake-tool", args: ["--files", "{files}"] }],
      }),
      "edit",
    );
    expect(calls).toHaveLength(0);
    expect(skipped.sections).toEqual([]);
  });
});

describe("输出适配器", () => {
  it("text：stdout / stderr 原样作为分区正文，无结构化条目", async () => {
    const ws = makeProject();
    trackExeca({ stdout: "line one\nline two", stderr: "to stderr", exitCode: 1 });

    const result = await runOneCheck(
      { name: "Raw", command: "fake-tool", format: "text" },
      { kind: "project", cwd: ws },
    );

    expect(result.sections[0].text).toBe("line one\nline two\nto stderr");
    expect(result.sections[0].diagnostics).toEqual([]);
  });

  it("tsc：复用 tsc 输出解析，并按 severity 过滤文本", async () => {
    const ws = makeProject();
    const raw = ["a.ts(3,5): error TS2322: bad", "b.ts(1,2): warning TS6133: warn"].join("\n");
    trackExeca({ stdout: raw, exitCode: 1 });

    const all = await runOneCheck(
      { name: "MyTsc", command: "fake-tool", format: "tsc" },
      { kind: "project", cwd: ws },
    );
    expect(all.sections[0].text).toBe(raw);
    expect(all.sections[0].diagnostics).toHaveLength(2);
    expect(all.sections[0].diagnostics[0]).toMatchObject({
      severity: SEVERITY_ERROR,
      file: path.resolve(ws, "a.ts"),
      source: "MyTsc",
      message: "[TS2322] bad",
      range: { start: { line: 2, character: 4 } },
    });

    const strict = await runOneCheck(
      { name: "MyTsc", command: "fake-tool", format: "tsc" },
      { kind: "project", cwd: ws },
      "manual",
      { severity: "error" },
    );
    // error 门槛：只保留 tsc 原文里的 error 行（warning 行连同其续行一起丢）
    expect(strict.sections[0].text).toBe("a.ts(3,5): error TS2322: bad");
    expect(strict.sections[0].text).not.toContain("TS6133");
    expect(strict.sections[0].diagnostics).toHaveLength(1);
    expect(strict.sections[0].diagnostics[0]).toMatchObject({ severity: SEVERITY_ERROR });
  });

  it("eslint-json：解析 ESLint 数组并渲染文本 + 结构化条目", async () => {
    const ws = makeProject();
    trackExeca({
      stdout: JSON.stringify([
        {
          filePath: "src/a.ts",
          messages: [
            {
              severity: 2,
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 4,
              message: "boom",
              ruleId: "no-x",
            },
            { severity: 1, line: 2, column: 1, message: "meh", ruleId: "no-y" },
          ],
        },
      ]),
      exitCode: 1,
    });
    const file = path.resolve(ws, "src/a.ts");

    const result = await runOneCheck(
      { name: "Elint", command: "fake-tool", format: "eslint-json" },
      { kind: "project", cwd: ws },
    );

    expect(result.sections[0].text).toContain(`ERROR [${file}:1:1] boom (no-x)`);
    expect(result.sections[0].text).toContain(`WARN [${file}:2:1] meh (no-y)`);
    expect(result.sections[0].diagnostics[0]).toEqual({
      file,
      severity: SEVERITY_ERROR,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      message: "[Elint] boom (no-x)",
      source: "Elint",
    });
    expect(result.sections[0].diagnostics[1]).toMatchObject({
      severity: SEVERITY_WARN,
      file,
      message: "[Elint] meh (no-y)",
    });
  });

  it("oxlint-json：解析 oxlint 自有格式并归一规则名", async () => {
    const ws = makeProject();
    trackExeca({
      stdout: JSON.stringify({
        diagnostics: [
          {
            message: "Variable 'x' is declared but never used.",
            code: "eslint(no-unused-vars)",
            severity: "warning",
            filename: "a.js",
            labels: [{ span: { line: 1, column: 7, length: 9 } }],
          },
        ],
        number_of_files: 1,
      }),
      exitCode: 0,
    });
    const file = path.resolve(ws, "a.js");

    const result = await runOneCheck(
      { name: "Oxlint", command: "fake-tool", format: "oxlint-json" },
      { kind: "project", cwd: ws },
    );

    expect(result.sections[0].text).toBe(
      `WARN [${file}:1:7] Variable 'x' is declared but never used. (no-unused-vars)`,
    );
    expect(result.sections[0].diagnostics).toEqual([
      {
        file,
        severity: SEVERITY_WARN,
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 15 } },
        message: "[Oxlint] Variable 'x' is declared but never used. (no-unused-vars)",
        source: "Oxlint",
      },
    ]);
  });

  it("stylelint-json：解析 stylelint 数组", async () => {
    const ws = makeProject();
    trackExeca({
      stdout: JSON.stringify([
        {
          source: "a.css",
          warnings: [
            {
              line: 3,
              column: 2,
              endLine: 3,
              endColumn: 9,
              severity: "error",
              text: "Unexpected hex",
              rule: "color-no-hex",
            },
          ],
        },
      ]),
      exitCode: 2,
    });
    const file = path.resolve(ws, "a.css");

    const result = await runOneCheck(
      { name: "Stylelint", command: "fake-tool", format: "stylelint-json" },
      { kind: "project", cwd: ws },
    );

    expect(result.sections[0].text).toBe(`ERROR [${file}:3:2] Unexpected hex (color-no-hex)`);
    expect(result.sections[0].diagnostics[0]).toMatchObject({
      file,
      severity: SEVERITY_ERROR,
      range: { start: { line: 2, character: 1 }, end: { line: 2, character: 8 } },
      message: "[Stylelint] Unexpected hex (color-no-hex)",
    });
  });

  it("aipanel-json：1-based 条目换算成 0-based DiagnosticItem 并统一渲染", async () => {
    const ws = makeProject();
    const file = path.join(ws, "a.ts");
    trackExeca({
      stdout: JSON.stringify({
        text: "适配器自定义叙述（有条目时被统一渲染覆盖）",
        diagnostics: [
          { file, line: 2, column: 3, severity: "error", message: "boom" },
          { file, line: 5, column: 1, severity: "warning", message: "meh" },
        ],
      }),
      exitCode: 0,
    });

    const result = await runOneCheck(
      { name: "SelfTool", command: "fake-tool", format: "aipanel-json" },
      { kind: "project", cwd: ws },
    );

    expect(result.sections[0].diagnostics).toEqual([
      {
        file,
        severity: SEVERITY_ERROR,
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } },
        message: "boom",
        source: "SelfTool",
      },
      {
        file,
        severity: SEVERITY_WARN,
        range: { start: { line: 4, character: 0 }, end: { line: 4, character: 0 } },
        message: "meh",
        source: "SelfTool",
      },
    ]);
    expect(result.sections[0].text).toBe(`ERROR [${file}:2:3] boom\nWARN [${file}:5:1] meh`);
  });

  it("aipanel-json 裸数组（ADR-0004 §5 声明支持）也能解析出条目", async () => {
    const ws = makeProject();
    const file = path.join(ws, "a.ts");
    trackExeca({
      stdout: JSON.stringify([{ file, line: 2, column: 3, severity: "error", message: "boom" }]),
      exitCode: 0,
    });

    const result = await runOneCheck(
      { name: "SelfTool", command: "fake-tool", format: "aipanel-json" },
      { kind: "project", cwd: ws },
    );

    expect(result.sections[0].diagnostics).toHaveLength(1);
  });

  it("aipanel-json：字段非法时给出明确的失败分区文案", async () => {
    const ws = makeProject();
    const invalid: Array<[Record<string, unknown>, string]> = [
      [
        { file: "", line: 1, column: 1, severity: "error", message: "x" },
        "diagnostics[0].file 必须是非空字符串",
      ],
      [
        { file: "a.ts", line: 0, column: 1, severity: "error", message: "x" },
        "diagnostics[0].line 必须是 ≥ 1 的数字",
      ],
      [
        { file: "a.ts", line: 1, column: 0, severity: "error", message: "x" },
        "diagnostics[0].column 必须是 ≥ 1 的数字",
      ],
      [
        { file: "a.ts", line: 1, column: 1, severity: "info", message: "x" },
        'diagnostics[0].severity 必须是 "error" 或 "warning"',
      ],
      [
        { file: "a.ts", line: 1, column: 1, severity: "error", message: 5 },
        "diagnostics[0].message 必须是字符串",
      ],
    ];
    const check: CommandCheck = { name: "SelfTool", command: "fake-tool", format: "aipanel-json" };

    for (const [entry, message] of invalid) {
      execaImpl = () => ({
        stdout: JSON.stringify({ diagnostics: [entry] }),
        stderr: "",
        exitCode: 0,
      });
      const mod = await freshModule();
      const result = await mod.runDiagnostics(
        { kind: "project", cwd: ws },
        resolvePolicy({ checks: [check] }),
        "manual",
      );
      expect(result.sections[0].text).toContain(message);
      expect(result.sections[0].diagnostics).toEqual([]);
    }

    execaImpl = () => ({ stdout: JSON.stringify({ diagnostics: "nope" }), exitCode: 0 });
    const mod = await freshModule();
    const result = await mod.runDiagnostics(
      { kind: "project", cwd: ws },
      resolvePolicy({ checks: [check] }),
      "manual",
    );
    expect(result.sections[0].text).toContain("diagnostics 必须是数组");
  });
});

describe("用户适配器模块", () => {
  function writeAdapter(ws: string, source: string): void {
    fs.writeFileSync(path.join(ws, "adapter.mjs"), source);
  }

  const adapterCheck: CommandCheck = {
    name: "SelfTool",
    command: "fake-tool",
    adapter: "adapter.mjs",
  };

  async function runAdapter(ws: string): Promise<DiagnosticsResult> {
    return runOneCheck(adapterCheck, { kind: "project", cwd: ws });
  }

  it("async 适配器：返回值归一成结构化条目（1-based → 0-based）", async () => {
    const ws = makeProject();
    const file = path.join(ws, "a.ts");
    writeAdapter(
      ws,
      `export default async (input) => ({
         diagnostics: [
           { file: ${JSON.stringify(file)}, line: 2, column: 3, severity: "error", message: "from " + input.name },
         ],
       });\n`,
    );
    trackExeca({ stdout: "raw", exitCode: 0 });

    const result = await runAdapter(ws);

    expect(result.sections[0].text).toBe(`ERROR [${file}:2:3] from SelfTool`);
    expect(result.sections[0].diagnostics).toEqual([
      {
        file,
        severity: SEVERITY_ERROR,
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } },
        message: "from SelfTool",
        source: "SelfTool",
      },
    ]);
  });

  it("只返回 text 的适配器：正文原样采用，无结构化条目", async () => {
    const ws = makeProject();
    writeAdapter(ws, `export default () => ({ text: "自定义叙述" });\n`);
    trackExeca({ stdout: "raw", exitCode: 0 });

    const result = await runAdapter(ws);

    expect(result.sections[0].text).toBe("自定义叙述");
    expect(result.sections[0].diagnostics).toEqual([]);
  });

  it("返回非法 diagnostics：报适配器不可用文案且不抛异常", async () => {
    const ws = makeProject();
    writeAdapter(ws, `export default () => ({ diagnostics: "nope" });\n`);
    trackExeca({ stdout: "raw", exitCode: 0 });

    const result = await runAdapter(ws);

    expect(result.sections[0].text).toContain("适配器不可用");
    expect(result.sections[0].text).toContain("diagnostics 必须是数组");
    expect(result.sections[0].diagnostics).toEqual([]);
  });

  it("没有 default export 函数：报适配器不可用文案", async () => {
    const ws = makeProject();
    writeAdapter(ws, `export default { not: "a function" };\n`);
    trackExeca({ stdout: "raw", exitCode: 0 });

    const result = await runAdapter(ws);

    expect(result.sections[0].text).toContain("适配器不可用");
    expect(result.sections[0].text).toContain("必须 default export 一个适配器函数");
  });

  it("模块加载时抛错：报适配器不可用文案且不抛异常", async () => {
    const ws = makeProject();
    writeAdapter(ws, `throw new Error("模块炸了");\n`);
    trackExeca({ stdout: "raw", exitCode: 0 });

    const result = await runAdapter(ws);

    expect(result.sections[0].text).toContain("适配器不可用");
    expect(result.sections[0].text).toContain("模块炸了");
    expect(result.sections[0].diagnostics).toEqual([]);
  });
});

describe("severity 门槛", () => {
  const ESLINT_JSON = JSON.stringify([
    {
      filePath: "a.ts",
      messages: [
        { severity: 2, line: 1, column: 1, message: "error-msg", ruleId: "err" },
        { severity: 1, line: 2, column: 1, message: "warn-msg", ruleId: "warn" },
      ],
    },
  ]);

  it("error 门槛：文本与结构化条目同时只剩 error", async () => {
    const ws = makeProject();
    const file = path.resolve(ws, "a.ts");
    trackExeca({ stdout: ESLINT_JSON, exitCode: 1 });
    const check: CommandCheck = { name: "Elint", command: "fake-tool", format: "eslint-json" };

    const mod = await freshModule();
    const result = await mod.runDiagnostics(
      { kind: "project", cwd: ws },
      resolvePolicy({ checks: [check], severity: "error" }),
      "manual",
    );

    expect(result.sections[0].text).toBe(`ERROR [${file}:1:1] error-msg (err)`);
    expect(result.sections[0].text).not.toContain("warn-msg");
    expect(result.sections[0].diagnostics).toHaveLength(1);
    expect(result.sections[0].diagnostics[0]).toMatchObject({ severity: SEVERITY_ERROR });
  });

  it("warning 门槛（默认）保留 error 与 warning", async () => {
    const ws = makeProject();
    trackExeca({ stdout: ESLINT_JSON, exitCode: 1 });

    const result = await runOneCheck(
      { name: "Elint", command: "fake-tool", format: "eslint-json" },
      { kind: "project", cwd: ws },
    );

    expect(result.sections[0].text).toContain("error-msg");
    expect(result.sections[0].text).toContain("warn-msg");
    expect(result.sections[0].diagnostics).toHaveLength(2);
  });
});

describe("命令失败语义", () => {
  const target = (cwd: string): DiagnosticsTarget => ({ kind: "project", cwd });

  it("命令不存在：明确文案且不抛异常", async () => {
    const ws = makeProject();
    trackExeca({ failed: true, exitCode: undefined, originalMessage: "spawn missing-tool ENOENT" });

    const result = await runOneCheck({ name: "Broken", command: "missing-tool" }, target(ws));

    expect(result.sections[0].text).toContain("运行失败");
    expect(result.sections[0].text).toContain("missing-tool");
    expect(result.sections[0].text).toContain("spawn missing-tool ENOENT");
    expect(result.sections[0].diagnostics).toEqual([]);
  });

  it("超时：timedOut 给出带超时上限的文案", async () => {
    const ws = makeProject();
    trackExeca({ timedOut: true, failed: true, exitCode: undefined });

    const result = await runOneCheck({ name: "Slow", command: "fake-tool" }, target(ws));

    expect(result.sections[0].text).toContain("检查超时");
    expect(result.sections[0].text).toContain("60000ms");
    expect(result.sections[0].diagnostics).toEqual([]);
  });

  it("超时：自定义 timeoutMs 出现在文案里", async () => {
    const ws = makeProject();
    trackExeca({ timedOut: true, failed: true, exitCode: undefined });

    const result = await runOneCheck(
      { name: "Slow", command: "fake-tool", timeoutMs: 1234 },
      target(ws),
    );

    expect(result.sections[0].text).toContain("1234ms");
  });

  it("maxBuffer：输出超限给出缩小范围的文案", async () => {
    const ws = makeProject();
    trackExeca({ isMaxBuffer: true, failed: true, exitCode: undefined });

    const result = await runOneCheck({ name: "Flood", command: "fake-tool" }, target(ws));

    expect(result.sections[0].text).toContain("运行失败");
    expect(result.sections[0].text).toContain("输出超过上限");
    expect(result.sections[0].diagnostics).toEqual([]);
  });
});

describe("runDiagnostics 集成（预设 + typecheck 有序分区）", () => {
  it("按声明顺序执行 eslint 预设与 typecheck，分区标题跟随实际引擎", async () => {
    const ws = makeTsProject(
      { vue: "^3.5" },
      {
        eslint: { bin: { eslint: "bin/eslint.js" } },
        "vue-tsc": { version: "3.3.11", bin: { "vue-tsc": "./bin/vue-tsc.js" } },
        typescript: { version: "6.0.3", bin: { tsc: "./bin/tsc" } },
      },
    );
    const file = path.join(ws, "a.ts");
    const calls = trackExeca(() => ({ stdout: "", exitCode: 0 }));
    execaImpl = (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd });
      if (args[0].includes("vue-tsc")) {
        return { stdout: "a.ts(1,1): error TS1: bad", exitCode: 1 };
      }
      return {
        stdout: JSON.stringify([
          {
            filePath: file,
            messages: [{ severity: 2, line: 1, column: 1, message: "lint", ruleId: "r" }],
          },
        ]),
        exitCode: 1,
      };
    };

    const mod = await freshModule();
    const result = await mod.runDiagnostics(
      { kind: "file", file, cwd: ws },
      resolvePolicy({ checks: [{ builtin: "eslint" }, { builtin: "typecheck" }] }),
      "manual",
    );

    expect(result.sections.map((section) => section.name)).toEqual([
      BUILTIN_LINTERS.eslint.label,
      "vue-tsc",
    ]);
    expect(result.sections[1].diagnostics[0]).toMatchObject({ source: "vue-tsc" });
    expect(tscSectionTitle({ rawOutput: "", exitCode: 0, source: "tsc" })).toBe("tsc");
  });
});

describe("runTypeCheck", () => {
  it("returns an empty success when no engine can be resolved", async () => {
    bundledVueTscResolvable = false;
    const mod = await freshModule();
    // /proj 无 package.json → 项目自身没装检查器，自带 vue-tsc 也解析不到 → 空结果
    const result = await mod.runTypeCheck(undefined, "/proj");
    expect(result).toEqual({ rawOutput: "", exitCode: 0 });
  });

  it("parses tsc diagnostics and reports the exit code in full-project mode", async () => {
    execaImpl = (_file, args, opts) => {
      expect(opts.cwd).toBe("/proj");
      expect(args).toEqual([
        expect.stringContaining("vue-tsc"),
        "--build",
        "--noEmit",
        "--pretty",
        "false",
      ]);
      return {
        stdout:
          "src/a.ts(3,5): error TS2322: Type 'X' is not assignable\nsrc/b.ts(1,2): warning TS6133: 'v' is declared but never used",
        exitCode: 1,
      };
    };
    const mod = await freshModule();
    const result = await mod.runTypeCheck(undefined, "/proj");

    expect(result.exitCode).toBe(1);
    expect(result.rawOutput).toContain("error TS2322");
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics![0]).toMatchObject({
      severity: SEVERITY_ERROR,
      file: path.resolve("/proj", "src/a.ts"),
      source: "vue-tsc",
      message: "[TS2322] Type 'X' is not assignable",
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 4 } },
    });
    expect(result.diagnostics![1]).toMatchObject({
      severity: SEVERITY_WARN,
      file: path.resolve("/proj", "src/b.ts"),
      message: "[TS6133] 'v' is declared but never used",
    });
  });

  it("flags a killed process as exit code 1 with a timeout message", async () => {
    execaImpl = () => ({ timedOut: true });
    const mod = await freshModule();
    const result = await mod.runTypeCheck(undefined, "/proj");
    expect(result.exitCode).toBe(1);
    expect(result.rawOutput).toContain("超时");
  });
});

describe("runTypeCheck 引擎选择", () => {
  const WORKSPACE_TSC = { typescript: { version: "6.0.3", bin: { tsc: "./bin/tsc" } } };
  const WORKSPACE_VUE_TSC = {
    "vue-tsc": { version: "3.3.11", bin: { "vue-tsc": "./bin/vue-tsc.js" } },
  };

  it("非 Vue 项目用项目自身的 tsc（版本与项目一致）", async () => {
    const dir = makeTsProject({ react: "^19" }, WORKSPACE_TSC);
    let ranArgs: string[] = [];
    execaImpl = (_file, args, opts) => {
      ranArgs = args;
      expect(opts.cwd).toBe(dir);
      return { stdout: "a.ts(1,1): error TS1: boom", exitCode: 1 };
    };
    const mod = await freshModule();
    const result = await mod.runTypeCheck(undefined, dir);
    expect(ranArgs).toEqual([
      path.join(dir, "node_modules/typescript/bin/tsc"),
      "--build",
      "--noEmit",
      "--pretty",
      "false",
    ]);
    expect(result.source).toBe("tsc");
    expect(result.diagnostics![0]).toMatchObject({ source: "tsc" });
  });

  it("Vue 项目优先项目自身的 vue-tsc，而不是本包自带的", async () => {
    const dir = makeTsProject({ vue: "^3.5" }, { ...WORKSPACE_VUE_TSC, ...WORKSPACE_TSC });
    let ranBin = "";
    execaImpl = (_file, args) => {
      ranBin = args[0];
      return { exitCode: 0 };
    };
    const mod = await freshModule();
    const result = await mod.runTypeCheck(undefined, dir);
    expect(ranBin).toBe(path.join(dir, "node_modules/vue-tsc/bin/vue-tsc.js"));
    expect(result.source).toBe("vue-tsc");
  });

  it("Vue 项目没装 vue-tsc 时回落本包自带", async () => {
    const dir = makeTsProject({ vue: "^3.5" }, WORKSPACE_TSC);
    let ranBin = "";
    execaImpl = (_file, args) => {
      ranBin = args[0];
      return { exitCode: 0 };
    };
    const mod = await freshModule();
    const result = await mod.runTypeCheck(undefined, dir);
    expect(ranBin).toContain("vue-tsc");
    expect(ranBin.startsWith(dir)).toBe(false);
    expect(result.source).toBe("vue-tsc");
  });

  it("非 Vue 项目没装 tsc 但装了 vue-tsc 时用项目的 vue-tsc", async () => {
    const dir = makeTsProject({ react: "^19" }, WORKSPACE_VUE_TSC);
    let ranBin = "";
    execaImpl = (_file, args) => {
      ranBin = args[0];
      return { exitCode: 0 };
    };
    const mod = await freshModule();
    const result = await mod.runTypeCheck(undefined, dir);
    expect(ranBin).toBe(path.join(dir, "node_modules/vue-tsc/bin/vue-tsc.js"));
    expect(result.source).toBe("vue-tsc");
  });

  it("老版本 TS（< 5.6）不支持 --build --noEmit：逐项目 -p 并按 references 展开", async () => {
    const dir = makeTsProject(
      { vue: "^2.7" },
      {
        "vue-tsc": { version: "1.8.27", bin: { "vue-tsc": "./bin/vue-tsc.js" } },
        typescript: { version: "5.5.4", bin: { tsc: "./bin/tsc" } },
      },
    );
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
    );
    fs.writeFileSync(path.join(dir, "tsconfig.app.json"), JSON.stringify({ include: ["src"] }));

    const runs: string[][] = [];
    execaImpl = (_file, args) => {
      if (args.includes("--showConfig")) {
        // execa 的 argv[0] 是引擎 bin；solution 式根配置自身没有程序（只有 references）
        const config = args[2];
        return {
          stdout: JSON.stringify(
            config.endsWith("tsconfig.app.json")
              ? { include: ["src"] }
              : { references: [{ path: "./tsconfig.app.json" }] },
          ),
          exitCode: 0,
        };
      }
      runs.push(args);
      return { stdout: "src/a.ts(1,1): error TS1: old", exitCode: 1 };
    };
    const mod = await freshModule();
    const result = await mod.runTypeCheck(undefined, dir);
    expect(runs).toEqual([
      [
        path.join(dir, "node_modules/vue-tsc/bin/vue-tsc.js"),
        "-p",
        "tsconfig.app.json",
        "--noEmit",
        "--pretty",
        "false",
      ],
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.source).toBe("vue-tsc");
  });

  it("TS 版本解析不到时用最保守的 -p 模式（不吃 TS5094）", async () => {
    // 装了 vue-tsc 但解析不出它背后的 typescript 版本（如软链安装、NODE_PATH 干扰）
    const dir = makeTsProject(
      { vue: "^3.5" },
      { "vue-tsc": { version: "3.3.11", bin: { "vue-tsc": "./bin/vue-tsc.js" } } },
    );
    const runs: string[][] = [];
    execaImpl = (_file, args) => {
      if (args.includes("--showConfig")) {
        // 普通配置：自身有程序，就地 -p 检查
        return { stdout: JSON.stringify({ include: ["src"] }), exitCode: 0 };
      }
      runs.push(args);
      return { stdout: "", exitCode: 0 };
    };
    const mod = await freshModule();
    await mod.runTypeCheck(undefined, dir);
    expect(runs).toEqual([
      [
        path.join(dir, "node_modules/vue-tsc/bin/vue-tsc.js"),
        "-p",
        "tsconfig.json",
        "--noEmit",
        "--pretty",
        "false",
      ],
    ]);
  });
});

describe("runTypeChecksForFiles（批量类型检查）", () => {
  function makeBatchProject(deps: Record<string, string> = {}): string {
    return makeTsProject(deps, { typescript: { version: "6.0.3", bin: { tsc: "./bin/tsc" } } });
  }

  it("同一项目的多个文件只跑一次 --build，并把输出切分到各文件", async () => {
    const dir = makeBatchProject({ react: "^19" });
    const a = path.join(dir, "src", "a.ts");
    const b = path.join(dir, "src", "b.ts");
    let calls = 0;
    execaImpl = (_file, args, opts) => {
      calls += 1;
      expect(opts.cwd).toBe(dir);
      expect(args[0]).toBe(path.join(dir, "node_modules/typescript/bin/tsc"));
      return {
        stdout: [
          `${path.join("src", "a.ts")}(3,5): error TS2322: Type 'X' is not assignable`,
          `${path.join("src", "b.ts")}(1,2): warning TS6133: 'v' is declared but never used`,
        ].join("\n"),
        exitCode: 1,
      };
    };
    const mod = await freshModule();
    const results = await mod.runTypeChecksForFiles([a, b], dir);

    expect(calls).toBe(1);
    expect(results.size).toBe(2);
    expect(results.get(a)?.rawOutput).toContain("TS2322");
    expect(results.get(a)?.rawOutput).not.toContain("TS6133");
    expect(results.get(b)?.rawOutput).toContain("TS6133");
    expect(results.get(a)?.exitCode).toBe(1);
    expect(results.get(a)?.diagnostics).toHaveLength(1);
    expect(results.get(a)?.diagnostics![0]).toMatchObject({ file: a, source: "tsc" });
    expect(results.get(b)?.diagnostics![0]).toMatchObject({ file: b });
  });

  it("不同 tsconfig 项目的文件各跑一次", async () => {
    const dirA = makeBatchProject({ react: "^19" });
    const dirB = makeBatchProject({ react: "^19" });
    const cwds: string[] = [];
    execaImpl = (_file, _args, opts) => {
      cwds.push(opts.cwd ?? "");
      return { stdout: "", exitCode: 0 };
    };
    const mod = await freshModule();
    await mod.runTypeChecksForFiles(
      [path.join(dirA, "a.ts"), path.join(dirB, "b.ts")],
      "/fallback",
    );
    expect(cwds.sort()).toEqual([dirA, dirB].sort());
  });

  it("找不到 tsconfig 的文件回退到 cwd 项目", async () => {
    let cwdSeen = "";
    execaImpl = (_file, _args, opts) => {
      cwdSeen = opts.cwd ?? "";
      return { stdout: "", exitCode: 0 };
    };
    const mod = await freshModule();
    await mod.runTypeChecksForFiles(["/virtual/nowhere/x.ts"], "/proj");
    expect(cwdSeen).toBe("/proj");
  });
});

describe("renderDiagnostics", () => {
  it("编辑后分区按 target 分组：### 文件 + ## 分区", () => {
    const result: DiagnosticsResult = {
      sections: [
        { name: "ESLint", target: "a.ts", text: "ERROR [a.ts:1:1] boom", diagnostics: [] },
        { name: "vue-tsc", target: "a.ts", text: "a.ts(1,1): error TS1: bad", diagnostics: [] },
        { name: "ESLint", target: "b.ts", text: "WARN [b.ts:1:1] meh", diagnostics: [] },
        { name: "vue-tsc", text: "没有发现类型错误", diagnostics: [] },
      ],
    };

    expect(renderDiagnostics(result)).toBe(
      [
        "### a.ts",
        "",
        "## ESLint",
        "",
        "ERROR [a.ts:1:1] boom",
        "",
        "## vue-tsc",
        "",
        "a.ts(1,1): error TS1: bad",
        "",
        "### b.ts",
        "",
        "## ESLint",
        "",
        "WARN [b.ts:1:1] meh",
        "",
        "## vue-tsc",
        "",
        "没有发现类型错误",
      ].join("\n"),
    );
  });

  it("分区无正文时渲染占位文案", () => {
    expect(renderDiagnostics({ sections: [{ name: "ESLint", diagnostics: [] }] })).toBe(
      "## ESLint\n\n没有发现问题",
    );
  });

  it("onlyFindings:true 只输出有发现的分区，全空返回空串", () => {
    const mixed: DiagnosticsResult = {
      sections: [
        { name: "ESLint", text: "ERROR [a.ts:1:1] boom", diagnostics: [] },
        { name: "vue-tsc", text: "   ", diagnostics: [] },
        { name: "空分区", diagnostics: [] },
      ],
    };
    expect(renderDiagnostics(mixed, { onlyFindings: true })).toBe(
      "## ESLint\n\nERROR [a.ts:1:1] boom",
    );

    const none: DiagnosticsResult = {
      sections: [
        { name: "ESLint", diagnostics: [] },
        { name: "vue-tsc", text: "  ", diagnostics: [] },
      ],
    };
    expect(renderDiagnostics(none, { onlyFindings: true })).toBe("");
  });

  it("maxFindingsPerSection 折叠超限发现并带 omittedFindingsHint", () => {
    const text = Array.from(
      { length: 5 },
      (_, index) => `ERROR [a.ts:${index + 1}:1] nope${index} (r)`,
    ).join("\n");
    const result: DiagnosticsResult = { sections: [{ name: "ESLint", text, diagnostics: [] }] };

    const folded = renderDiagnostics(result, { maxFindingsPerSection: 2 });
    expect(folded).toContain("nope0");
    expect(folded).toContain("nope1");
    expect(folded).not.toContain("nope2");
    expect(folded).toContain(omittedFindingsHint(3));

    // 未超限 / 未传上限时原样输出（run_diagnostics 的完整语义不变）
    expect(renderDiagnostics(result, { maxFindingsPerSection: 5 })).toBe(`## ESLint\n\n${text}`);
    expect(renderDiagnostics(result)).toBe(`## ESLint\n\n${text}`);
    expect(renderDiagnostics(result)).not.toContain("还有");
  });

  it("真实分区：按策略默认上限（3 条）折叠并给出省略提示", async () => {
    const ws = makeProject();
    const messages = Array.from({ length: 5 }, (_, index) => ({
      severity: 2,
      line: index + 1,
      column: 1,
      message: `boom${index}`,
      ruleId: "r",
    }));
    trackExeca({ stdout: JSON.stringify([{ filePath: "a.ts", messages }]), exitCode: 1 });
    const policy = resolvePolicy({
      checks: [{ name: "Elint", command: "fake-tool", format: "eslint-json" }],
    });
    const mod = await freshModule();
    const result = await mod.runDiagnostics({ kind: "project", cwd: ws }, policy, "manual");

    expect(policy.maxFindingsPerSection).toBe(DEFAULT_MAX_FINDINGS_PER_SECTION);
    const text = renderDiagnostics(result, {
      maxFindingsPerSection: policy.maxFindingsPerSection,
    });
    expect(text).toContain("boom0");
    expect(text).not.toContain(`boom${DEFAULT_MAX_FINDINGS_PER_SECTION}`);
    expect(text).toContain(omittedFindingsHint(messages.length - DEFAULT_MAX_FINDINGS_PER_SECTION));
  });
});

describe("collectDiagnostics", () => {
  it("汇总所有分区的结构化条目", () => {
    const result: DiagnosticsResult = {
      sections: [
        {
          name: "ESLint",
          diagnostics: [
            {
              file: "a.ts",
              severity: SEVERITY_ERROR,
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              message: "e1",
              source: "ESLint",
            },
            {
              file: "b.ts",
              severity: SEVERITY_WARN,
              range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } },
              message: "w1",
              source: "ESLint",
            },
          ],
        },
        {
          name: "vue-tsc",
          diagnostics: [
            {
              file: "c.ts",
              severity: SEVERITY_ERROR,
              range: { start: { line: 2, character: 2 }, end: { line: 2, character: 2 } },
              message: "e2",
              source: "vue-tsc",
            },
          ],
        },
        { name: "空分区", diagnostics: [] },
      ],
    };

    expect(collectDiagnostics(result).map((diagnostic) => diagnostic.message)).toEqual([
      "e1",
      "w1",
      "e2",
    ]);
  });
});

describe("调度与噪音过滤", () => {
  it("多个检查并发执行：第二个进程在第一个 resolve 前已启动，输出仍按声明顺序", async () => {
    const ws = makeProject();
    const started: string[] = [];
    const release: Array<() => void> = [];
    (mockedExeca as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (file: unknown) => {
        started.push(path.basename(String(file)));
        await new Promise<void>((resolve) => release.push(resolve));
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          failed: false,
          timedOut: false,
          isTerminated: false,
          isMaxBuffer: false,
        };
      },
    );

    const mod = await freshModule();
    const policy = resolvePolicy({
      checks: [
        { name: "A", command: "cmd-a" },
        { name: "B", command: "cmd-b" },
      ],
    });
    const pending = mod.runDiagnostics({ kind: "project", cwd: ws }, policy, "manual");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 串行实现此刻只会启动 1 个进程；并发实现两个都已启动
    expect(started).toHaveLength(2);
    for (const stop of release) stop();

    const result = await pending;
    expect(result.sections.map((section) => section.name)).toEqual(["A", "B"]);
  });

  it("ESLint「不在配置范围内」的忽略提示不当作发现", async () => {
    const ws = makeProject();
    const file = path.join(ws, "a.ts");
    trackExeca({
      stdout: JSON.stringify([
        {
          filePath: file,
          messages: [
            {
              severity: 1,
              line: 1,
              column: 1,
              message: "File ignored because no matching configuration was supplied",
              ruleId: null,
            },
            { severity: 2, line: 2, column: 3, message: "boom", ruleId: "no-x" },
          ],
        },
      ]),
      exitCode: 0,
    });

    const mod = await freshModule();
    const result = await mod.runDiagnostics(
      { kind: "file", file, cwd: ws },
      resolvePolicy({
        checks: [{ name: "ESLint", command: "fake-eslint", format: "eslint-json" }],
      }),
      "manual",
    );

    expect(result.sections[0].diagnostics).toHaveLength(1);
    expect(result.sections[0].text).toContain("boom");
    expect(result.sections[0].text).not.toContain("File ignored");
  });

  it("不适用于目标文件的检查直接跳过，不报「项目里没装该工具」", async () => {
    // eslint 预设只吃源码扩展名；目标只有 .css 且项目没装 eslint → 应静默跳过而不是报未运行
    const ws = makeProject();
    const file = path.join(ws, "a.css");
    const calls = trackExeca({ stdout: "", exitCode: 0 });

    const mod = await freshModule();
    const result = await mod.runDiagnostics(
      { kind: "file", file, cwd: ws },
      resolvePolicy({ checks: [{ builtin: "eslint" }] }),
      "manual",
    );

    expect(calls).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].text).toContain("没有可运行的检查");
  });
});
