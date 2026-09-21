/**
 * @fileoverview 诊断引擎纯逻辑单测（packages/core/src/node/diagnostics.ts，node 环境）
 *
 * 覆盖策略：
 * - 纯函数（isJsFile / DIAGNOSTICS_TOOL_DESCRIPTION / formatDiagnosticsSections）静态导入直接测；
 * - 依赖模块级缓存的函数（loadESLint 的 ESLintClass、resolveVueTscBin）每用例
 *   vi.resetModules + 动态 import 取全新模块实例；
 * - node:module（createRequire）与 execa 整体替换为可控 mock，
 *   禁止真实解析/执行 vue-tsc、eslint。
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
  DIAGNOSTICS_TOOL_DESCRIPTION,
  formatDiagnosticsSections,
  isJsFile,
  omittedFindingsHint,
} from "../src/node/diagnostics";

type DiagnosticModule = typeof import("../src/node/diagnostics");

interface FakeLintMessage {
  severity: number;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  ruleId: string | null;
}

interface FakeLintResult {
  filePath: string;
  messages: FakeLintMessage[];
}

interface FakeExecaResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
  isTerminated?: boolean;
  isMaxBuffer?: boolean;
}

type ExecaImpl = (file: string, args: string[], opts: { cwd?: string }) => FakeExecaResult;

// --- node:module / execa mock（hoisted） ---
vi.mock("node:module", () => ({ createRequire: vi.fn() }));
vi.mock("execa", () => ({ execa: vi.fn() }));

const mockedCreateRequire = vi.mocked(createRequire);
const mockedExeca = vi.mocked(execa);

// --- 每用例可调状态 ---
let eslintAvailable: boolean;
let eslintLintThrows: boolean;
let eslintLintImpl: (pattern: string) => Promise<FakeLintResult[]>;
/** 本包自带的 vue-tsc 是否可解析（项目没装检查器时的兜底） */
let bundledVueTscResolvable: boolean;
let execaImpl: ExecaImpl;

class FakeESLint {
  cwd: string;
  constructor(opts: { cwd: string }) {
    this.cwd = opts.cwd;
  }
  async lintFiles(pattern: string): Promise<FakeLintResult[]> {
    if (eslintLintThrows) throw new Error("eslint exploded");
    return eslintLintImpl(pattern);
  }
}

/** 在 <root>/node_modules/<name>/package.json 写一个假包（bin / version 由用例决定） */
function writePackage(
  root: string,
  name: string,
  pkg: { version?: string; bin?: Record<string, string> },
): string {
  const pkgDir = path.join(root, "node_modules", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  const pkgJsonPath = path.join(pkgDir, "package.json");
  fs.writeFileSync(pkgJsonPath, JSON.stringify({ name, version: "1.0.0", ...pkg }));
  return pkgJsonPath;
}

/**
 * 模拟 Node 的包解析：从 createRequire 起点目录向上找 node_modules/<pkg>/package.json。
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
    if (id === "eslint") {
      if (!eslintAvailable) throw new Error("Cannot find module 'eslint'");
      return { ESLint: FakeESLint };
    }
    throw new Error("Cannot find module '" + id + "'");
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

beforeEach(() => {
  configureLogger({ level: LogLevel.NONE });
  silenceConsole();
  eslintAvailable = true;
  eslintLintThrows = false;
  eslintLintImpl = async () => [];
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
});

async function freshModule(): Promise<DiagnosticModule> {
  vi.resetModules();
  const mod = await import("../src/node/diagnostics");
  // resetModules 会重建 logger-core 实例（配置回到默认），重新静音 + 关闭日志
  silenceConsole();
  return mod;
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
  it("documents lint & type-check engines and supported extensions", () => {
    expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain(
      "运行 Lint（ESLint / oxlint）与 TypeScript 类型诊断",
    );
    expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain("*.ts *.tsx *.vue");
    expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain("*.vue");
  });
});

describe("lintFiles without resolvable engines", () => {
  it("reports that no lint engine ran instead of pretending to be clean", async () => {
    eslintAvailable = false;
    const mod = await freshModule();
    const out = await mod.lintFiles("src/**/*.ts", "/proj/workspace");
    expect(out.diagnostics).toEqual([]);
    expect(out.text).toContain("[Lint]");
    expect(out.text).toContain("未运行");
    expect(out.text).toContain("/proj/workspace");
  });
});

