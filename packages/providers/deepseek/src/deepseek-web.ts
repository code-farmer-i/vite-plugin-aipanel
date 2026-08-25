import { execa, type ResultPromise } from "execa";
import { createLogger, getProcessLogBuffer } from "@aipanel/core/node";

const log = createLogger("DeepSeekWeb");

export interface DeepSeekWebOptions {
  /** 服务端口 */
  port: number;
  /** 服务主机（dsh 只接受 127.0.0.1，见 DSH_LOOPBACK_HOST） */
  hostname: string;
  /** 工作目录 */
  cwd: string;
  /** cordis overlay 文件路径（--patch 注入 MCP client / aipanel 插件） */
  patchPath?: string;
  /** dsh 数据目录（透传 DSH_HOME；缺省跟随 $DSH_HOME / ~/.dsh） */
  home?: string;
  /** 启用 verbose 模式 */
  verbose?: boolean;
}

/**
 * 启动 dsh web 服务。
 * dsh web 是自包含单进程（web server + agent runtime 同进程），无需额外配置/插件注入。
 * 也无需 API key 即可启动 UI 壳。
 */
export function startDeepSeekWeb(options: DeepSeekWebOptions): ResultPromise {
  const { port, hostname, cwd, patchPath, home, verbose } = options;

  // dsh 0.1.x 的 --patch 是 launcher 级选项：必须放在 --profile web 之后、
  // 转发给 web app 的参数之前（`dsh web --patch` 会被 variadic args 吞进 app 参数，
  // app 不认 --patch 而报 unknown option 退出）。
  const args = ["--profile", "web"];
  if (patchPath) {
    args.push("--patch", patchPath);
  }
  args.push(
    "--port",
    String(port),
    "--host",
    hostname,
    // 由插件内嵌 iframe 展示，禁止 dsh 自动打开默认浏览器
    "--no-open",
  );

  log.debug("Spawning dsh web process", {
    command: "dsh",
    args: args.join(" "),
    cwd,
    home: home ?? process.env.DSH_HOME,
  });

  const proc = execa("dsh", args, {
    cwd,
    reject: false,
    cleanup: true,
    shell: true,
    env: {
      ...process.env,
      ...(home ? { DSH_HOME: home } : {}),
      ...(verbose ? { VERBOSE: "1" } : {}),
    },
  } as Parameters<typeof execa>[1]);

  // dsh 启动后若退出，记录退出码（崩溃排查关键：fail-loud 插件/CLI 错误都会在这里暴露）
  proc
    .then((result) => {
      if (result.exitCode !== 0) {
        log.warn("[dsh exited]", { exitCode: result.exitCode, signal: result.signal });
      } else {
        log.debug("[dsh exited]", { exitCode: result.exitCode });
      }
    })
    .catch((e) => {
      log.error("[dsh spawn failed]", { error: e instanceof Error ? e.message : String(e) });
    });

  proc.stdout?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      log.debug("[dsh stdout]", { output });
      getProcessLogBuffer().addProviderStdout(output);
    }
  });

  proc.stderr?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      log.warn("[dsh stderr]", { output });
      getProcessLogBuffer().addProviderStderr(output);
    }
  });

  return proc;
}
