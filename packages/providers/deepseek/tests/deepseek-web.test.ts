/**
 * @aipanel/provider-deepseek deepseek-web（dsh web 进程启动 / launch token 捕获）单元测试。
 *
 * 覆盖目标：
 *   - startDeepSeekWeb：dsh launcher 参数顺序（--patch 必须位于 --profile web 之后、
 *     web app 参数之前）、DSH_HOME/VERBOSE 环境透传、stdout/stderr 采集与日志缓冲写入、
 *     进程退出码/启动失败告警；
 *   - launch token 打洞：跨 chunk 拼接解析 ?token=、幂等、原始输出回填（超时诊断）。
 *
 * Stub 策略：execa 与 @aipanel/core/node 的日志/进程日志面用 vi.mock 隔离；子进程用
 * EventEmitter + thenable 桩替代（不真实拉起 dsh）；时间相关用 vi.useFakeTimers。
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { LaunchToken, startDeepSeekWeb } from "../src/deepseek-web";

const mocks = vi.hoisted(() => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  addProviderStdout: vi.fn(),
  addProviderStderr: vi.fn(),
}));

vi.mock("@aipanel/core/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aipanel/core/node")>();
  return {
    ...actual,
    createLogger: () => ({
      debug: mocks.logDebug,
      info: vi.fn(),
      warn: mocks.logWarn,
      error: mocks.logError,
    }),
    getProcessLogBuffer: () => ({
      addProviderStdout: mocks.addProviderStdout,
      addProviderStderr: mocks.addProviderStderr,
    }),
  };
});

vi.mock("execa", () => ({ execa: vi.fn() }));

const HOST = "127.0.0.1";
const PORT = 3080;

/** execa 返回值桩：stdout/stderr 事件面 + 可解析的退出结果（execa 返回 thenable 进程） */
function fakeProcess(result: { exitCode: number | null; signal?: string } = { exitCode: 0 }) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const settled =
    result.exitCode === null && result.signal === "__reject__"
      ? Promise.reject(new Error("spawn ENOENT"))
      : Promise.resolve(result);
  return {
    stdout,
    stderr,
    then: settled.then.bind(settled),
    catch: settled.catch.bind(settled),
  };
}

