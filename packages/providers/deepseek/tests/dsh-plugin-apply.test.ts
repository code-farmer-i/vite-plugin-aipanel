/**
 * dsh-plugin 宿主插件 apply()（run_diagnostics 工具 / 编辑后自动诊断 / 节点上下文注入）单元测试。
 *
 * 覆盖目标：
 *   - 诊断策略闸门（diagnostics.exposeTool 与 diagnostics.auto 相互独立）：
 *     exposeTool 决定 run_diagnostics 工具是否注册，auto 决定 post-execute 登记与 pre-step 收尾钩子；
 *   - run_diagnostics 工具定义与 execute 分支：全量诊断、单文件不存在报错、单文件诊断、
 *     分区空文本兜底、LSP 零基坐标 → 1-based 归一化（引擎入口 runDiagnostics(target, policy, "manual")）；
 *   - tools/post-execute 自动诊断登记：非写工具/失败结果/非 accept 决策不登记，登记阶段不跑检查
 *     （检查推迟到 step 边界）；不按扩展名过滤（.css 也登记，跑不跑由各 check 的 extensions 决定）；
 *   - agent/pre-step 收尾诊断：对本步编辑过的文件统一诊断一次（runDiagnostics + phase "edit"），
 *     发现未变也每步插入一条 notice 形式、kind 为 aipanel 的上下文消息；
 *     预算由策略控制：maxFindingsPerSection 透传 renderDiagnostics、maxMessageChars 截断注入文本；
 *   - agent/pre-step 节点上下文注入：按 @节点[id] 反查、追加本插件上下文消息、注入后清空端点。
 *
 * Stub 策略：跑在最小 ctx 桩上（tools/on/get/effect），只 mock @aipanel/core/node 的引擎入口
 * runDiagnostics（分区由用例直接给）；renderDiagnostics / collectDiagnostics 走真实实现
 * （分区与 `### 文件` 折叠结构是被测契约）；日志面同样 vi.mock 隔离，端点用
 * vi.stubGlobal('fetch') 承载；协议路径/严重度/摘要常量引用 @aipanel/core(-/node) 单一来源。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DIAGNOSTICS_POLICY,
  DIAGNOSTICS_TOOL_DESCRIPTION,
  SEVERITY_ERROR,
  omittedFindingsHint,
  type DiagnosticItem,
  type DiagnosticsResult,
  type DiagnosticsSection,
} from "@aipanel/core/node";
import { apply } from "../dsh-plugin/src/index";

const mocks = vi.hoisted(() => ({
  runDiagnostics: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@aipanel/core/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aipanel/core/node")>();
  return {
    ...actual,
    // 只替换引擎入口：分区由用例给定；渲染/折叠/条目汇总走真实实现
    runDiagnostics: mocks.runDiagnostics,
    createLogger: () => ({
      debug: mocks.logDebug,
      info: vi.fn(),
      warn: mocks.logWarn,
      error: mocks.logError,
    }),
  };
});

type PluginCtx = Parameters<typeof apply>[0];
type PluginConfig = Parameters<typeof apply>[1];
type OnHandler = (...args: unknown[]) => unknown;

/** 最小 ctx 桩：按事件名收集监听器（同名可多个，保留注册顺序） */
function createCtx() {
  const handlers = new Map<string, OnHandler[]>();
  const tools = { register: vi.fn() };
  const on = vi.fn((name: string, handler: OnHandler) => {
    const list = handlers.get(name) ?? [];
    list.push(handler);
    handlers.set(name, list);
  });
  const get = vi.fn(() => undefined);
  return { ctx: { tools, on, get, effect: vi.fn() } as unknown as PluginCtx, tools, handlers, on };
}

/** run_diagnostics 工具的可调用面（自 apply 注册的 ToolDefinition 上取） */
interface DiagnosticsTool {
  name: string;
  description: string;
  execute: (args?: unknown) => Promise<{
    title: string;
    sections: { title: string; text: string }[];
    diagnostics: {
      file: string;
      line: number;
      column: number;
      severity: string;
      message: string;
    }[];
  }>;
}

const registeredTool = (register: ReturnType<typeof vi.fn>): DiagnosticsTool =>
  register.mock.calls[0][0] as unknown as DiagnosticsTool;

const handlerOf = (handlers: Map<string, OnHandler[]>, name: string) =>
  handlers.get(name)?.slice(-1)[0] as OnHandler;

