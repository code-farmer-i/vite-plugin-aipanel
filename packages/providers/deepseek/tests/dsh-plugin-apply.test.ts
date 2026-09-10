/**
 * dsh-plugin 宿主插件 apply()（run_diagnostics 工具 / 编辑后自动诊断 / 节点上下文注入）单元测试。
 *
 * 覆盖目标：
 *   - 诊断总开关 enableDiagnostics：关闭时不注册工具与 post-execute 钩子；
 *   - run_diagnostics 工具定义与 execute 分支：全量诊断、单文件不存在报错、单文件诊断、
 *     诊断分区空文本兜底、LSP 零基坐标 → 1-based 归一化；
 *   - tools/post-execute 自动诊断门禁：默认关闭、PTC 子调度跳过、非写工具跳过、
 *     失败结果/非 accept 决策跳过、非 JS 文件跳过、诊断并入原工具内容而非覆盖；
 *   - agent/pre-step 节点上下文注入：按 @节点[id] 反查、追加 plugin 消息、注入后清空端点。
 *
 * Stub 策略：跑在最小 ctx 桩上（tools/on/get），@aipanel/core/node 的诊断引擎面
 * （runAllChecks/runProjectDiagnostics/isJsFile）与日志面 vi.mock 隔离，端点用
 * vi.stubGlobal('fetch') 承载；协议路径/严重度常量引用 @aipanel/core(-/node) 单一来源。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DIAGNOSTICS_TOOL_DESCRIPTION, SEVERITY_ERROR } from "@aipanel/core/node";
import { apply } from "../dsh-plugin/src/index";

const mocks = vi.hoisted(() => ({
  runAllChecks: vi.fn(),
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

/** 最小 ctx 桩：捕获 on 注册（同名后者覆盖，与 cordis 行为一致的简化） */
function createCtx() {
  const handlers = new Map<string, OnHandler>();
  const tools = { register: vi.fn() };
  const on = vi.fn((name: string, handler: OnHandler) => {
    handlers.set(name, handler);
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

const handlerOf = (handlers: Map<string, OnHandler>, name: string) =>
  handlers.get(name) as OnHandler;

beforeAll(() => {
  delete process.env.OPENCODE_ENABLE_LINT;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("apply: 诊断功能总开关", () => {
  it("enableDiagnostics 缺省（false）时不注册工具，也不挂 post-execute 钩子", () => {
    const { ctx, tools, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj" });
    expect(tools.register).not.toHaveBeenCalled();
    expect(handlers.has("tools/post-execute")).toBe(false);
  });

  it("enableDiagnostics=true 时注册 run_diagnostics 工具并挂 post-execute 钩子", () => {
    const { ctx, tools, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", enableDiagnostics: true });

    expect(tools.register).toHaveBeenCalledTimes(1);
    const tool = registeredTool(tools.register);
    expect(tool.name).toBe("run_diagnostics");
    expect(tool.description).toBe(DIAGNOSTICS_TOOL_DESCRIPTION);
    expect(handlers.has("tools/post-execute")).toBe(true);
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
      tscOutput: { rawOutput: "", diagnostics: [] },
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
        tscOutput: { rawOutput: "tsc text", diagnostics: [] },
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

describe("apply: tools/post-execute 自动诊断门禁", () => {
  type PostExec = (
    exec: unknown,
    result: unknown,
    next: () => Promise<{ kind: string; content?: unknown[] }>,
  ) => Promise<{ kind: string; content?: unknown[] }>;

  function setup(config: Partial<PluginConfig>) {
    const { ctx, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", enableDiagnostics: true, ...config } as PluginConfig);
    return handlerOf(handlers, "tools/post-execute") as unknown as PostExec;
  }

  const exec = (overrides: Record<string, unknown> = {}) => ({
    name: "write",
    arguments: { file_path: "src/a.ts" },
    ...overrides,
  });
  const okResult = () => ({ isError: false, content: [{ type: "text", text: "原始输出" }] });

  it("未开启自动诊断（默认）时直接放行，不触发检查", async () => {
    const handler = setup({});
    const next = vi.fn(async () => ({ kind: "accept" }));
    const decision = await handler(exec(), okResult(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(decision).toEqual({ kind: "accept" });
    expect(mocks.runAllChecks).not.toHaveBeenCalled();
  });

  it("开启后把诊断并入原工具内容末尾（不覆盖已有 content）", async () => {
    mocks.isJsFile.mockReturnValue(true);
    mocks.runAllChecks.mockResolvedValue({
      eslintOutput: { text: "E-msg" },
      tscOutput: { rawOutput: "T-msg" },
    });
    const handler = setup({ autoDiagnose: true });

    const result = okResult();
    const decision = await handler(exec(), result, async () => ({ kind: "accept" }));

    expect(mocks.runAllChecks).toHaveBeenCalledWith(
      path.resolve("/work/proj", "src/a.ts"),
      "/work/proj",
    );
    expect(decision.kind).toBe("accept");
    expect(decision.content?.[0]).toEqual({ type: "text", text: "原始输出" });
    expect(decision.content?.[1]).toEqual({
      type: "text",
      text: "\n\n## vue-tsc\n\nT-msg\n\n## ESLint\n\nE-msg",
    });
  });

  it("跳过：PTC 子调度 / 非写工具 / 工具失败 / 非 accept 决策 / 非 JS 文件", async () => {
    mocks.runAllChecks.mockResolvedValue({
      eslintOutput: { text: "E" },
      tscOutput: { rawOutput: "T" },
    });
    mocks.isJsFile.mockReturnValue(false);
    const handler = setup({ autoDiagnose: true });
    const next = async () => ({ kind: "accept" as const });

    await handler(exec({ parent: "run_code" }), okResult(), next);
    await handler(exec({ name: "read" }), okResult(), next);
    await handler(exec(), { isError: true, content: [] }, next);
    await handler(exec(), okResult(), async () => ({ kind: "reject" }));
    await handler(exec(), okResult(), next); // isJsFile=false
    expect(mocks.runAllChecks).not.toHaveBeenCalled();
  });

  it("诊断为空时不改动工具内容", async () => {
    mocks.isJsFile.mockReturnValue(true);
    mocks.runAllChecks.mockResolvedValue({
      eslintOutput: {},
      tscOutput: { rawOutput: "", exitCode: 0 },
    });
    const handler = setup({ autoDiagnose: true });

    const decision = await handler(exec(), okResult(), async () => ({ kind: "accept" }));
    expect(decision).toEqual({ kind: "accept" });
  });
});

describe("apply: agent/pre-step 节点上下文注入", () => {
  type PreStep = (
    payload: { signal?: AbortSignal },
    next: () => Promise<{ kind: string; messages: unknown[] }>,
  ) => Promise<{
    kind: string;
    messages: { source?: { kind: string; plugin?: string }; content?: { text?: string }[] }[];
  }>;

  function setup() {
    const { ctx, handlers } = createCtx();
    apply(ctx, { cwd: "/work/proj", vitePort: 5173, viteHost: "127.0.0.1" });
    return handlerOf(handlers, "agent/pre-step") as unknown as PreStep;
  }

  const userDecision = (text: string) => ({
    kind: "accept",
    messages: [{ role: "user", source: { kind: "user" }, content: [{ type: "text", text }] }],
  });

  it("按 @节点[id] 反查元素并追加 plugin 上下文消息，随后清空端点", async () => {
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
    expect(injected.source).toEqual({ kind: "plugin", plugin: "aipanel" });
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
