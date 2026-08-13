/**
 * MCP 代理管理器
 * 管理唯一的 chrome-devtools-mcp 进程，通过 StreamableHTTP 同时服务 OpenCode 和 HTTP API
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { createLogger } from "@vite-plugin-opencode-assistant/shared/node";

const log = createLogger("McpProxy");

/** 通过 require.resolve 解析 chrome-devtools-mcp 的实际可执行文件路径 */
function resolveChromeDevToolsMcpBin(): string {
  // 从插件自身位置解析，确保 npm/yarn/pnpm（strict mode）都能正确找到传递依赖
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve("chrome-devtools-mcp/package.json");
  const pkgDir = path.dirname(pkgJsonPath);

  const { bin } = require(pkgJsonPath) as { bin: string | Record<string, string> };
  const binEntry = typeof bin === "string" ? bin : Object.values(bin)[0];
  return path.resolve(pkgDir, binEntry);
}

export interface McpProxyOptions {
  args?: string[];
  idleTimeout?: number;
}

export class McpProxy {
  #proc: ChildProcess | null = null;
  #rl: Interface | null = null;
  #messageId = 0;
  /** 内部调用使用的高位 ID 起始值，避免与客户端 ID 冲突 */
  #internalIdBase = 1_000_000;
  #pending = new Map<number, (msg: unknown) => void>();
  #args: string[];
  #startPromise: Promise<void> | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #idleTimeout: number;
  readonly sessionId: string;
  readonly accessToken: string;

  constructor(options: McpProxyOptions = {}) {
    this.#args = options.args ?? ["--auto-connect", "--no-usage-statistics", "--no-performance-crux"];
    this.#idleTimeout = options.idleTimeout ?? 0;
    this.sessionId = crypto.randomUUID();
    this.accessToken = crypto.randomBytes(32).toString("hex");
  }

  get isRunning(): boolean {
    return this.#proc !== null && !this.#proc.killed;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = this.#doStart();
    return this.#startPromise;
  }

  async #doStart(): Promise<void> {
    log.debug("Starting MCP process", { args: this.#args });

    // 优先用本地安装的 chrome-devtools-mcp，使用 process.execPath 确保跨平台兼容
    try {
      const binPath = resolveChromeDevToolsMcpBin();
      this.#proc = spawn(process.execPath, [binPath, ...this.#args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      log.debug("Using local chrome-devtools-mcp");
    } catch {
      // resolveChromeDevToolsMcpBin 不应失败（chrome-devtools-mcp 是已声明的依赖），
      // 但极端情况（pnpm isolated mode 等）仍可能找不到，抛出明确错误
      throw new Error(
        "Cannot find chrome-devtools-mcp. Please ensure it is installed: npm install chrome-devtools-mcp",
      );
    }

    this.#rl = createInterface({ input: this.#proc.stdout! });
    this.#rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        log.debug("MCP stdout", {
          id: msg.id,
          method: msg.method,
          hasResult: !!msg.result,
          hasError: !!msg.error,
        });

        if (msg.id !== undefined && this.#pending.has(msg.id)) {
          const resolve = this.#pending.get(msg.id)!;
          this.#pending.delete(msg.id);
          log.debug("MCP pending resolved", { id: msg.id });
          resolve(msg);
        }
      } catch {
        // 非 JSON 行
      }
    });

    this.#proc.stderr?.on("data", (d: Buffer) => {
      const text = d.toString().trim();
      if (text) log.debug("[MCP stderr]", { text: text.substring(0, 200) });
    });

    this.#proc.on("close", (code) => {
      log.debug("MCP process closed", { code });
      // 拒绝所有等待中的请求
      for (const resolve of this.#pending.values()) {
        resolve({ error: { code: -32000, message: `MCP process exited with code ${code}` } });
      }
      this.#pending.clear();
      this.#proc = null;
      this.#rl = null;
      this.#startPromise = null;
    });

    // 初始化 MCP 协议
    await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vite-plugin-opencode", version: "1.0.0" },
    });

    log.debug("MCP proxy ready");
    this.#startPromise = null;
  }

  /** 转发原始 JSON-RPC 请求，保留客户端 ID */
  async forward(rawRequest: string): Promise<string> {
    await this.start();
    if (!this.#proc || !this.#proc.stdin) {
      throw new Error("MCP process not available");
    }

    this.#resetIdleTimer();

    let msg: { id?: number };
    try {
      msg = JSON.parse(rawRequest);
    } catch {
      throw new Error("Invalid JSON-RPC request");
    }

    return new Promise((resolve) => {
      const id = msg.id;
      if (id !== undefined) {
        this.#pending.set(id, (raw) => resolve(JSON.stringify(raw)));
      } else {
        // 通知类消息无 id，直接转发不等待
        this.#proc!.stdin!.write(rawRequest + "\n");
        resolve("");
        return;
      }

      this.#proc!.stdin!.write(rawRequest + "\n");
    });
  }

  /** 调用 MCP 工具 */
  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.start();
    if (!this.#proc || !this.#proc.stdin) {
      throw new Error("MCP process not available");
    }

    this.#resetIdleTimer();
    const id = this.#internalIdBase + ++this.#messageId;

    return new Promise((resolve) => {
      this.#pending.set(id, resolve);

      const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.#proc!.stdin!.write(request + "\n");
    });
  }

  /** 直接调用 chrome-devtools-mcp 底层工具（内部使用） */
  async callChromeDevTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.call("tools/call", { name, arguments: args });
  }

  /** 验证 MCP 是否可用 + 预热 CDP 连接 */
  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.callChromeDevTool("list_pages", {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  #resetIdleTimer(): void {
    if (this.#idleTimeout <= 0) return;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      log.debug("MCP process idle timeout, stopping");
      this.stop();
    }, this.#idleTimeout);
  }

  stop(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    // 拒绝所有等待中的请求
    const err = new Error("MCP server shutting down");
    for (const resolve of this.#pending.values()) {
      resolve({ error: { code: -32000, message: err.message } });
    }
    this.#pending.clear();
    if (this.#rl) {
      this.#rl.close();
      this.#rl = null;
    }
    if (this.#proc && !this.#proc.killed) {
      this.#proc.kill();
      this.#proc = null;
    }
    this.#startPromise = null;
  }
}