/** 读取最近一次 execa 调用 */
function lastExecaCall() {
  const calls = vi.mocked(execa).mock.calls as unknown as [
    string,
    string[],
    { cwd: string; env: Record<string, string>; reject: boolean; cleanup: boolean; shell: boolean },
  ][];
  return calls[calls.length - 1];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("startDeepSeekWeb 启动参数", () => {
  beforeEach(() => {
    vi.mocked(execa).mockReturnValue(fakeProcess() as never);
  });

  it("以 --profile web / --port / --host / --no-open 启动，并透传进程选项", () => {
    const proc = startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj" });

    const [command, args, options] = lastExecaCall();
    expect(command).toBe("dsh");
    expect(args).toEqual(["--profile", "web", "--port", "3080", "--host", HOST, "--no-open"]);
    expect(options.cwd).toBe("/work/proj");
    expect(options.reject).toBe(false);
    expect(options.cleanup).toBe(true);
    expect(options.shell).toBe(true);
    expect(proc).toBe(vi.mocked(execa).mock.results[0].value);
  });

  it("patchPath 作为 launcher 选项插在 --profile web 之后、web app 参数之前（回归）", () => {
    startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj", patchPath: "/tmp/o.yml" });

    const args = lastExecaCall()[1];
    const profileAt = args.indexOf("--profile");
    const patchAt = args.indexOf("--patch");
    expect(patchAt).toBeGreaterThan(profileAt);
    expect(patchAt).toBeLessThan(args.indexOf("--port"));
    expect(args[patchAt + 1]).toBe("/tmp/o.yml");
  });

  it("home 写入 DSH_HOME、verbose 写入 VERBOSE=1；缺省不追加", () => {
    startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj", home: "/tmp/dsh-home", verbose: true });
    let env = lastExecaCall()[2].env;
    expect(env.DSH_HOME).toBe("/tmp/dsh-home");
    expect(env.VERBOSE).toBe("1");

    startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj" });
    env = lastExecaCall()[2].env;
    expect(env.DSH_HOME).toBe(process.env.DSH_HOME);
    expect(env.VERBOSE).toBeUndefined();
  });
});

describe("startDeepSeekWeb 输出与退出处理", () => {
  beforeEach(() => {
    vi.mocked(execa).mockReturnValue(fakeProcess() as never);
  });

  it("stdout/stderr 非空输出写入进程日志缓冲，原始输出回填 LaunchToken", () => {
    const launchToken = new LaunchToken();
    const recordOutput = vi.spyOn(launchToken, "recordOutput");
    const proc = fakeProcess();
    vi.mocked(execa).mockReturnValue(proc as never);

    startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj", launchToken });

    proc.stdout.emit("data", Buffer.from("boot ok\n"));
    proc.stderr.emit("data", Buffer.from("warn: something\n"));
    proc.stdout.emit("data", Buffer.from("  \n"));

    expect(mocks.addProviderStdout).toHaveBeenCalledTimes(1);
    expect(mocks.addProviderStdout).toHaveBeenCalledWith("boot ok");
    expect(mocks.addProviderStderr).toHaveBeenCalledTimes(1);
    expect(mocks.addProviderStderr).toHaveBeenCalledWith("warn: something");
    expect(recordOutput).toHaveBeenCalledWith("stdout", "boot ok\n");
    expect(recordOutput).toHaveBeenCalledWith("stderr", "warn: something\n");
  });

  it("跨 chunk 拼接解析 launch token；已捕获后不再变更（幂等）", () => {
    const launchToken = new LaunchToken();
    const proc = fakeProcess();
    vi.mocked(execa).mockReturnValue(proc as never);
    startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj", launchToken });

    proc.stdout.emit("data", Buffer.from(`dsh web: http://${HOST}:3080/?tok`));
    expect(launchToken.get()).toBeUndefined();
    proc.stdout.emit("data", Buffer.from("en=abc-123_XY\n"));
    expect(launchToken.get()).toBe("abc-123_XY");

    // 后续输出不会覆盖已捕获 token
    proc.stdout.emit("data", Buffer.from("?token=other\n"));
    expect(launchToken.get()).toBe("abc-123_XY");
  });

  it("无 launchToken 时仅记录日志，不影响进程输出处理", () => {
    const proc = fakeProcess();
    vi.mocked(execa).mockReturnValue(proc as never);
    startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj" });
    expect(() => proc.stdout.emit("data", Buffer.from("hello\n"))).not.toThrow();
    expect(mocks.addProviderStdout).toHaveBeenCalledWith("hello");
  });

  it("退出码非 0 时告警，正常退出仅 debug", async () => {
    vi.mocked(execa).mockReturnValue(fakeProcess({ exitCode: 0 }) as never);
    startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj" });
    await flush();
    expect(mocks.logWarn.mock.calls.filter((c) => c[0] === "[dsh exited]")).toHaveLength(0);
    expect(mocks.logDebug.mock.calls.some((c) => c[0] === "[dsh exited]")).toBe(true);

    vi.mocked(execa).mockReturnValue(fakeProcess({ exitCode: 1 }) as never);
    startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj" });
    await flush();
    expect(mocks.logWarn.mock.calls.some((c) => c[0] === "[dsh exited]")).toBe(true);
  });

  it("进程启动失败（promise reject）时记录 error 不抛出", async () => {
    vi.mocked(execa).mockReturnValue(fakeProcess({ exitCode: null, signal: "__reject__" }) as never);
    expect(() => startDeepSeekWeb({ port: PORT, hostname: HOST, cwd: "/work/proj" })).not.toThrow();
    await flush();
    expect(mocks.logError.mock.calls.some((c) => c[0] === "[dsh spawn failed]")).toBe(true);
  });
});

describe("LaunchToken 捕获语义", () => {
  it("set 幂等：只接受首个 token，wait 直接解析该值", async () => {
    const lt = new LaunchToken();
    lt.set("first");
    lt.set("second");
    expect(lt.get()).toBe("first");
    await expect(lt.wait(1)).resolves.toBe("first");
  });

  it("超时后缓存失败：后续 wait 快速失败且不重复输出原始日志", async () => {
    vi.useFakeTimers();
    const lt = new LaunchToken();
    lt.recordOutput("stdout", "boot noise");

    const first = lt.wait(1000);
    vi.advanceTimersByTime(1000);
    await expect(first).rejects.toThrow(/dsh launch token was not captured/);
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);

    // 已缓存失败：无需再等超时窗口即拒绝
    await expect(lt.wait(1000)).rejects.toThrow(/dsh launch token was not captured/);
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);
  });

  it("recordOutput 只保留末尾 4096 字符（超时诊断日志不无限增长）", async () => {
    vi.useFakeTimers();
    const lt = new LaunchToken();
    lt.recordOutput("stdout", "START_MARK" + "x".repeat(5000));

    const waiting = lt.wait(1000);
    vi.advanceTimersByTime(1000);
    await expect(waiting).rejects.toThrow();

    const message = mocks.logWarn.mock.calls[0][0] as string;
    expect(message).not.toContain("START_MARK");
    expect(message).toContain("x".repeat(100));
  });
});
