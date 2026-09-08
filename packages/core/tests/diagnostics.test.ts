/**
 * @fileoverview 诊断引擎纯逻辑单测（packages/core/src/node/diagnostics.ts，node 环境）
 *
 * 覆盖策略：
 * - 纯函数（isJsFile / DIAGNOSTICS_TOOL_DESCRIPTION / formatDiagnosticsSections）静态导入直接测；
 * - 依赖模块级缓存的函数（loadESLint 的 ESLintClass、resolveVueTscBin）每用例
 *   vi.resetModules + 动态 import 取全新模块实例；
 * - node:module（createRequire）与 node:child_process（exec）整体替换为可控 mock，
 *   禁止真实解析/执行 vue-tsc、eslint。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exec } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEVERITY_ERROR, SEVERITY_WARN } from "../src/common/constants";
import { configureLogger, LogLevel } from "../src/common/logger-core";
import {
  DIAGNOSTICS_TOOL_DESCRIPTION,
  formatDiagnosticsSections,
  isJsFile,
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

type ExecCb = (err: unknown, stdout: string, stderr: string) => void;
type ExecImpl = (cmd: string, opts: { cwd?: string }, cb: ExecCb) => void;

// --- node:module / node:child_process mock（hoisted） ---
vi.mock("node:module", () => ({ createRequire: vi.fn() }));
vi.mock("node:child_process", () => ({ exec: vi.fn() }));

const mockedCreateRequire = vi.mocked(createRequire);
const mockedExec = vi.mocked(exec);

// --- 每用例可调状态 ---
let eslintAvailable: boolean;
let eslintLintThrows: boolean;
let eslintLintImpl: (pattern: string) => Promise<FakeLintResult[]>;
let vueTscResolvable: boolean;
let execImpl: ExecImpl;

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

const fakeRequire = ((id: string) => {
  if (id === "eslint") {
    if (!eslintAvailable) throw new Error("Cannot find module 'eslint'");
    return { ESLint: FakeESLint };
  }
  throw new Error("Cannot find module '" + id + "'");
}) as unknown as NodeRequire;

fakeRequire.resolve = ((id: string) => {
  if (id === "vue-tsc/bin/vue-tsc.js") {
    if (!vueTscResolvable) throw new Error("Cannot find module 'vue-tsc/bin/vue-tsc.js'");
    return "/fake-bin/vue-tsc.js";
  }
  throw new Error("Cannot resolve '" + id + "'");
}) as unknown as NodeRequire["resolve"];

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
  vueTscResolvable = true;
  execImpl = (_cmd, _opts, cb) => cb(null, "", "");
  mockedCreateRequire.mockImplementation(() => fakeRequire);
  (mockedExec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, opts: unknown, cb: ExecCb) => {
      execImpl(cmd, opts as { cwd?: string }, cb);
    },
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
  it("documents ESLint & supported extensions and warns nothing", () => {
    expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain("运行 ESLint 与 TypeScript 类型诊断");
    expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain("*.ts *.tsx *.vue");
    expect(DIAGNOSTICS_TOOL_DESCRIPTION).toContain("*.vue");
  });
});

describe("lintFiles without resolvable eslint", () => {
  it("reports that ESLint did not run instead of pretending to be clean", async () => {
    eslintAvailable = false;
    const mod = await freshModule();
    const out = await mod.lintFiles("src/**/*.ts", "/proj/workspace");
    expect(out.diagnostics).toEqual([]);
    expect(out.text).toContain("[ESLint]");
    expect(out.text).toContain("未运行");
    expect(out.text).toContain("/proj/workspace");
  });
});

describe("lintFiles with a fake ESLint", () => {
  it("returns an empty output when there are no messages", async () => {
    const mod = await freshModule();
    const out = await mod.lintFiles("src/**/*.ts", "/proj");
    expect(out).toEqual({});
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

describe("runVueTsc", () => {
  it("returns an empty success when the vue-tsc bin cannot be resolved", async () => {
    vueTscResolvable = false;
    const mod = await freshModule();
    const result = await mod.runVueTsc(undefined, "/proj");
    expect(result).toEqual({ rawOutput: "", exitCode: 0 });
  });

  it("parses tsc diagnostics and reports the exit code in full-project mode", async () => {
    execImpl = (_cmd, opts, cb) => {
      expect(opts.cwd).toBe("/proj");
      cb(
        { code: 1 },
        "src/a.ts(3,5): error TS2322: Type 'X' is not assignable\nsrc/b.ts(1,2): warning TS6133: 'v' is declared but never used",
        "",
      );
    };
    const mod = await freshModule();
    const result = await mod.runVueTsc(undefined, "/proj");

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
    execImpl = (_cmd, _opts, cb) => cb({ code: null, killed: true }, "", "");
    const mod = await freshModule();
    const result = await mod.runVueTsc(undefined, "/proj");
    expect(result.exitCode).toBe(1);
    expect(result.rawOutput).toContain("超时");
  });
});

describe("runAllChecks", () => {
  it("runs lintFiles and runVueTsc in parallel and aggregates outputs", async () => {
    eslintLintImpl = async () => [
      {
        filePath: "/proj/x.ts",
        messages: [{ severity: 2, line: 1, column: 1, message: "lint problem", ruleId: "r" }],
      },
    ];
    execImpl = (_cmd, opts, cb) => cb({ code: 2 }, "ignored(1,1): error TS1: nope", "");
    const mod = await freshModule();
    const result = await mod.runAllChecks("/virtual/x.ts", "/proj");
    expect(result.eslintOutput.text).toContain("ERROR [/proj/x.ts:1:1] lint problem (r)");
    expect(result.tscOutput.exitCode).toBe(2);
  });
});

describe("runProjectDiagnostics", () => {
  it("builds the workspace once when a root tsconfig exists", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-diag-root-"));
    fs.writeFileSync(path.join(ws, "tsconfig.json"), "{}");
    execImpl = (_cmd, opts, cb) => {
      expect(opts.cwd).toBe(ws);
      cb({ code: 0 }, "a.ts(10,4): warning TS6133: unused var", "");
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
    execImpl = (_cmd, opts, cb) => {
      if (opts.cwd === path.join(ws, "src1")) {
        cb({ code: 1 }, "x.ts(2,2): error TS1: in src1", "");
      } else {
        cb({ code: 3 }, "y.ts(5,5): error TS2: in src2", "");
      }
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
    const text = formatDiagnosticsSections("# 报告", {}, { rawOutput: "", exitCode: 0 });
    expect(text).toBe("# 报告\n\n## ESLint\n\n没有发现问题\n\n## vue-tsc\n\n没有发现类型错误");
  });

  it("includes real engine output when present", () => {
    const text = formatDiagnosticsSections(
      "# 报告",
      { text: "ERROR [a.ts:1:1] nope (r)" },
      { rawOutput: "src/a.ts(1,1): error TS1: bad\n", exitCode: 1 },
    );
    expect(text).toContain("## ESLint");
    expect(text).toContain("ERROR [a.ts:1:1] nope (r)");
    expect(text).toContain("## vue-tsc");
    expect(text).toContain("error TS1: bad");
  });
});
