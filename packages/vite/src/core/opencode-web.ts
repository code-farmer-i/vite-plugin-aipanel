import { execa } from "execa";
import type { ResultPromise } from "execa";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import type { WebOptions } from "@vite-plugin-opencode-assistant/shared";
import { createLogger, getProcessLogBuffer } from "@vite-plugin-opencode-assistant/shared/node";

const require = createRequire(path.join(process.cwd(), "package.json"));
const packageDir = resolvePackageDir();

const log = createLogger("OpenCodeWeb");

export function prepareOpenCodeRuntime(cwd: string): string {
  const cacheDir = path.join(cwd, "node_modules", ".cache", "opencode");

  log.debug("Setting up OpenCode runtime", { cacheDir });

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // 通过 opencode.json 的 plugins 字段 + file:// 协议加载插件，无需复制文件
  const sourcePluginsDir = resolveSourcePluginsDir();
  const plugins = resolvePluginEntries(sourcePluginsDir);

  const opencodeConfigPath = path.join(cacheDir, "opencode.json");
  fs.writeFileSync(
    opencodeConfigPath,
    JSON.stringify(
      {
        plugin: plugins,
        mcp: {
          "chrome-devtools": {
            type: "local",
            command: ["npx", "-y", "chrome-devtools-mcp@latest", "--autoConnect"],
            enabled: true,
          },
        },
      },
      null,
      2,
    ),
  );

  log.debug("OpenCode runtime ready", {
    cacheDir,
    opencodeConfigPath,
    pluginCount: plugins.length,
  });

  return cacheDir;
}

export function startOpenCodeWeb(options: WebOptions): ResultPromise {
  const { port, hostname, cwd, configDir, corsOrigins, contextApiUrl, logsApiUrl, logFilesJson } =
    options;
  const stateDir = createStateDirectory(cwd);

  log.debug("Building process environment", {
    stateDir,
    configDir,
    contextApiUrl,
    logsApiUrl,
    logFilesJson,
  });

  const env = buildProcessEnv(stateDir, configDir, contextApiUrl, logsApiUrl, logFilesJson);
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

  return env;
}
