import { execa } from "execa";
import type { ResultPromise } from "execa";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { WebOptions } from "./types";
import { OPENCODE_CACHE_DIR } from "./constants";
import {
  MCP_API_PATH,
  VSCODE_EXTENSION_PORT,
  ENV_VSCODE_PORT,
  createLogger,
  getProcessLogBuffer,
  createPackageRequire,
  resolvePackageDir,
} from "@aipanel/core/node";

const require = createPackageRequire();
const packageDir = resolvePackageDir("@aipanel/opencode-plugins");

const log = createLogger("OpenCodeWeb");

export function prepareOpenCodeRuntime(
  cwd: string,
  vitePort: number,
  enableLsp?: boolean,
  enablePrettier?: boolean,
): string {
  const cacheDir = path.join(cwd, OPENCODE_CACHE_DIR);

  log.debug("Setting up OpenCode runtime", { cacheDir, enableLsp });

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // 通过 opencode.json 的 plugins 字段 + file:// 协议加载插件，无需复制文件
  const sourcePluginsDir = resolveSourcePluginsDir();
  const plugins = resolvePluginEntries(sourcePluginsDir);

  // 构建 formatter 配置（VS Code 扩展优先，CLI 降级）
  const formatterConfig = buildFormatterConfig(enablePrettier);

  const opencodeConfigPath = path.join(cacheDir, "opencode.json");
  const config: Record<string, unknown> = {
    plugin: plugins,
    formatter: formatterConfig,
    mcp: {
      "chrome-devtools": {
        type: "remote",
        url: `http://localhost:${vitePort}${MCP_API_PATH}`,
      },
    },
  };

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
    enableLsp,
    vueDevtoolsApiUrl,
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
    enableLsp,
  });

  const env = buildProcessEnv(
    stateDir,
    configDir,
    contextApiUrl,
    logsApiUrl,
    logFilesJson,
    enableBlockOnError,
    verbose,
    enableLsp,
    vueDevtoolsApiUrl,
    cwd,
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
    shell: true,
  });

  proc.stdout?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      log.debug("[OpenCode stdout]", { output });
      getProcessLogBuffer().addProviderStdout(output);
    }
  });

  proc.stderr?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      // 忽略 SolidJS MaxListeners 警告（OpenCode 内部问题，不影响功能）
      if (output.includes("MaxListenersExceededWarning")) return;
      log.warn("[OpenCode stderr]", { output });
      getProcessLogBuffer().addProviderStderr(output);
    }
  });

  return proc;
}

function createStateDirectory(cwd: string): string {
  const stateDir = path.join(cwd, OPENCODE_CACHE_DIR);

  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
    log.debug("Created state directory", { stateDir });
  }

  return stateDir;
}

/**
 * 构建 formatter 配置
 * enablePrettier 为 false 时禁用所有格式化功能
 * 否则注册 format_bridge，VS Code 可用时优先，不可用时内置 prettier 兜底
 */
function buildFormatterConfig(enablePrettier?: boolean): boolean | Record<string, unknown> {
  if (enablePrettier === false) {
    log.debug("enablePrettier is false, formatter disabled");
    return false;
  }

  const bridgePath = resolveFormatBridgePath();
  if (!bridgePath) {
    log.debug("format-bridge not found, using built-in formatters");
    return true;
  }

  log.debug("Format bridge configured");

  if (!isFormatServiceRunning()) {
    log.debug("VS Code format service not running, using built-in formatters only");
    return true;
  }

  log.debug("VS Code format service detected, enabling bridge");
  log.info("已连接 VS Code 格式化服务");

  // 覆盖常见代码文件，桥接脚本内部判断能否格式化，不支持的静默跳过
  const extensions = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".vue",
    ".svelte",
    ".astro",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".pcss",
    ".html",
    ".htm",
    ".xml",
    ".svg",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".md",
    ".mdx",
    ".graphql",
    ".gql",
  ];

  return {
    format_bridge: {
      command: ["node", bridgePath, "$FILE"],
      extensions,
    },
  };
}

let _formatServiceRunning: boolean | undefined;

/** HTTP 健康检查，确认 VS Code 扩展服务已启动 */
function isFormatServiceRunning(): boolean {
  if (_formatServiceRunning !== undefined) return _formatServiceRunning;
  try {
    require("child_process").execSync(
      `node -e "const h=require('http');h.get('http://127.0.0.1:${VSCODE_EXTENSION_PORT}/health',r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"`,
      { timeout: 500, stdio: "ignore" },
    );
    _formatServiceRunning = true;
  } catch {
    _formatServiceRunning = false;
  }
  return _formatServiceRunning;
}

/**
 * 解析 VS Code 格式化桥接脚本路径
 */
function resolveFormatBridgePath(): string | undefined {
  // 直接通过 vite 包自身解析桥接脚本路径
  const viteEntry = require.resolve("vite-plugin-aipanel");
  const bridgePath = path.resolve(path.dirname(viteEntry), "utils", "format-bridge.cjs");
  if (fs.existsSync(bridgePath)) return bridgePath;
  return undefined;
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

/** 已迁移到 MCP 的插件（不再通过 OpenCode 插件机制加载，避免与 MCP 工具重复） */
const MIGRATED_TO_MCP_PLUGINS = new Set(["vue-devtools.js", "vite-logs.js", "service-logs.js"]);

function resolvePluginEntries(sourceDir: string): string[] {
  const files = fs
    .readdirSync(sourceDir)
    .filter((f) => f.endsWith(".js") && !MIGRATED_TO_MCP_PLUGINS.has(f));

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
  enableLsp?: boolean,
  vueDevtoolsApiUrl?: string,
  workspace?: string,
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

  if (enableLsp) {
    env.OPENCODE_ENABLE_LINT = "1";
    log.debug("Set OPENCODE_ENABLE_LINT=1");
  }

  if (vueDevtoolsApiUrl) {
    env.OPENCODE_VUE_DEVTOOLS_API_URL = vueDevtoolsApiUrl;
    log.debug("Set OPENCODE_VUE_DEVTOOLS_API_URL", { vueDevtoolsApiUrl });
  }

  if (workspace) {
    env.OPENCODE_WORKSPACE = workspace;
    log.debug("Set OPENCODE_WORKSPACE", { workspace });
  }

  if (isFormatServiceRunning()) {
    env[ENV_VSCODE_PORT] = String(VSCODE_EXTENSION_PORT);
    log.debug("Set OPENCODE_VSCODE_PORT");
  }

  return env;
}
