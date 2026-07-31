import { execa } from "execa";
import type { ResultPromise } from "execa";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import type { WebOptions } from "@vite-plugin-opencode-assistant/shared";
import { MCP_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import { createLogger, getProcessLogBuffer } from "@vite-plugin-opencode-assistant/shared/node";

const require = createRequire(path.join(process.cwd(), "package.json"));
const packageDir = resolvePackageDir();

const log = createLogger("OpenCodeWeb");

export function prepareOpenCodeRuntime(
  cwd: string,
  vitePort: number,
  mcpToken: string,
  enableLsp?: boolean,
): string {
  const cacheDir = path.join(cwd, "node_modules", ".cache", "opencode");

  log.debug("Setting up OpenCode runtime", { cacheDir, enableLsp });

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // 通过 opencode.json 的 plugins 字段 + file:// 协议加载插件，无需复制文件
  const sourcePluginsDir = resolveSourcePluginsDir();
  const plugins = resolvePluginEntries(sourcePluginsDir);

  // 构建 LSP 配置
  // OpenCode 内置 ESLint LSP 有已知 bug (https://github.com/anomalyco/opencode/issues/23911)，
  // 因此禁用它，改用 block-on-error 插件的 Node API 处理 ESLint
  const lspConfig = buildLspConfig(cwd);

  const opencodeConfigPath = path.join(cacheDir, "opencode.json");
  const config: Record<string, unknown> = {
    plugin: plugins,
    mcp: {
      "chrome-devtools": {
        type: "remote",
        url: `http://localhost:${vitePort}${MCP_API_PATH}?token=${mcpToken}`,
      },
    },
  };

  if (enableLsp) {
    config.lsp = lspConfig;
    log.info("LSP diagnostics enabled (all built-in servers, ESLint excluded)");
  } else {
    log.debug("LSP diagnostics disabled");
  }

  fs.writeFileSync(opencodeConfigPath, JSON.stringify(config, null, 2));

  log.debug("OpenCode runtime ready", {
    cacheDir,
    opencodeConfigPath,
    pluginCount: plugins.length,
  });

  return cacheDir;
}

export function startOpenCodeWeb(options: WebOptions): ResultPromise {
  const {
    port,
    hostname,
    cwd,
    configDir,
    corsOrigins,
    contextApiUrl,
    logsApiUrl,
    logFilesJson,
    enableBlockOnError,
    verbose,
  } = options;
  const stateDir = createStateDirectory(cwd);

  log.debug("Building process environment", {
    stateDir,
    configDir,
    contextApiUrl,
    logsApiUrl,
    logFilesJson,
    enableBlockOnError,
    verbose,
  });

  const env = buildProcessEnv(
    stateDir,
    configDir,
    contextApiUrl,
    logsApiUrl,
    logFilesJson,
    enableBlockOnError,
    verbose,
  );
  const args = ["serve", "--port", String(port), "--hostname", hostname];

  if (corsOrigins && corsOrigins.length > 0) {
    corsOrigins.forEach((origin: string) => {
      args.push("--cors", origin);
    });
    log.debug("CORS origins added", { origins: corsOrigins });
  }

  log.debug("Spawning OpenCode process", {
    command: "opencode",
    args: args.join(" "),
    cwd,
  });

  const proc = execa("opencode", args, {
    cwd,
    env,
    reject: false,
    cleanup: true,
  });

  proc.stdout?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      log.debug("[OpenCode stdout]", { output });
      getProcessLogBuffer().addOpenCodeStdout(output);
    }
  });

  proc.stderr?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      // 忽略 SolidJS MaxListeners 警告（OpenCode 内部问题，不影响功能）
      if (output.includes("MaxListenersExceededWarning")) return;
      log.warn("[OpenCode stderr]", { output });
      getProcessLogBuffer().addOpenCodeStderr(output);
    }
  });

  return proc;
}

function createStateDirectory(cwd: string): string {
  const stateDir = path.join(cwd, "node_modules", ".cache", "opencode");

  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
    log.debug("Created state directory", { stateDir });
  }

  return stateDir;
}

function resolvePackageDir(): string {
  const entryPath = require.resolve("@vite-plugin-opencode-assistant/opencode");
  return path.dirname(path.dirname(entryPath));
}

/**
 * 从插件自身的 node_modules 中解析 typescript-language-server 的 CLI 入口
 */
