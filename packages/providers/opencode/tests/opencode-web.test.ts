/**
 * @aipanel/provider-opencode Web 运行时（prepareOpenCodeRuntime / startOpenCodeWeb）单元测试。
 *
 * 覆盖目标：
 *   - prepareOpenCodeRuntime：缓存目录落位、opencode.json 结构（插件 file:// 条目、
 *     formatter 开关、mcp chrome-devtools 代理 URL 由 viteHost/vitePort + MCP_API_PATH 拼装）；
 *   - startOpenCodeWeb：opencode serve 参数拼装（含 --cors 逐个追加）、进程环境变量
 *     （XDG_STATE_HOME / OPENCODE_ENV.* 各项）、stdout/stderr 采集与 MaxListeners 警告过滤。
 *
 * Stub 策略：fs 用真实临时目录（os.tmpdir），execa 与 @aipanel/core/node 的日志/进程日志
 * 面用 vi.mock 隔离，避免真实拉起子进程或写日志；常量一律引用 @aipanel/core/node 单一来源。
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { AIPANEL_CACHE_DIR, MCP_API_PATH, OPENCODE_ENV } from "@aipanel/core/node";
import { prepareOpenCodeRuntime, startOpenCodeWeb } from "../src/opencode-web";

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

const VITE_PORT = 5097;
const VITE_HOST = "127.0.0.1";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-oc-web-"));
  tmpDirs.push(dir);
  return dir;
}

/** 构造 execa 返回值桩：仅提供 startOpenCodeWeb 触达的 stdout/stderr 事件面 */
function fakeProcess() {
  return { stdout: new EventEmitter(), stderr: new EventEmitter() };
}

/** 读取最近一次 execa 调用的 (command, args, options) */
function lastExecaCall() {
  const calls = vi.mocked(execa).mock.calls as unknown as [
    string,
    string[],
    { cwd: string; env: Record<string, string>; reject: boolean; cleanup: boolean; shell: boolean },
  ][];
  return calls[calls.length - 1];
}

