import { execa, type ResultPromise } from "execa";
import { createLogger, getProcessLogBuffer } from "@aipanel/core/node";

const log = createLogger("DeepSeekWeb");

/**
 * dsh 启动时打印的 launch token 捕获器。
 * dsh web 升级后在索引页与 /api 走 browser-session 认证：启动成功会在 stdout 打印
 * `dsh web: http://127.0.0.1:3080/?token=<launchToken>`，首次访问需携带该 token 换取签名 cookie。
 * 本类在子进程 stdout 就该 URL 打洞解析 token，供 DeepSeekAPI 与代理做认证。
 */
export class LaunchToken {
  private token?: string;
  /** 首次超时后缓存失败：本启动已不可能再打印 token，后续 wait 直接快速失败 */
  private failure?: Error;
  private waiters: {
    resolve: (token: string) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  /** 从子进程输出写入已解析的 token（幂等：只接受第一个） */
  set(token: string): void {
    if (this.token !== undefined) return;
    this.token = token;
    this.failure = undefined;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.resolve(token);
    }
    this.waiters = [];
  }

  /** 已解析的 token（未就绪时 undefined） */
  get(): string | undefined {
    return this.token;
  }

  /** 等待 token 就绪（默认 20s 超时；未打印则抛错并快速失败，调用方降级处理） */
  wait(timeoutMs = 20000): Promise<string> {
    if (this.token !== undefined) return Promise.resolve(this.token);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(
          `dsh launch token was not captured from stdout within ${timeoutMs}ms (dsh >= 0.1.2 should print the "dsh web: http://127.0.0.1:<port>/?token=..." URL)`,
        );
        this.failure = err;
        for (const w of this.waiters) {
          clearTimeout(w.timer);
          w.reject(err);
        }
        this.waiters = [];
        reject(err);
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }
}

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
  /** launch token 捕获器：进程 stdout 解析出 ?token= 后写入，供认证使用 */
  launchToken?: LaunchToken;
}

/**
 * 启动 dsh web 服务。
 * dsh web 是自包含单进程（web server + agent runtime 同进程），无需额外配置/插件注入。
 * 也无需 API key 即可启动 UI 壳。
 */
export function startDeepSeekWeb(options: DeepSeekWebOptions): ResultPromise {
  const { port, hostname, cwd, patchPath, home, verbose, launchToken } = options;

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

  // 累积 stdout 以跨 chunk 解析 launch token（启动 URL 可能被拆包写入）
  let stdoutBuffer = "";
  proc.stdout?.on("data", (data) => {
    const chunk = data.toString();
    stdoutBuffer += chunk;
    // 仅保留末尾足够长度，防止长时间运行内存无限增长
    if (stdoutBuffer.length > 4096) stdoutBuffer = stdoutBuffer.slice(-4096);
    if (launchToken && !launchToken.get()) {
      const match = stdoutBuffer.match(/[?&]token=([A-Za-z0-9_-]+)/);
      if (match) {
        launchToken.set(match[1]);
        log.debug("[dsh] captured launch token");
      }
    }
    const output = chunk.trim();
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