function resolveTsServerCli(): string | undefined {
  try {
    const pluginRequire = createRequire(path.join(packageDir, "package.json"));
    const pkgDir = path.dirname(pluginRequire.resolve("typescript-language-server/package.json"));
    // ESM 入口优先
    const cliMjs = path.join(pkgDir, "lib", "cli.mjs");
    if (fs.existsSync(cliMjs)) return cliMjs;
    // CJS fallback
    const cliJs = path.join(pkgDir, "lib", "cli.js");
    if (fs.existsSync(cliJs)) return cliJs;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 从用户项目中解析 TypeScript 的 tsserver.js 路径
 */
function resolveUserTsServer(cwd: string): string | undefined {
  try {
    const userRequire = createRequire(path.join(cwd, "package.json"));
    return userRequire.resolve("typescript/lib/tsserver.js");
  } catch {
    return undefined;
  }
}

/**
 * 构建 OpenCode LSP 配置
 * - 禁用内置 ESLint LSP（有已知 bug，改用 block-on-error 插件 Node API 处理）
 * - TypeScript 使用自定义 tsserver 路径（优先用户项目安装的版本）
 * - Vue 使用项目安装的 @vue/language-server（绕过 OpenCode 内置 Vue LSP 不生效问题）
 */
function buildLspConfig(cwd: string): Record<string, unknown> {
  const lspConfig: Record<string, unknown> = {
    // 禁用 OpenCode 内置 ESLint LSP
    eslint: { disabled: true },
  };

  const tsCli = resolveTsServerCli();
  if (tsCli) {
    const tsserver = resolveUserTsServer(cwd);
    lspConfig.typescript = {
      command: ["node", tsCli, "--stdio"],
      ...(tsserver ? { initialization: { tsserver: { path: tsserver } } } : {}),
    };
    if (!tsserver) {
      log.warn("TypeScript tsserver.js not found, TS LSP may use built-in version");
    }
  } else {
    log.warn("typescript-language-server not found in plugin bundle, TS LSP uses built-in");
  }

  const vueCli = resolveVueServerCli();
  if (vueCli) {
    lspConfig.vue = {
      command: ["node", vueCli, "--stdio"],
    };
    const tsdk = resolveTsdkPath(cwd);
    if (tsdk) {
      (lspConfig.vue as Record<string, unknown>).initialization = {
        typescript: { tsdk },
        vue: { hybridMode: false },
      };
      log.debug("Vue LSP configured", { cli: vueCli, tsdk });
    } else {
      log.debug("Vue LSP configured (without tsdk)", { cli: vueCli });
    }
  } else {
    log.debug("vue-language-server not found in project, Vue LSP uses built-in");
  }

  return lspConfig;
}

/**
 * 从插件自身的 node_modules 中解析 @vue/language-server 的 CLI 入口
 */
function resolveVueServerCli(): string | undefined {
  try {
    const pluginRequire = createRequire(path.join(packageDir, "package.json"));
    const pkgDir = path.dirname(pluginRequire.resolve("@vue/language-server/package.json"));
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"));
    const bin =
      typeof pkg.bin === "string"
        ? pkg.bin
        : pkg.bin?.vueLanguageServer || pkg.bin?.["vue-language-server"];
    if (bin) {
      const binPath = path.resolve(pkgDir, bin);
      if (fs.existsSync(binPath)) return binPath;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析用户项目 TypeScript 的 lib 目录路径（tsdk）
 */
function resolveTsdkPath(cwd: string): string | undefined {
  try {
    const userRequire = createRequire(path.join(cwd, "package.json"));
    const tsserver = userRequire.resolve("typescript/lib/tsserver.js");
    return path.dirname(tsserver);
  } catch {
    return undefined;
  }
}

function resolveSourcePluginsDir(): string {
  const candidatePaths = [path.join(packageDir, "es", "plugins")];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0];
}

function resolvePluginEntries(sourceDir: string): string[] {
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".js"));

  const entries = files.map((file) => {
    const absolutePath = path.join(sourceDir, file);
    return pathToFileURL(absolutePath).href;
  });

  log.debug("Resolved plugin entries", { count: entries.length, entries });
  return entries;
}

function buildProcessEnv(
  stateDir: string,
  configDir?: string,
  contextApiUrl?: string,
  logsApiUrl?: string,
  logFilesJson?: string,
  enableBlockOnError?: boolean,
  verbose?: boolean,
): Record<string, string> {
  const env: Record<string, string> = {
    ...(Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as Record<string, string>),
    XDG_STATE_HOME: stateDir,
    // 指向缓存目录，OpenCode 通过 opencode.json 中 plugins 字段加载插件
    OPENCODE_CONFIG_DIR: stateDir,
  };

  if (configDir) {
    env.OPENCODE_CONFIG_DIR = configDir;
    log.debug("Set OPENCODE_CONFIG_DIR", { configDir });
  }

  if (contextApiUrl) {
    env.OPENCODE_CONTEXT_API_URL = contextApiUrl;
    log.debug("Set OPENCODE_CONTEXT_API_URL", { contextApiUrl });
  }

  if (logsApiUrl) {
    env.OPENCODE_VITE_LOGS_API_URL = logsApiUrl;
    log.debug("Set OPENCODE_VITE_LOGS_API_URL", { logsApiUrl });
  }

  if (logFilesJson) {
    env.OPENCODE_LOG_FILES_JSON = logFilesJson;
    log.debug("Set OPENCODE_LOG_FILES_JSON", { logFilesJson });
  }

  if (enableBlockOnError) {
    env.OPENCODE_BLOCK_ON_ERROR = "1";
    log.debug("Set OPENCODE_BLOCK_ON_ERROR=1");
  }

  if (verbose) {
    env.OPENCODE_VERBOSE = "1";
    log.debug("Set OPENCODE_VERBOSE=1");
  }

  return env;
}
