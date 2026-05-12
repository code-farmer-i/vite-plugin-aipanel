import { execa } from "execa";
import type { ResultPromise } from "execa";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import type { WebOptions } from "@vite-plugin-opencode-assistant/shared";
import { createLogger, getProcessLogBuffer } from "@vite-plugin-opencode-assistant/shared";

const require = createRequire(path.join(process.cwd(), "package.json"));
const packageDir = resolvePackageDir();

const log = createLogger("OpenCodeWeb");

export function prepareOpenCodeRuntime(cwd: string): string {
  const cacheDir = path.join(cwd, "node_modules", ".cache", "opencode");
  const pluginsDir = path.join(cacheDir, "plugins");

  log.debug("Setting up OpenCode runtime", { cacheDir, pluginsDir });

  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
  }

  // Copy all plugin files from source to target
  const sourcePluginsDir = resolveSourcePluginsDir();
  copyPluginFiles(sourcePluginsDir, pluginsDir);

  const mcpConfigPath = path.join(cacheDir, "opencode.json");
  fs.writeFileSync(
    mcpConfigPath,
    JSON.stringify(
      {
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
    pluginsDir,
    mcpConfigPath,
  });

  return cacheDir;
}

export function startOpenCodeWeb(options: WebOptions): ResultPromise {
  const { port, hostname, cwd, configDir, corsOrigins, contextApiUrl, logsApiUrl, logFilesJson } =
    options;
  const stateDir = createStateDirectory(cwd);
  const pluginsDir = path.join(stateDir, "plugins");

  // Build plugin paths (comma-separated for OPENCODE_PLUGINS)
  const pluginPaths = [
    path.join(pluginsDir, "page-context.js"),
    path.join(pluginsDir, "vite-logs.js"),
  ];

  // Add service-logs plugin if logFiles are configured
  if (logFilesJson) {
    pluginPaths.push(path.join(pluginsDir, "service-logs.js"));
  }

  const pluginPathsStr = pluginPaths.join(",");

  log.debug("Building process environment", {
    stateDir,
    configDir,
    contextApiUrl,
    logsApiUrl,
    logFilesJson,
    pluginPathsStr,
  });

  const env = buildProcessEnv(
    stateDir,
    configDir,
    contextApiUrl,
    logsApiUrl,
    pluginPathsStr,
    logFilesJson,
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

function copyPluginFiles(sourceDir: string, targetDir: string): void {
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".js") || f.endsWith(".d.ts"));

  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    fs.copyFileSync(sourcePath, targetPath);
    log.debug("Plugin file copied", { source: sourcePath, target: targetPath });
  }

  log.debug("All plugin files copied", { count: files.length, files });
}

function buildProcessEnv(
  stateDir: string,
  configDir?: string,
  contextApiUrl?: string,
  logsApiUrl?: string,
  pluginPaths?: string,
  logFilesJson?: string,
): Record<string, string> {
  const env: Record<string, string> = {
    ...(Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as Record<string, string>),
    XDG_STATE_HOME: stateDir,
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

  if (pluginPaths) {
    env.OPENCODE_PLUGINS = pluginPaths;
    log.debug("Set OPENCODE_PLUGINS", { pluginPaths });
  }

  if (logFilesJson) {
    env.OPENCODE_LOG_FILES_JSON = logFilesJson;
    log.debug("Set OPENCODE_LOG_FILES_JSON", { logFilesJson });
  }

  return env;
}