afterEach(() => {
  vi.clearAllMocks();
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("prepareOpenCodeRuntime", () => {
  it("在 <cwd>/AIPANEL_CACHE_DIR/opencode 写入 opencode.json 并返回该目录", () => {
    const cwd = makeTmpDir();
    const cacheDir = prepareOpenCodeRuntime(cwd, VITE_PORT, VITE_HOST);

    const expectedDir = path.join(cwd, AIPANEL_CACHE_DIR, "opencode");
    expect(cacheDir).toBe(expectedDir);
    const configPath = path.join(expectedDir, "opencode.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      plugin: string[];
      formatter: boolean;
      mcp: Record<string, { type: string; url: string }>;
    };
    // mcp 代理 URL 单一来源：viteHost + vitePort + core MCP_API_PATH
    expect(config.mcp["chrome-devtools"]).toEqual({
      type: "remote",
      url: `http://${VITE_HOST}:${VITE_PORT}${MCP_API_PATH}`,
    });
    // 插件条目为源码 plugins 目录内 .js 文件的 file:// URL（与目录实际内容一致）
    const pluginsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/plugins");
    const expectedPlugins = fs
      .readdirSync(pluginsDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => pathToFileURL(path.join(pluginsDir, f)).href);
    expect(config.plugin).toEqual(expectedPlugins);
  });

  it("enablePrettier=false 时 formatter 关闭；缺省/true 时启用", () => {
    const cwd = makeTmpDir();
    const readFormatter = (dir: string) =>
      (
        JSON.parse(fs.readFileSync(path.join(dir, "opencode.json"), "utf-8")) as {
          formatter: boolean;
        }
      ).formatter;

    expect(readFormatter(prepareOpenCodeRuntime(cwd, VITE_PORT, VITE_HOST, false, false))).toBe(
      false,
    );
    expect(readFormatter(prepareOpenCodeRuntime(cwd, VITE_PORT, VITE_HOST, false, true))).toBe(
      true,
    );
    expect(readFormatter(prepareOpenCodeRuntime(cwd, VITE_PORT, VITE_HOST))).toBe(true);
  });

  it("缓存目录已存在时幂等（重复调用仍产出合法配置）", () => {
    const cwd = makeTmpDir();
    prepareOpenCodeRuntime(cwd, VITE_PORT, VITE_HOST);
    const cacheDir = prepareOpenCodeRuntime(cwd, 8080, "10.0.0.1");
    const config = JSON.parse(fs.readFileSync(path.join(cacheDir, "opencode.json"), "utf-8")) as {
      mcp: Record<string, { url: string }>;
    };
    expect(config.mcp["chrome-devtools"].url).toBe(`http://10.0.0.1:8080${MCP_API_PATH}`);
  });
});

describe("startOpenCodeWeb 参数与环境变量", () => {
  beforeEach(() => {
    vi.mocked(execa).mockReturnValue(fakeProcess() as never);
  });

  it("以 serve --port --hostname 启动，CORS 源逐个追加 --cors", () => {
    const cwd = makeTmpDir();
    startOpenCodeWeb({
      port: 5097,
      hostname: VITE_HOST,
      serverUrl: "http://127.0.0.1:5097",
      cwd,
      corsOrigins: ["http://a.test", "http://b.test"],
    });

    const [command, args, options] = lastExecaCall();
    expect(command).toBe("opencode");
    expect(args).toEqual([
      "serve",
      "--port",
      "5097",
      "--hostname",
      VITE_HOST,
      "--cors",
      "http://a.test",
      "--cors",
      "http://b.test",
    ]);
    expect(options.cwd).toBe(cwd);
    expect(options.reject).toBe(false);
    expect(options.cleanup).toBe(true);
    expect(options.shell).toBe(true);
  });

  it("无 CORS 源时不追加 --cors", () => {
    const cwd = makeTmpDir();
    startOpenCodeWeb({
      port: 5097,
      hostname: VITE_HOST,
      serverUrl: "http://127.0.0.1:5097",
      cwd,
      corsOrigins: [],
    });
    expect(lastExecaCall()[1]).toEqual(["serve", "--port", "5097", "--hostname", VITE_HOST]);
  });

  it("写入 XDG_STATE_HOME / OPENCODE_ENV 各项；未提供的可选项不落变量", () => {
    const cwd = makeTmpDir();
    startOpenCodeWeb({
      port: 5097,
      hostname: VITE_HOST,
      serverUrl: "http://127.0.0.1:5097",
      cwd,
      contextApiUrl: "http://127.0.0.1:5097/ctx",
      logsApiUrl: "http://127.0.0.1:5097/logs",
      logFilesJson: '[{"path":"/tmp/a.log"}]',
      verbose: true,
      enableLsp: true,
      vueDevtoolsApiUrl: "http://127.0.0.1:5097/vue",
    });

    const stateDir = path.join(cwd, AIPANEL_CACHE_DIR, "opencode");
    expect(fs.existsSync(stateDir)).toBe(true);
    const { env } = lastExecaCall()[2];
    expect(env.XDG_STATE_HOME).toBe(stateDir);
    // 未给 configDir：CONFIG_DIR 指向缓存目录（opencode.json 所在处）
    expect(env[OPENCODE_ENV.CONFIG_DIR]).toBe(stateDir);
    expect(env[OPENCODE_ENV.CONTEXT_API_URL]).toBe("http://127.0.0.1:5097/ctx");
    expect(env[OPENCODE_ENV.VITE_LOGS_API_URL]).toBe("http://127.0.0.1:5097/logs");
    expect(env[OPENCODE_ENV.LOG_FILES_JSON]).toBe('[{"path":"/tmp/a.log"}]');
    expect(env[OPENCODE_ENV.VERBOSE]).toBe("1");
    expect(env[OPENCODE_ENV.ENABLE_LINT]).toBe("1");
    expect(env[OPENCODE_ENV.VUE_DEVTOOLS_API_URL]).toBe("http://127.0.0.1:5097/vue");
    expect(env[OPENCODE_ENV.WORKSPACE]).toBe(cwd);
  });

  it("显式 configDir 覆盖 CONFIG_DIR；verbose/enableLsp 缺省不设置", () => {
    const cwd = makeTmpDir();
    const configDir = makeTmpDir();
    startOpenCodeWeb({
      port: 5097,
      hostname: VITE_HOST,
      serverUrl: "http://127.0.0.1:5097",
      cwd,
      configDir,
    });

    const { env } = lastExecaCall()[2];
    expect(env[OPENCODE_ENV.CONFIG_DIR]).toBe(configDir);
    expect(env[OPENCODE_ENV.VERBOSE]).toBeUndefined();
    expect(env[OPENCODE_ENV.ENABLE_LINT]).toBeUndefined();
  });
});

describe("startOpenCodeWeb 输出采集", () => {
  it("stdout/stderr 非空行写入进程日志缓冲；MaxListeners 警告被过滤", () => {
    const cwd = makeTmpDir();
    const proc = fakeProcess();
    vi.mocked(execa).mockReturnValue(proc as never);
    startOpenCodeWeb({
      port: 5097,
      hostname: VITE_HOST,
      serverUrl: "http://127.0.0.1:5097",
      cwd,
    });

    proc.stdout.emit("data", Buffer.from("  listening on 5097 \n"));
    proc.stderr.emit("data", Buffer.from("MaxListenersExceededWarning: leak\n"));
    proc.stderr.emit("data", Buffer.from("  boom \n"));
    proc.stdout.emit("data", Buffer.from("   \n"));

    expect(mocks.addProviderStdout).toHaveBeenCalledTimes(1);
    expect(mocks.addProviderStdout).toHaveBeenCalledWith("listening on 5097");
    // MaxListeners 警告不进入日志缓冲，也不告警
    expect(mocks.addProviderStderr).toHaveBeenCalledTimes(1);
    expect(mocks.addProviderStderr).toHaveBeenCalledWith("boom");
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);
  });
});