describe("lintFiles with a fake ESLint", () => {
  it("returns an empty output when there are no messages", async () => {
    const mod = await freshModule();
    const out = await mod.lintFiles("src/**/*.ts", "/proj");
    expect(out.engines).toEqual(["ESLint"]);
    expect(out.diagnostics).toEqual([]);
    expect(out.text).toBeUndefined();
  });

  it("formats errors and warnings and caps the warning list", async () => {
    eslintLintImpl = async () => [
      {
        filePath: "/proj/a.ts",
        messages: [
          {
            severity: 2,
            line: 4,
            column: 2,
            endLine: 6,
            endColumn: 8,
            message: "boom",
            ruleId: "no-x",
          },
        ],
      },
      {
        filePath: "/proj/b.ts",
        messages: Array.from({ length: 7 }, (_, i) => ({
          severity: 1,
          line: i + 1,
          column: 1,
          message: "warn-" + i,
          ruleId: "warn-rule",
        })),
      },
    ];
    const mod = await freshModule();
    const out = await mod.lintFiles("src/**/*.ts", "/proj");

    expect(out.text).toContain("ERROR [/proj/a.ts:4:2] boom (no-x)");
    expect(out.text).toContain("WARN [/proj/b.ts:1:1] warn-0 (warn-rule)");
    expect(out.text).toContain("... and 2 more warnings");

    expect(out.diagnostics).toHaveLength(8);
    const errorDiag = out.diagnostics![0];
    expect(errorDiag).toMatchObject({
      severity: SEVERITY_ERROR,
      file: "/proj/a.ts",
      source: "eslint",
      message: "[ESLint] boom (no-x)",
    });
    // 1-based 行列 → 0-based LSP range
    expect(errorDiag.range).toEqual({
      start: { line: 3, character: 1 },
      end: { line: 5, character: 7 },
    });

    const warnDiag = out.diagnostics!.find((d) => d.file === "/proj/b.ts");
    expect(warnDiag).toBeDefined();
    expect(warnDiag!.severity).toBe(SEVERITY_WARN);
    expect(warnDiag!.range.start).toEqual({ line: 0, character: 0 });
  });

  it("reports the failure message when the linter throws", async () => {
    eslintLintThrows = true;
    const mod = await freshModule();
    const out = await mod.lintFiles("src/**/*.ts", "/proj");
    expect(out.diagnostics).toEqual([]);
    expect(out.text).toContain("运行失败");
    expect(out.text).toContain("eslint exploded");
  });
});