/** plugin 上下文消息：诊断以 notice 形式插入（source 带 form + summary） */
interface PluginMessage {
  source?: { kind: string; plugin?: string; form?: string; summary?: string };
  content?: { type: string; text: string }[];
}

/** tools/post-execute：只登记编辑目标，不改工具结果 content */
type PostExec = (
  exec: unknown,
  result: unknown,
  next: () => Promise<{ kind: string; content?: unknown[] }>,
) => Promise<{ kind: string; content?: unknown[] }>;

/** agent/pre-step：收尾诊断把消息追加进 decision.messages */
type PreStep = (
  payload: {
    agent?: unknown;
    messages?: unknown[];
    turn?: number;
    step?: number;
    signal?: AbortSignal;
  },
  next: () => Promise<{ kind: string; messages: unknown[] }>,
) => Promise<{ kind: string; messages: PluginMessage[] }>;

/** 诊断分区桩：text 缺省 = 该分区无发现（onlyFindings 下被渲染层过滤）；target = 编辑后按文件拆分 */
function section(
  name: string,
  text?: string,
  target?: string,
  diagnostics: DiagnosticItem[] = [],
): DiagnosticsSection {
  return { name, ...(target ? { target } : {}), ...(text ? { text } : {}), diagnostics };
}

/** 引擎入口桩：直接给出分区结果（renderDiagnostics 走真实实现） */
const stubEngine = (sections: DiagnosticsSection[]) =>
  mocks.runDiagnostics.mockResolvedValue({ sections } satisfies DiagnosticsResult);

