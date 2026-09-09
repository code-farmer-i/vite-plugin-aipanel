import { execa } from "execa";
import type { ResultPromise } from "execa";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { WebOptions } from "./types";
import {
  AIPANEL_CACHE_DIR,
  MCP_API_PATH,
  OPENCODE_ENV,
  createLogger,
  getProcessLogBuffer,
} from "@aipanel/core/node";
// 当前模块位于本包 es/ 目录；插件随本包构建到同级 es/plugins
const pluginsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "plugins");

const log = createLogger("OpenCodeWeb");

export function prepareOpenCodeRuntime(
  cwd: string,
  vitePort: number,
  viteHost: string,
  enableLsp?: boolean,
  enablePrettier?: boolean,
): string {
  const cacheDir = path.join(cwd, AIPANEL_CACHE_DIR, "opencode");

  log.debug("Setting up OpenCode runtime", { cacheDir, enableLsp });

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // 通过 opencode.json 的 plugins 字段 + file:// 协议加载插件，无需复制文件
  const sourcePluginsDir = resolveSourcePluginsDir();
  const plugins = resolvePluginEntries(sourcePluginsDir);

  // 构建 formatter 配置（enablePrettier 显式开启时启用内置格式化）
  const formatterConfig = buildFormatterConfig(enablePrettier);

  const opencodeConfigPath = path.join(cacheDir, "opencode.json");
  const config: Record<string, unknown> = {
    plugin: plugins,
    formatter: formatterConfig,
    mcp: {
      "chrome-devtools": {
        type: "remote",
        url: `http://${viteHost}:${vitePort}${MCP_API_PATH}`,
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
    verbose,
    enableLsp,
  });

  const env = buildProcessEnv(
    stateDir,
    configDir,
    contextApiUrl,
    logsApiUrl,
    logFilesJson,
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
  const stateDir = path.join(cwd, AIPANEL_CACHE_DIR, "opencode");

  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
    log.debug("Created state directory", { stateDir });
  }

  return stateDir;
}

/**
 * 构建 formatter 配置：enablePrettier 为 false 时禁用格式化，否则启用内置格式化。
 */
function buildFormatterConfig(enablePrettier?: boolean): boolean {
  if (enablePrettier === false) {
    log.debug("enablePrettier is false, formatter disabled");
    return false;
  }
  return true;
}

function resolveSourcePluginsDir(): string {
  const candidatePaths = [pluginsDir];

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
    [OPENCODE_ENV.CONFIG_DIR]: stateDir,
  };

  if (configDir) {
    env[OPENCODE_ENV.CONFIG_DIR] = configDir;
    log.debug("Set OPENCODE_CONFIG_DIR", { configDir });
  }

  if (contextApiUrl) {
    env[OPENCODE_ENV.CONTEXT_API_URL] = contextApiUrl;
    log.debug("Set OPENCODE_CONTEXT_API_URL", { contextApiUrl });
  }

  if (logsApiUrl) {
    env[OPENCODE_ENV.VITE_LOGS_API_URL] = logsApiUrl;
    log.debug("Set OPENCODE_VITE_LOGS_API_URL", { logsApiUrl });
  }

  if (logFilesJson) {
    env[OPENCODE_ENV.LOG_FILES_JSON] = logFilesJson;
    log.debug("Set OPENCODE_LOG_FILES_JSON", { logFilesJson });
  }

  if (verbose) {
    env[OPENCODE_ENV.VERBOSE] = "1";
    log.debug("Set OPENCODE_VERBOSE=1");
  }

  if (enableLsp) {
    env[OPENCODE_ENV.ENABLE_LINT] = "1";
    log.debug("Set OPENCODE_ENABLE_LINT=1");
  }

  if (vueDevtoolsApiUrl) {
    env[OPENCODE_ENV.VUE_DEVTOOLS_API_URL] = vueDevtoolsApiUrl;
    log.debug("Set OPENCODE_VUE_DEVTOOLS_API_URL", { vueDevtoolsApiUrl });
  }

  if (workspace) {
    env[OPENCODE_ENV.WORKSPACE] = workspace;
    log.debug("Set OPENCODE_WORKSPACE", { workspace });
  }

  return env;
}
