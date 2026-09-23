/**
 * dsh-plugin 宿主插件 apply()（run_diagnostics 工具 / 编辑后自动诊断 / 节点上下文注入）单元测试。
 *
 * 覆盖目标：
 *   - 诊断总开关 enableDiagnostics：关闭时不注册工具、post-execute 与诊断 pre-step 钩子；
 *   - run_diagnostics 工具定义与 execute 分支：全量诊断、单文件不存在报错、单文件诊断、
 *     诊断分区空文本兜底、LSP 零基坐标 → 1-based 归一化；
 *   - tools/post-execute 自动诊断登记：默认关闭、非写工具/失败结果/非 accept 决策/非 JS 文件
 *     不登记，登记阶段不跑检查（检查推迟到 step 边界）；
 *   - agent/pre-step 收尾诊断：对本步编辑过的文件统一诊断一次，发现未变也每步插入一条
 *     notice 形式、kind 为 aipanel 的上下文消息（不再按指纹去重，改以有界摘要控制成本）；
 *     原生编辑与 PTC 子调度共用同一路径；
 *   - agent/pre-step 节点上下文注入：按 @节点[id] 反查、追加本插件上下文消息、注入后清空端点。
 *
 * Stub 策略：跑在最小 ctx 桩上（tools/on/get），@aipanel/core/node 的诊断引擎面
 * （runAllChecks/runAllChecksForFiles/runProjectDiagnostics/isJsFile）与日志面 vi.mock 隔离，端点用
 * vi.stubGlobal('fetch') 承载；协议路径/严重度常量引用 @aipanel/core(-/node) 单一来源。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTICS_TOOL_DESCRIPTION,
  SEVERITY_ERROR,
  omittedFindingsHint,
} from "@aipanel/core/node";
import { apply } from "../dsh-plugin/src/index";

const mocks = vi.hoisted(() => ({
  runAllChecks: vi.fn(),
  runAllChecksForFiles: vi.fn(),
  runProjectDiagnostics: vi.fn(),
  isJsFile: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@aipanel/core/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aipanel/core/node")>();
  return {
    ...actual,
    runAllChecks: mocks.runAllChecks,
    runAllChecksForFiles: mocks.runAllChecksForFiles,
    runProjectDiagnostics: mocks.runProjectDiagnostics,
    isJsFile: mocks.isJsFile,
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

beforeAll(() => {
  delete process.env.OPENCODE_ENABLE_LINT;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("apply: 诊断功能总开关", () => {
  it("enableDiagnostics 缺省（false）时不注册工具与任何诊断钩子", () => {
    const { ctx, tools, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj" });
    expect(tools.register).not.toHaveBeenCalled();
    expect(handlers.has("tools/post-execute")).toBe(false);
    expect(handlers.has("agent/pre-step")).toBe(false);
  });

  it("enableDiagnostics=true 时注册 run_diagnostics 工具并挂登记与收尾钩子", () => {
    const { ctx, tools, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", enableDiagnostics: true });

    expect(tools.register).toHaveBeenCalledTimes(1);
    const tool = registeredTool(tools.register);
    expect(tool.name).toBe("run_diagnostics");
    expect(tool.description).toBe(DIAGNOSTICS_TOOL_DESCRIPTION);
    expect(handlers.has("tools/post-execute")).toBe(true);
    expect(handlers.has("agent/pre-step")).toBe(true);
  });
});

describe("apply: run_diagnostics execute 分支", () => {
  function setup(cwd: string) {
    const { ctx, tools } = createCtx();
    apply(ctx, { cwd, enableDiagnostics: true });
    return registeredTool(tools.register);
  }

  it("无 filePath 时全量诊断，空分区回退文案，LSP 零基坐标归一化为 1-based", async () => {
    mocks.runProjectDiagnostics.mockResolvedValue({
      eslintOutput: {
        text: "eslint text",
        diagnostics: [
          {
            file: "/work/proj/a.ts",
            range: { start: { line: 4, character: 9 } },
            severity: SEVERITY_ERROR,
            message: "unexpected any",
          },
          {
            file: "/work/proj/b.ts",
            range: { start: { line: 0, character: 0 } },
            severity: 2,
            message: "unused",
          },
        ],
      },
      tscOutput: { rawOutput: "", diagnostics: [], source: "vue-tsc" },
    });
    const tool = setup("/work/proj");

    const result = await tool.execute({});
    expect(mocks.runProjectDiagnostics).toHaveBeenCalledWith("/work/proj");
    expect(result.title).toBe("全量诊断结果");
    expect(result.sections).toEqual([
      { title: "ESLint", text: "eslint text" },
      { title: "vue-tsc", text: "没有发现类型错误" },
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

  it("单文件不存在时抛错并带解析后的绝对路径", async () => {
    const tool = setup("/work/proj");
    await expect(tool.execute({ filePath: "missing.ts" })).rejects.toThrow(
      path.resolve("/work/proj", "missing.ts"),
    );
    expect(mocks.runAllChecks).not.toHaveBeenCalled();
  });

  it("单文件存在时按相对路径命名标题并调用 runAllChecks", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-dsh-plugin-"));
    try {
      const file = path.join(cwd, "src", "a.ts");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "export const a = 1;\n");
      mocks.runAllChecks.mockResolvedValue({
        eslintOutput: { text: "", diagnostics: [] },
        tscOutput: { rawOutput: "tsc text", diagnostics: [], source: "vue-tsc" },
      });
      const tool = setup(cwd);

      const result = await tool.execute({ filePath: "src/a.ts" });
      expect(mocks.runAllChecks).toHaveBeenCalledWith(file, cwd);
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
  function setup(config: Partial<PluginConfig>) {
    const { ctx, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", enableDiagnostics: true, ...config } as PluginConfig);
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

  it("未开启自动诊断（默认）时不登记、step 边界也不诊断", async () => {
    const { post, pre } = setup({});
    const decision = await post(exec(), okResult(), acceptNext);
    expect(decision).toEqual({ kind: "accept" });

    const stepDecision = await runStep(pre);
    expect(stepDecision.messages).toEqual([]);
    expect(mocks.runAllChecksForFiles).not.toHaveBeenCalled();
  });

  it("登记阶段不跑检查、不改工具结果 content", async () => {
    mocks.isJsFile.mockReturnValue(true);
    const { post } = setup({ autoDiagnose: true });

    const result = okResult();
    const decision = await post(exec(), result, acceptNext);

    expect(decision).toEqual({ kind: "accept" });
    expect(mocks.runAllChecksForFiles).not.toHaveBeenCalled();
  });

  it("跳过：非写工具 / 工具失败 / 非 accept 决策 / 非 JS 文件", async () => {
    mocks.isJsFile.mockReturnValue(false);
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec({ name: "read" }), okResult(), acceptNext);
    await post(exec(), { isError: true, content: [] }, acceptNext);
    await post(exec(), okResult(), async () => ({ kind: "reject" }));
    await post(exec(), okResult(), acceptNext); // isJsFile=false

    const decision = await runStep(pre);
    expect(decision.messages).toEqual([]);
    expect(mocks.runAllChecksForFiles).not.toHaveBeenCalled();
  });
});

describe("apply: agent/pre-step 收尾诊断（每步投递摘要 + 聚合）", () => {
  const agent = {};
  const otherAgent = {};

  function setup(config: Partial<PluginConfig> = {}) {
    const { ctx, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", enableDiagnostics: true, ...config } as PluginConfig);
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
  const diagnostics = (text: string) => ({
    eslintOutput: { text },
    tscOutput: { rawOutput: "", exitCode: 0 },
  });
  const clean = { eslintOutput: {}, tscOutput: { rawOutput: "", exitCode: 0 } };
  /** 批量检查桩：本次登记的所有文件返回同一份结果 */
  const stubChecks = (result: unknown) =>
    mocks.runAllChecksForFiles.mockImplementation(
      async (files: string[]) => new Map(files.map((file) => [file, result] as [string, unknown])),
    );

  it("本步编辑过的文件批量检查一次，聚合成一条 notice 上下文消息并清空登记", async () => {
    mocks.isJsFile.mockReturnValue(true);
    stubChecks(diagnostics("E-msg"));
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec("src/a.ts"), okResult(), acceptNext);
    await post(exec("src/b.vue"), okResult(), acceptNext);
    // 同文件重复编辑只登记一次
    await post(exec("src/a.ts"), okResult(), acceptNext);

    const decision = await flush(pre);
    expect(mocks.runAllChecksForFiles).toHaveBeenCalledTimes(1);
    expect(mocks.runAllChecksForFiles).toHaveBeenCalledWith(
      [path.resolve("/work/proj", "src/a.ts"), path.resolve("/work/proj", "src/b.vue")],
      "/work/proj",
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
    // 只有 ESLint 有发现：不再附带 tsc 的占位分区
    expect(message?.content?.[0]?.text).toContain("## ESLint");
    expect(message?.content?.[0]?.text).not.toContain("没有发现类型错误");

    // 登记已清空：再次收尾不重复诊断也不追加消息
    const again = await flush(pre);
    expect(mocks.runAllChecksForFiles).toHaveBeenCalledTimes(1);
    expect(again.messages).toEqual([]);
  });

  it("诊断内容未变也每个 step 投递：不再让'仍未修复'与'已修好'同为静默", async () => {
    mocks.isJsFile.mockReturnValue(true);
    stubChecks(diagnostics("E1"));
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec("src/a.ts"), okResult(), acceptNext);
    const first = await flush(pre);
    expect(first.messages).toHaveLength(1);

    // 同一诊断内容：照旧投递（指纹去重时代这里是 []）
    await post(exec("src/a.ts"), okResult(), acceptNext);
    const unchanged = await flush(pre);
    expect(unchanged.messages).toHaveLength(1);
    expect(unchanged.messages[0]?.content?.[0]?.text).toContain("E1");

    stubChecks(diagnostics("E2"));
    await post(exec("src/a.ts"), okResult(), acceptNext);
    const changed = await flush(pre);
    expect(changed.messages[0]?.content?.[0]?.text).toContain("E2");
  });

  it("每个文件分区折叠成有界摘要：超限发现折叠成一行省略提示", async () => {
    mocks.isJsFile.mockReturnValue(true);
    const findings = Array.from(
      { length: 30 },
      (_, i) => `ERROR [big.ts:${i + 1}:7] 'unusedBig${i}' is assigned a value but never used. (r)`,
    );
    stubChecks(diagnostics(findings.join("\n")));
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec("src/big.ts"), okResult(), acceptNext);
    const text = (await flush(pre)).messages[0]?.content?.[0]?.text ?? "";

    // 只列前 3 条 + 省略 27 条的提示（条数上限是摘要成本的控制点）
    expect(text).toContain("big.ts:3:7");
    expect(text).not.toContain("big.ts:4:7");
    expect(text).toContain(omittedFindingsHint(27));
    // 摘要形态不再依赖 4000 字符硬截断
    expect(text).not.toContain("已截断");
  });

  it("已修好不投递；再次出错重新投递", async () => {
    mocks.isJsFile.mockReturnValue(true);
    stubChecks(diagnostics("E"));
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec("src/a.ts"), okResult(), acceptNext);
    expect((await flush(pre)).messages).toHaveLength(1);

    // 空结果：没有发现就不投递（占位噪音不刷）
    stubChecks(clean);
    await post(exec("src/a.ts"), okResult(), acceptNext);
    expect((await flush(pre)).messages).toEqual([]);

    // 同样的诊断再次出现：照旧投递
    stubChecks(diagnostics("E"));
    await post(exec("src/a.ts"), okResult(), acceptNext);
    expect((await flush(pre)).messages).toHaveLength(1);
  });

  it("PTC 子调度与原生编辑共用登记表：同一 step 内一次批量检查", async () => {
    mocks.isJsFile.mockReturnValue(true);
    stubChecks(diagnostics("E"));
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec("src/native.ts"), okResult(), acceptNext);
    await post(
      exec("src/ptc.ts", { parent: "run_code", rootCallId: "root-1" }),
      okResult(),
      acceptNext,
    );

    const decision = await flush(pre);
    expect(mocks.runAllChecksForFiles).toHaveBeenCalledTimes(1);
    const text = decision.messages[0]?.content?.[0]?.text ?? "";
    expect(text).toContain("src/native.ts");
    expect(text).toContain("src/ptc.ts");
  });

  it("兼容 camelCase filePath 登记", async () => {
    mocks.isJsFile.mockReturnValue(true);
    stubChecks(diagnostics("E"));
    const { post, pre } = setup({ autoDiagnose: true });

    await post(
      { name: "write", arguments: { filePath: "src/camel.ts" }, agent },
      okResult(),
      acceptNext,
    );
    const decision = await flush(pre);
    expect(mocks.runAllChecksForFiles).toHaveBeenCalledWith(
      [path.resolve("/work/proj", "src/camel.ts")],
      "/work/proj",
    );
    expect(decision.messages).toHaveLength(1);
  });

  it("批量检查整体失败时降级：不投递也不抛错", async () => {
    mocks.isJsFile.mockReturnValue(true);
    mocks.runAllChecksForFiles.mockRejectedValue(new Error("boom"));
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec("src/a.ts"), okResult(), acceptNext);
    const decision = await flush(pre);
    expect(decision.messages).toEqual([]);
  });

  it("批量结果缺少某个文件时只投递其余文件", async () => {
    mocks.isJsFile.mockReturnValue(true);
    mocks.runAllChecksForFiles.mockImplementation(
      async (files: string[]) =>
        new Map(
          files
            .filter((file) => !file.endsWith("bad.ts"))
            .map((file) => [file, diagnostics("E")] as [string, unknown]),
        ),
    );
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec("src/bad.ts"), okResult(), acceptNext);
    await post(exec("src/good.ts"), okResult(), acceptNext);

    const decision = await flush(pre);
    const text = decision.messages[0]?.content?.[0]?.text ?? "";
    expect(text).toContain("src/good.ts");
    expect(text).not.toContain("src/bad.ts");
  });

  it("step 被否决时丢弃登记，不投递也不检查", async () => {
    mocks.isJsFile.mockReturnValue(true);
    const { post, pre } = setup({ autoDiagnose: true });

    await post(exec("src/a.ts"), okResult(), acceptNext);
    const rejected = await pre({ agent, messages: [], turn: 1, step: 2 }, async () => ({
      kind: "reject",
      messages: [],
    }));
    expect(rejected.messages).toEqual([]);
    expect(mocks.runAllChecksForFiles).not.toHaveBeenCalled();

    // 登记已丢弃：随后正常 step 也不会补投
    const next = await flush(pre);
    expect(next.messages).toEqual([]);
    expect(mocks.runAllChecksForFiles).not.toHaveBeenCalled();
  });

  it("不同 agent 的登记互不影响", async () => {
    mocks.isJsFile.mockReturnValue(true);
    stubChecks(diagnostics("E"));
    const { post, pre } = setup({ autoDiagnose: true });

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