describe("lintFiles with oxlint", () => {
  /** 建临时 workspace：真实 node_modules/oxlint/package.json（bin 字段指向 fake bin） */
  function makeOxlintWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-oxlint-"));
    const pkgDir = path.join(ws, "node_modules", "oxlint");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "oxlint", bin: { oxlint: "bin/oxlint" } }),
    );
    return ws;
  }

  const OXLINT_JSON = JSON.stringify({
    diagnostics: [
      {
        message: "Variable 'x' is declared but never used.",
        code: "eslint(no-unused-vars)",
        severity: "warning",
        filename: "a.js",
        labels: [{ span: { offset: 6, length: 9, line: 1, column: 7 } }],
      },
    ],
    number_of_files: 1,
  });

  it("仅 oxlint 可用时用它兜底并解析自有 JSON 格式", async () => {
    eslintAvailable = false;
    const ws = makeOxlintWorkspace();
    execaImpl = (_file, args, opts) => {
      expect(args[0]).toContain("/bin/oxlint");
      expect(args).toContain("--format=json");
      expect(opts.cwd).toBe(ws);
      return { stdout: OXLINT_JSON, exitCode: 0 };
    };
    try {
      const mod = await freshModule();
      const out = await mod.lintFiles("a.js", ws);
      expect(out.engines).toEqual(["oxlint"]);
      expect(out.text).toContain("WARN [" + path.resolve(ws, "a.js") + ":1:7]");
      expect(out.text).toContain("no-unused-vars");
      expect(out.diagnostics).toHaveLength(1);
      expect(out.diagnostics![0]).toMatchObject({
        severity: SEVERITY_WARN,
        file: path.resolve(ws, "a.js"),
        source: "oxlint",
        message: "[oxlint] Variable 'x' is declared but never used. (no-unused-vars)",
      });
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("ESLint 与 oxlint 均可用时并行互补并合并结果", async () => {
    const ws = makeOxlintWorkspace();
    eslintLintImpl = async () => [
      {
        filePath: "/proj/e.ts",
        messages: [{ severity: 2, line: 2, column: 1, message: "eslint problem", ruleId: "r" }],
      },
    ];
    execaImpl = () => ({ stdout: OXLINT_JSON, exitCode: 0 });
    try {
      const mod = await freshModule();
      const out = await mod.lintFiles("a.js", ws);
      expect(out.engines).toEqual(["ESLint", "oxlint"]);
      expect(out.text).toContain("ERROR [/proj/e.ts:2:1] eslint problem (r)");
      expect(out.text).toContain("no-unused-vars");
      expect(out.diagnostics).toHaveLength(2);
      expect(out.diagnostics!.map((d) => d.source).sort()).toEqual(["eslint", "oxlint"]);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("容忍 stdout 混入人类可读前缀消息（截取 JSON 主体解析）", async () => {
    eslintAvailable = false;
    const ws = makeOxlintWorkspace();
    execaImpl = () => ({ stdout: `No files found to lint.\n${OXLINT_JSON}\n`, exitCode: 0 });
    try {
      const mod = await freshModule();
      const out = await mod.lintFiles("a.js", ws);
      expect(out.diagnostics).toHaveLength(1);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("JSON 完全不可解析时明确报 oxlint 运行失败", async () => {
    eslintAvailable = false;
    const ws = makeOxlintWorkspace();
    execaImpl = () => ({ stdout: "not json at all", exitCode: 1 });
    try {
      const mod = await freshModule();
      const out = await mod.lintFiles("a.js", ws);
      expect(out.engines).toEqual(["oxlint"]);
      expect(out.text).toContain("[oxlint] 运行失败");
      expect(out.diagnostics).toEqual([]);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
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
  /** 建临时项目目录：package.json + tsconfig.json，可预装假检查器（bin / TS 版本可控） */
  function makeProject(
    deps: Record<string, string>,
    packages: Record<string, { version?: string; bin?: Record<string, string> }> = {},
  ): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-engine-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "probe", dependencies: deps }),
    );
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    for (const [name, pkg] of Object.entries(packages)) writePackage(dir, name, pkg);
    return dir;
  }

  const WORKSPACE_TSC = { typescript: { version: "6.0.3", bin: { tsc: "./bin/tsc" } } };
  const WORKSPACE_VUE_TSC = {
    "vue-tsc": { version: "3.3.11", bin: { "vue-tsc": "./bin/vue-tsc.js" } },
  };

  it("非 Vue 项目用项目自身的 tsc（版本与项目一致）", async () => {
    const dir = makeProject({ react: "^19" }, WORKSPACE_TSC);
    let ranArgs: string[] = [];
    execaImpl = (_file, args, opts) => {
      ranArgs = args;
      expect(opts.cwd).toBe(dir);
      return { stdout: "a.ts(1,1): error TS1: boom", exitCode: 1 };
    };
    try {
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
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Vue 项目优先项目自身的 vue-tsc，而不是本包自带的", async () => {
    const dir = makeProject({ vue: "^3.5" }, { ...WORKSPACE_VUE_TSC, ...WORKSPACE_TSC });
    let ranBin = "";
    execaImpl = (_file, args) => {
      ranBin = args[0];
      return { exitCode: 0 };
    };
    try {
      const mod = await freshModule();
      const result = await mod.runTypeCheck(undefined, dir);
      expect(ranBin).toBe(path.join(dir, "node_modules/vue-tsc/bin/vue-tsc.js"));
      expect(result.source).toBe("vue-tsc");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Vue 项目没装 vue-tsc 时回落本包自带", async () => {
    const dir = makeProject({ vue: "^3.5" }, WORKSPACE_TSC);
    let ranBin = "";
    execaImpl = (_file, args) => {
      ranBin = args[0];
      return { exitCode: 0 };
    };
    try {
      const mod = await freshModule();
      const result = await mod.runTypeCheck(undefined, dir);
      expect(ranBin).toContain("vue-tsc");
      expect(ranBin.startsWith(dir)).toBe(false);
      expect(result.source).toBe("vue-tsc");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非 Vue 项目没装 tsc 但装了 vue-tsc 时用项目的 vue-tsc", async () => {
    const dir = makeProject({ react: "^19" }, WORKSPACE_VUE_TSC);
    let ranBin = "";
    execaImpl = (_file, args) => {
      ranBin = args[0];
      return { exitCode: 0 };
    };
    try {
      const mod = await freshModule();
      const result = await mod.runTypeCheck(undefined, dir);
      expect(ranBin).toBe(path.join(dir, "node_modules/vue-tsc/bin/vue-tsc.js"));
      expect(result.source).toBe("vue-tsc");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("老版本 TS（< 5.6）不支持 --build --noEmit：逐项目 -p 并按 references 展开", async () => {
    const dir = makeProject(
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
    try {
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
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TS 版本解析不到时用最保守的 -p 模式（不吃 TS5094）", async () => {
    // 装了 vue-tsc 但解析不出它背后的 typescript 版本（如软链安装、NODE_PATH 干扰）
    const dir = makeProject(
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
    try {
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
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runAllChecks", () => {
  it("runs lintFiles and type-check in parallel and aggregates outputs", async () => {
    eslintLintImpl = async () => [
      {
        filePath: "/proj/x.ts",
        messages: [{ severity: 2, line: 1, column: 1, message: "lint problem", ruleId: "r" }],
      },
    ];
    execaImpl = () => ({ stdout: "ignored(1,1): error TS1: nope", exitCode: 2 });
    const mod = await freshModule();
    const result = await mod.runAllChecks("/virtual/x.ts", "/proj");
    expect(result.eslintOutput.text).toContain("ERROR [/proj/x.ts:1:1] lint problem (r)");
    expect(result.tscOutput.exitCode).toBe(2);
  });
});

describe("runTypeChecksForFiles（批量类型检查）", () => {
  /** 建临时项目目录：package.json + tsconfig.json + 项目自身的 tsc */
  function makeProject(deps: Record<string, string> = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-batch-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "probe", dependencies: deps }),
    );
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    writePackage(dir, "typescript", { version: "6.0.3", bin: { tsc: "./bin/tsc" } });
    return dir;
  }

  it("同一项目的多个文件只跑一次 --build，并把输出切分到各文件", async () => {
    const dir = makeProject({ react: "^19" });
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
    try {
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
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("不同 tsconfig 项目的文件各跑一次", async () => {
    const dirA = makeProject({ react: "^19" });
    const dirB = makeProject({ react: "^19" });
    const cwds: string[] = [];
    execaImpl = (_file, _args, opts) => {
      cwds.push(opts.cwd ?? "");
      return { stdout: "", exitCode: 0 };
    };
    try {
      const mod = await freshModule();
      await mod.runTypeChecksForFiles(
        [path.join(dirA, "a.ts"), path.join(dirB, "b.ts")],
        "/fallback",
      );
      expect(cwds.sort()).toEqual([dirA, dirB].sort());
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
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

describe("runAllChecksForFiles（批量 lint + 类型检查）", () => {
  it("返回每个文件的 lint 与类型检查结果，类型检查只跑一次", async () => {
    eslintLintImpl = async (pattern) =>
      pattern.endsWith("a.ts")
        ? [
            {
              filePath: pattern,
              messages: [{ severity: 2, line: 1, column: 1, message: "lint-a", ruleId: "r" }],
            },
          ]
        : [];
    let tscCalls = 0;
    execaImpl = () => {
      tscCalls += 1;
      return { stdout: "/proj/a.ts(2,3): error TS1: boom", exitCode: 1 };
    };
    const mod = await freshModule();
    const results = await mod.runAllChecksForFiles(
      ["/proj/a.ts", "/proj/b.ts", "/proj/a.ts"],
      "/proj",
    );

    expect(tscCalls).toBe(1);
    // 重复输入去重，保持首次出现的顺序
    expect([...results.keys()]).toEqual(["/proj/a.ts", "/proj/b.ts"]);
    expect(results.get("/proj/a.ts")?.eslintOutput.text).toContain("lint-a");
    expect(results.get("/proj/a.ts")?.tscOutput.rawOutput).toContain("TS1");
    expect(results.get("/proj/b.ts")?.eslintOutput.text).toBeUndefined();
    expect(results.get("/proj/b.ts")?.tscOutput.rawOutput).toBe("");
  });
});

describe("runProjectDiagnostics", () => {
  it("builds the workspace once when a root tsconfig exists", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-diag-root-"));
    fs.writeFileSync(path.join(ws, "tsconfig.json"), "{}");
    execaImpl = (_file, _args, opts) => {
      expect(opts.cwd).toBe(ws);
      return { stdout: "a.ts(10,4): warning TS6133: unused var", exitCode: 0 };
    };
    try {
      const mod = await freshModule();
      const result = await mod.runProjectDiagnostics(ws);
      expect(result.tscOutput.exitCode).toBe(0);
      expect(result.tscOutput.diagnostics).toHaveLength(1);
      expect(result.tscOutput.diagnostics![0].file).toBe(path.resolve(ws, "a.ts"));
      expect(result.tscOutput.diagnostics![0].message).toBe("[TS6133] unused var");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("walks tsconfig subdirectories and skips node_modules / dot dirs", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-diag-walk-"));
    fs.mkdirSync(path.join(ws, "src1"), { recursive: true });
    fs.mkdirSync(path.join(ws, "src2"), { recursive: true });
    fs.mkdirSync(path.join(ws, "src3"), { recursive: true });
    fs.mkdirSync(path.join(ws, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src1", "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(ws, "src2", "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(ws, "node_modules", "pkg", "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(ws, ".hidden", "tsconfig.json"), "{}");
    execaImpl = (_file, _args, opts) => {
      if (opts.cwd === path.join(ws, "src1")) {
        return { stdout: "x.ts(2,2): error TS1: in src1", exitCode: 1 };
      }
      return { stdout: "y.ts(5,5): error TS2: in src2", exitCode: 3 };
    };
    try {
      const mod = await freshModule();
      const result = await mod.runProjectDiagnostics(ws);
      expect(result.tscOutput.exitCode).toBe(3);
      expect(result.tscOutput.diagnostics).toHaveLength(2);
      const files = result.tscOutput.diagnostics!.map((d) => d.file).sort();
      expect(files).toEqual([path.join(ws, "src1", "x.ts"), path.join(ws, "src2", "y.ts")].sort());
      expect(result.tscOutput.rawOutput).toContain("in src1");
      expect(result.tscOutput.rawOutput).toContain("in src2");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("formatDiagnosticsSections", () => {
  it("renders placeholders when both engines report nothing", () => {
    const text = formatDiagnosticsSections(
      "# 报告",
      {},
      { rawOutput: "", exitCode: 0, source: "vue-tsc" },
    );
    expect(text).toBe("# 报告\n\n## ESLint\n\n没有发现问题\n\n## vue-tsc\n\n没有发现类型错误");
  });

  it("includes real engine output when present", () => {
    const text = formatDiagnosticsSections(
      "# 报告",
      { text: "ERROR [a.ts:1:1] nope (r)" },
      { rawOutput: "src/a.ts(1,1): error TS1: bad\n", exitCode: 1, source: "vue-tsc" },
    );
    expect(text).toContain("## ESLint");
    expect(text).toContain("ERROR [a.ts:1:1] nope (r)");
    expect(text).toContain("## vue-tsc");
    expect(text).toContain("error TS1: bad");
  });

  it("follows the actual engine (tsc) for the section title", () => {
    const text = formatDiagnosticsSections(
      "# 报告",
      {},
      {
        rawOutput: "a.ts(1,1): error TS1: bad",
        exitCode: 1,
        source: "tsc",
      },
    );
    expect(text).toContain("## tsc");
    expect(text).not.toContain("vue-tsc");
  });

  it("follows the actual lint engines for the section title", () => {
    const text = formatDiagnosticsSections(
      "# 报告",
      { engines: ["ESLint", "oxlint"] },
      { rawOutput: "", exitCode: 0, source: "tsc" },
    );
    expect(text).toContain("## ESLint + oxlint");
  });

  it("onlyFindings 只输出有发现的分区，不刷占位文案", () => {
    const onlyLint = formatDiagnosticsSections(
      "# 报告",
      { text: "ERROR [a.ts:1:1] nope (r)" },
      { rawOutput: "", exitCode: 0, source: "vue-tsc" },
      { onlyFindings: true },
    );
    expect(onlyLint).toBe("# 报告\n\n## ESLint\n\nERROR [a.ts:1:1] nope (r)");
    expect(onlyLint).not.toContain("没有发现类型错误");

    const onlyTsc = formatDiagnosticsSections(
      "# 报告",
      {},
      { rawOutput: "src/a.ts(1,1): error TS1: bad", exitCode: 1, source: "tsc" },
      { onlyFindings: true },
    );
    expect(onlyTsc).toContain("## tsc");
    expect(onlyTsc).not.toContain("没有发现问题");
  });

  it("onlyFindings 且两侧都为空时返回空串；title 为空时直接返回正文", () => {
    const none = formatDiagnosticsSections(
      "# 报告",
      {},
      { rawOutput: "", exitCode: 0, source: "tsc" },
      { onlyFindings: true },
    );
    expect(none).toBe("");

    const untitled = formatDiagnosticsSections(
      "",
      { text: "WARN [a.ts:1:1] meh (r)" },
      { rawOutput: "", exitCode: 0, source: "tsc" },
      { onlyFindings: true },
    );
    expect(untitled).toBe("## ESLint\n\nWARN [a.ts:1:1] meh (r)");
  });

  it("maxFindingsPerSection 逐分区折叠超限发现并给出省略提示", () => {
    const lintLines = Array.from(
      { length: 5 },
      (_, i) => `ERROR [a.ts:${i + 1}:1] nope${i} (r)`,
    ).join("\n");
    const tscLines = [
      "a.ts(1,1): error TS1: bad",
      "a.ts(2,1): error TS2: bad",
      "a.ts(3,1): error TS3: bad",
    ].join("\n");

    const text = formatDiagnosticsSections(
      "# 报告",
      { text: lintLines },
      { rawOutput: tscLines, exitCode: 1, source: "tsc" },
      { onlyFindings: true, maxFindingsPerSection: 2 },
    );

    expect(text).toContain("nope0");
    expect(text).toContain("nope1");
    expect(text).not.toContain("nope2");
    expect(text).toContain(omittedFindingsHint(3));
    expect(text).toContain("error TS2: bad");
    expect(text).not.toContain("error TS3: bad");
    expect(text).toContain(omittedFindingsHint(1));
  });

  it("未传上限或未超限时输出原样：run_diagnostics 的完整语义不变", () => {
    const lintBody = "ERROR [a.ts:1:1] nope (r)";
    const tsc = { rawOutput: "", exitCode: 0, source: "tsc" };

    const noLimit = formatDiagnosticsSections("# 报告", { text: lintBody }, tsc, {
      onlyFindings: true,
    });
    expect(noLimit).toBe(`# 报告\n\n## ESLint\n\n${lintBody}`);

    const underLimit = formatDiagnosticsSections("# 报告", { text: lintBody }, tsc, {
      onlyFindings: true,
      maxFindingsPerSection: 3,
    });
    expect(underLimit).toBe(noLimit);
    expect(underLimit).not.toContain("还有");
  });
});