beforeEach(() => {
  // 默认无发现：未显式 stub 的用例也不会误触发渲染/截断
  stubEngine([]);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("apply: 诊断策略闸门（exposeTool / auto 相互独立）", () => {
  it("默认策略：注册 run_diagnostics 工具，并挂自动诊断的登记与收尾钩子", () => {
    const { ctx, tools, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj" });

    expect(tools.register).toHaveBeenCalledTimes(1);
    const tool = registeredTool(tools.register);
    expect(tool.name).toBe("run_diagnostics");
    expect(tool.description).toBe(DIAGNOSTICS_TOOL_DESCRIPTION);
    expect(handlers.has("tools/post-execute")).toBe(true);
    expect(handlers.has("agent/pre-step")).toBe(true);
  });

  it("exposeTool:false + auto:true：不注册工具，但仍装登记与收尾钩子", () => {
    const { ctx, tools, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", diagnostics: { exposeTool: false } });

    expect(tools.register).not.toHaveBeenCalled();
    expect(handlers.has("tools/post-execute")).toBe(true);
    expect(handlers.has("agent/pre-step")).toBe(true);
  });

  it("auto:false + exposeTool 缺省（true）：不装钩子，但工具仍注册", () => {
    const { ctx, tools, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", diagnostics: { auto: false } });

    expect(tools.register).toHaveBeenCalledTimes(1);
    expect(registeredTool(tools.register).name).toBe("run_diagnostics");
    expect(handlers.has("tools/post-execute")).toBe(false);
    expect(handlers.has("agent/pre-step")).toBe(false);
  });

  it("exposeTool:false + auto:false：既不注册工具也不装钩子", () => {
    const { ctx, tools, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", diagnostics: { exposeTool: false, auto: false } });

    expect(tools.register).not.toHaveBeenCalled();
    expect(handlers.has("tools/post-execute")).toBe(false);
    expect(handlers.has("agent/pre-step")).toBe(false);
  });
});

describe("apply: run_diagnostics execute 分支", () => {
  function setup(cwd: string) {
    const { ctx, tools } = createCtx();
    apply(ctx, { cwd });
    return registeredTool(tools.register);
  }

  it("无 filePath 时全量诊断，空分区回退文案，LSP 零基坐标归一化为 1-based", async () => {
    stubEngine([
      section("ESLint", "eslint text", undefined, [
        {
          file: "/work/proj/a.ts",
          range: { start: { line: 4, character: 9 }, end: { line: 4, character: 12 } },
          severity: SEVERITY_ERROR,
          message: "unexpected any",
          source: "eslint",
        },
        {
          file: "/work/proj/b.ts",
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          severity: 2,
          message: "unused",
          source: "eslint",
        },
      ]),
      section("vue-tsc"),
    ]);
    const tool = setup("/work/proj");

    const result = await tool.execute({});
    expect(mocks.runDiagnostics).toHaveBeenCalledWith(
      { kind: "project", cwd: "/work/proj" },
      expect.objectContaining(DEFAULT_DIAGNOSTICS_POLICY),
      "manual",
    );
    expect(result.title).toBe("全量诊断结果");
    expect(result.sections).toEqual([
      { title: "ESLint", text: "eslint text" },
      { title: "vue-tsc", text: "没有发现问题" },
    ]);
    expect(result.diagnostics[0]).toEqual({
      file: "/work/proj/a.ts",
      line: 5,
      column: 10,
      severity: "error",
      message: "unexpected any",
    });
    expect(result.diagnostics[1]).toMatchObject({ line: 1, column: 1, severity: "warning" });
  });

  it("单文件不存在时抛错并带解析后的绝对路径，且不进入诊断引擎", async () => {
    const tool = setup("/work/proj");
    await expect(tool.execute({ filePath: "missing.ts" })).rejects.toThrow(
      path.resolve("/work/proj", "missing.ts"),
    );
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();
  });

  it("单文件存在时按相对路径命名标题并以 file/manual 目标调用 runDiagnostics", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-dsh-plugin-"));
    try {
      const file = path.join(cwd, "src", "a.ts");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "export const a = 1;\n");
      stubEngine([section("ESLint"), section("vue-tsc", "tsc text")]);
      const tool = setup(cwd);

      const result = await tool.execute({ filePath: "src/a.ts" });
      expect(mocks.runDiagnostics).toHaveBeenCalledWith(
        { kind: "file", file, cwd },
        expect.objectContaining(DEFAULT_DIAGNOSTICS_POLICY),
        "manual",
      );
      expect(result.title).toBe(`诊断结果: ${path.join("src", "a.ts")}`);
      expect(result.sections).toEqual([
        { title: "ESLint", text: "没有发现问题" },
        { title: "vue-tsc", text: "tsc text" },
      ]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("apply: tools/post-execute 自动诊断登记", () => {
  function setup(config: Partial<PluginConfig> = {}) {
    const { ctx, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", ...config } as PluginConfig);
    return {
      post: handlerOf(handlers, "tools/post-execute") as unknown as PostExec,
      pre: handlerOf(handlers, "agent/pre-step") as unknown as PreStep,
    };
  }

  const agent = {};
  const exec = (overrides: Record<string, unknown> = {}) => ({
    name: "write",
    arguments: { file_path: "src/a.ts" },
    agent,
    ...overrides,
  });
  const okResult = () => ({ isError: false, content: [{ type: "text", text: "原始输出" }] });
  const acceptNext = async () => ({ kind: "accept" as const });
  const runStep = (pre: PreStep) =>
    pre({ agent, messages: [], turn: 1, step: 2 }, async () => ({
      kind: "accept",
      messages: [],
    }));

  it("登记阶段不跑检查、不改工具结果 content", async () => {
    const { post } = setup();

    const result = okResult();
    const decision = await post(exec(), result, acceptNext);

    expect(decision).toEqual({ kind: "accept" });
    expect(result.content).toEqual([{ type: "text", text: "原始输出" }]);
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();
  });

  it("跳过：非写工具 / 工具失败 / 非 accept 决策（都不登记，step 边界不诊断）", async () => {
    const { post, pre } = setup();

    await post(exec({ name: "read" }), okResult(), acceptNext);
    await post(exec(), { isError: true, content: [] }, acceptNext);
    await post(exec(), okResult(), async () => ({ kind: "reject" }));

    const decision = await runStep(pre);
    expect(decision.messages).toEqual([]);
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();
  });

  it("不按扩展名过滤：非 JS 文件（.css）同样登记，跑不跑由各 check 的 extensions 决定", async () => {
    stubEngine([section("Stylelint", "css text", "src/style.css")]);
    const { post, pre } = setup();

    await post(exec({ arguments: { file_path: "src/style.css" } }), okResult(), acceptNext);
    const decision = await runStep(pre);

    expect(mocks.runDiagnostics).toHaveBeenCalledWith(
      {
        kind: "edited",
        files: [path.resolve("/work/proj", "src/style.css")],
        cwd: "/work/proj",
      },
      expect.objectContaining({ auto: true }),
      "edit",
    );
    expect(decision.messages).toHaveLength(1);
    expect(decision.messages[0]?.content?.[0]?.text).toContain("src/style.css");
  });

  it("兼容 camelCase filePath 登记", async () => {
    stubEngine([section("ESLint", "E", "src/camel.ts")]);
    const { post, pre } = setup();

    await post(
      { name: "write", arguments: { filePath: "src/camel.ts" }, agent },
      okResult(),
      acceptNext,
    );
    const decision = await runStep(pre);
    expect(mocks.runDiagnostics).toHaveBeenCalledWith(
      {
        kind: "edited",
        files: [path.resolve("/work/proj", "src/camel.ts")],
        cwd: "/work/proj",
      },
      expect.objectContaining({ auto: true }),
      "edit",
    );
    expect(decision.messages).toHaveLength(1);
  });
});

describe("apply: agent/pre-step 收尾诊断（每步投递摘要 + 聚合）", () => {
  const agent = {};
  const otherAgent = {};

  function setup(config: Partial<PluginConfig> = {}) {
    const { ctx, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", ...config } as PluginConfig);
    return {
      post: handlerOf(handlers, "tools/post-execute") as unknown as PostExec,
      pre: handlerOf(handlers, "agent/pre-step") as unknown as PreStep,
    };
  }

  const exec = (filePath: string, overrides: Record<string, unknown> = {}) => ({
    name: "write",
    arguments: { file_path: filePath },
    agent,
    ...overrides,
  });
  const okResult = () => ({ isError: false, content: [] });
  const acceptNext = async () => ({ kind: "accept" as const });
  const flush = (pre: PreStep, target: unknown = agent) =>
    pre({ agent: target, messages: [], turn: 1, step: 2 }, async () => ({
      kind: "accept",
      messages: [],
    }));
  /** 收尾诊断的目标断言：登记的相对路径一律解析成绝对路径、按登记顺序去重 */
  const edited = (files: string[]) => ({
    kind: "edited",
    files: files.map((file) => path.resolve("/work/proj", file)),
    cwd: "/work/proj",
  });

  it("本步编辑过的文件批量检查一次，聚合成一条 notice 上下文消息并清空登记", async () => {
    stubEngine([
      section("ESLint", "E-msg", "src/a.ts"),
      section("ESLint", "E-msg", "src/b.vue"),
      section("vue-tsc", undefined, "src/a.ts"),
    ]);
    const { post, pre } = setup();

    await post(exec("src/a.ts"), okResult(), acceptNext);
    await post(exec("src/b.vue"), okResult(), acceptNext);
    // 同文件重复编辑只登记一次
    await post(exec("src/a.ts"), okResult(), acceptNext);

    const decision = await flush(pre);
    expect(mocks.runDiagnostics).toHaveBeenCalledTimes(1);
    expect(mocks.runDiagnostics).toHaveBeenCalledWith(
      edited(["src/a.ts", "src/b.vue"]),
      expect.objectContaining({ auto: true, exposeTool: true }),
      "edit",
    );
    expect(decision.messages).toHaveLength(1);
    const message = decision.messages[0];
    expect(message?.source).toEqual({
      kind: "aipanel",
      form: "notice",
      summary: "编辑后自动诊断：2 个文件",
    });
    expect(message?.content?.[0]?.text).toContain("### src/a.ts");
    expect(message?.content?.[0]?.text).toContain("### src/b.vue");
    expect(message?.content?.[0]?.text).toContain("E-msg");
    // 只有 ESLint 有发现：不再附带空分区（无发现的分区不刷占位噪音）
    expect(message?.content?.[0]?.text).toContain("## ESLint");
    expect(message?.content?.[0]?.text).not.toContain("没有发现类型错误");

    // 登记已清空：再次收尾不重复诊断也不追加消息
    const again = await flush(pre);
    expect(mocks.runDiagnostics).toHaveBeenCalledTimes(1);
    expect(again.messages).toEqual([]);
  });

  it("诊断内容未变也每个 step 投递：不再让'仍未修复'与'已修好'同为静默", async () => {
    stubEngine([section("ESLint", "E1", "src/a.ts")]);
    const { post, pre } = setup();

    await post(exec("src/a.ts"), okResult(), acceptNext);
    const first = await flush(pre);
    expect(first.messages).toHaveLength(1);

    // 同一诊断内容：照旧投递（指纹去重时代这里是 []）
    stubEngine([section("ESLint", "E1", "src/a.ts")]);
    await post(exec("src/a.ts"), okResult(), acceptNext);
    const unchanged = await flush(pre);
    expect(unchanged.messages).toHaveLength(1);
    expect(unchanged.messages[0]?.content?.[0]?.text).toContain("E1");

    stubEngine([section("ESLint", "E2", "src/a.ts")]);
    await post(exec("src/a.ts"), okResult(), acceptNext);
    const changed = await flush(pre);
    expect(changed.messages[0]?.content?.[0]?.text).toContain("E2");
  });

  it("每个文件分区折叠成有界摘要：默认上限 3 条 + 省略提示", async () => {
    const findings = Array.from(
      { length: 30 },
      (_, i) => `ERROR [big.ts:${i + 1}:7] 'unusedBig${i}' is assigned a value but never used. (r)`,
    );
    stubEngine([section("ESLint", findings.join("\n"), "src/big.ts")]);
    const { post, pre } = setup();

    await post(exec("src/big.ts"), okResult(), acceptNext);
    const text = (await flush(pre)).messages[0]?.content?.[0]?.text ?? "";

    // 只列前 3 条 + 省略 27 条的提示（条数上限是摘要成本的控制点）
    expect(text).toContain("big.ts:3:7");
    expect(text).not.toContain("big.ts:4:7");
    expect(text).toContain(omittedFindingsHint(27));
    // 摘要形态不依赖 4000 字符硬截断
    expect(text).not.toContain("已截断");
  });

  it("预算由策略控制：maxFindingsPerSection 透传 renderDiagnostics，maxMessageChars 截断注入文本", async () => {
    const findings = Array.from(
      { length: 30 },
      (_, i) => `ERROR [big.ts:${i + 1}:7] 第 ${i + 1} 条发现`,
    );
    stubEngine([section("ESLint", findings.join("\n"), "src/big.ts")]);
    // 条数上限 5：只列 5 条、剩余 25 条折叠
    const wide = setup({ diagnostics: { maxFindingsPerSection: 5 } });
    await wide.post(exec("src/big.ts"), okResult(), acceptNext);
    const wideText = (await flush(wide.pre)).messages[0]?.content?.[0]?.text ?? "";
    expect(wideText).toContain("big.ts:5:7");
    expect(wideText).not.toContain("big.ts:6:7");
    expect(wideText).toContain(omittedFindingsHint(25));
    expect(mocks.runDiagnostics).toHaveBeenLastCalledWith(
      edited(["src/big.ts"]),
      expect.objectContaining({ maxFindingsPerSection: 5 }),
      "edit",
    );

    // 字符上限 30：正文超限即截断并附"可调用 run_diagnostics"说明
    stubEngine([section("ESLint", "E".repeat(200), "src/a.ts")]);
    const narrow = setup({ diagnostics: { maxMessageChars: 30 } });
    await narrow.post(exec("src/a.ts"), okResult(), acceptNext);
    const narrowText = (await flush(narrow.pre)).messages[0]?.content?.[0]?.text ?? "";
    expect(narrowText).toContain("已截断");
    expect(narrowText).toContain("run_diagnostics");
    expect(narrowText.length).toBeLessThan(200);
  });

  it("已修好不投递；再次出错重新投递", async () => {
    stubEngine([section("ESLint", "E", "src/a.ts")]);
    const { post, pre } = setup();

    await post(exec("src/a.ts"), okResult(), acceptNext);
    expect((await flush(pre)).messages).toHaveLength(1);

    // 空结果：没有发现就不投递（占位噪音不刷）
    stubEngine([]);
    await post(exec("src/a.ts"), okResult(), acceptNext);
    expect((await flush(pre)).messages).toEqual([]);

    // 同样的诊断再次出现：照旧投递
    stubEngine([section("ESLint", "E", "src/a.ts")]);
    await post(exec("src/a.ts"), okResult(), acceptNext);
    expect((await flush(pre)).messages).toHaveLength(1);
  });

  it("PTC 子调度与原生编辑共用登记表：同一 step 内一次批量检查", async () => {
    stubEngine([section("ESLint", "E", "src/native.ts"), section("ESLint", "E", "src/ptc.ts")]);
    const { post, pre } = setup();

    await post(exec("src/native.ts"), okResult(), acceptNext);
    await post(
      exec("src/ptc.ts", { parent: "run_code", rootCallId: "root-1" }),
      okResult(),
      acceptNext,
    );

    const decision = await flush(pre);
    expect(mocks.runDiagnostics).toHaveBeenCalledTimes(1);
    expect(mocks.runDiagnostics).toHaveBeenCalledWith(
      edited(["src/native.ts", "src/ptc.ts"]),
      expect.objectContaining({ auto: true }),
      "edit",
    );
    const text = decision.messages[0]?.content?.[0]?.text ?? "";
    expect(text).toContain("src/native.ts");
    expect(text).toContain("src/ptc.ts");
  });

  it("引擎整体失败时降级：不投递也不抛错", async () => {
    mocks.runDiagnostics.mockRejectedValue(new Error("boom"));
    const { post, pre } = setup();

    await post(exec("src/a.ts"), okResult(), acceptNext);
    const decision = await flush(pre);
    expect(decision.messages).toEqual([]);
  });

  it("引擎只返回部分文件的分区时只投递这些文件", async () => {
    stubEngine([section("ESLint", "E", "src/good.ts")]);
    const { post, pre } = setup();

    await post(exec("src/bad.ts"), okResult(), acceptNext);
    await post(exec("src/good.ts"), okResult(), acceptNext);

    const decision = await flush(pre);
    const text = decision.messages[0]?.content?.[0]?.text ?? "";
    expect(text).toContain("src/good.ts");
    expect(text).not.toContain("src/bad.ts");
  });

  it("step 被否决时丢弃登记，不投递也不检查", async () => {
    const { post, pre } = setup();

    await post(exec("src/a.ts"), okResult(), acceptNext);
    const rejected = await pre({ agent, messages: [], turn: 1, step: 2 }, async () => ({
      kind: "reject",
      messages: [],
    }));
    expect(rejected.messages).toEqual([]);
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();

    // 登记已丢弃：随后正常 step 也不会补投
    const next = await flush(pre);
    expect(next.messages).toEqual([]);
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();
  });

  it("不同 agent 的登记互不影响", async () => {
    stubEngine([section("ESLint", "E", "src/a.ts")]);
    const { post, pre } = setup();

    await post(
      { name: "write", arguments: { file_path: "src/a.ts" }, agent },
      okResult(),
      acceptNext,
    );
    await post(
      { name: "write", arguments: { file_path: "src/b.ts" }, agent: otherAgent },
      okResult(),
      acceptNext,
    );

    const first = await flush(pre, agent);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]?.content?.[0]?.text).toContain("src/a.ts");
    expect(first.messages[0]?.content?.[0]?.text).not.toContain("src/b.ts");

    stubEngine([section("ESLint", "E", "src/b.ts")]);
    const second = await flush(pre, otherAgent);
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]?.content?.[0]?.text).toContain("src/b.ts");
  });
});

describe("apply: agent/pre-step 节点上下文注入", () => {
  function setup() {
    const { ctx, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", vitePort: 5173, viteHost: "127.0.0.1" });
    return handlerOf(handlers, "agent/pre-step") as unknown as PreStep;
  }

  const userDecision = (text: string) => ({
    kind: "accept",
    messages: [{ role: "user", source: { kind: "user" }, content: [{ type: "text", text }] }],
  });

  it("按 @节点[id] 反查元素并追加本插件上下文消息，随后清空端点", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") return { ok: true };
      return {
        ok: true,
        json: async () => ({
          selectedElements: [
            { id: "n1", filePath: "/work/proj/a.ts", line: 2, description: "div" },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = setup();

    const decision = await handler({}, async () => userDecision("请看 @节点[n1]"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decision.messages).toHaveLength(2);
    const injected = decision.messages[1];
    expect(injected.source).toEqual({ kind: "aipanel" });
    expect(injected.content?.[0]?.text).toContain("节点 ID：n1");
    expect(injected.content?.[0]?.text).toContain("/work/proj/a.ts:2");
  });

  it("无节点标记时原样放行（不访问端点）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = setup();

    const decision = await handler({}, async () => userDecision("普通提问"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decision.messages).toHaveLength(1);
  });

  it("端点不可达或未命中元素时原样放行（不阻塞会话）", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = setup();

    const decision = await handler({}, async () => userDecision("引用 @节点[n404]"));
    expect(decision.messages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
