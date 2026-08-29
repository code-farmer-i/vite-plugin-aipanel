/**
 * 生成 dsh web 的 cordis overlay（用 --patch 传入，避免改动用户 profile）。
 * 注入：
 *  1. @deepseek-ai/dsh-mcp-client：把 AIPanel 的 MCP server 作为 dsh 工具来源（Streamable HTTP）
 *  2. aipanel 插件（审查工具 + 编辑后自动诊断）
 */
import fs from "fs";
import path from "path";
import {
  AIPANEL_CACHE_DIR,
  MCP_API_PATH,
  CONTEXT_API_PATH,
  createLogger,
} from "@aipanel/core/node";

const log = createLogger("DeepSeekProfile");

/** 组装 overlay YAML */
export function buildDshOverlay(options: {
  vitePort: number;
  cwd: string;
  /** host 插件（@aipanel/dsh-plugin）是否已被同步到 dsh profile；false 时停用该行，避免 fail-loud */
  pluginAvailable?: boolean;
  /** client 插件（@aipanel/dsh-client）是否可被 dsh 解析（provider 已同步到 dsh profile）；false 时停用该行，避免 fail-loud */
  clientAvailable?: boolean;
  /**
   * 编辑后自动诊断开关（provider option autoDiagnose）。
   * undefined 时不写入 overlay，由 dsh-plugin 回退到 OPENCODE_ENABLE_LINT=1（与 opencode 一致）。
   */
  autoDiagnose?: boolean;
  /**
   * 诊断功能总开关（provider option enableDiagnostics）。
   * false（默认）时 host 插件不注册 run_diagnostics 工具与自动诊断逻辑。
   */
  enableDiagnostics?: boolean;
}): string {
  const {
    vitePort,
    cwd,
    pluginAvailable = true,
    clientAvailable = true,
    autoDiagnose,
    enableDiagnostics = false,
  } = options;
  const mcpUrl = `http://127.0.0.1:${vitePort}${MCP_API_PATH}`;

  const rows: string[] = [];

  // 1) MCP 工具来源
  rows.push(
    [
      "    - id: aipanel-mcp",
      "      name: '@deepseek-ai/dsh-mcp-client'",
      "      config:",
      "        serverName: aipanel",
      "        transport: streamable-http",
      `        url: ${mcpUrl}`,
      "        headers: {}",
    ].join("\n"),
  );

  // 2) aipanel 宿主插件：以 npm 包名引用（官方姿势），由 provider.start() 的
  // ensureDshPackage 同步进 dsh profile node_modules（dev 本地目录 / 生产 npm 包）。
  // 同步失败时停用该行（disabled 不触发解析），避免 dsh 因无法解析而 fail-loud 崩溃。
  rows.push(
    [
      "    - id: aipanel",
      "      name: '@aipanel/dsh-plugin'",
      ...(pluginAvailable ? [] : ["      disabled: true"]),
      "      inject: [tools]",
      "      config:",
      `        cwd: ${JSON.stringify(cwd)}`,
      `        vitePort: ${vitePort}`,
      `        contextApiPath: ${JSON.stringify(CONTEXT_API_PATH)}`,
      `        enableDiagnostics: ${enableDiagnostics ? "true" : "false"}`,
      ...(autoDiagnose !== undefined
        ? [`        autoDiagnose: ${autoDiagnose ? "true" : "false"}`]
        : []),
    ].join("\n"),
  );

  // 3) aipanel 浏览器 client 插件（正式 @aipanel reference：file chip 高亮）
  // 注意：client 包的 name 须能被 dsh config-tree require.resolve 解析（不能 file://），
  // 可解析性由 provider.start() 的 ensureDshPackage 保证（同步进 dsh profile node_modules）。
  // 同步失败时停用该行（disabled 不触发解析），避免 dsh 因无法解析而 fail-loud 崩溃。
  rows.push(
    [
      "    - id: aipanel-client",
      "      name: '@aipanel/dsh-client'",
      ...(clientAvailable ? [] : ["      disabled: true"]),
    ].join("\n"),
  );

  return ["- insert:", rows.join("\n"), ""].join("\n");
}

/** 将 overlay 写入项目缓存目录（AIPANEL_CACHE_DIR 下按 provider 分二级目录），不污染用户项目根目录。 */
export function writeDshOverlay(workspaceCwd: string, overlay: string): string {
  const dir = path.join(workspaceCwd, AIPANEL_CACHE_DIR, "dsh");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "dsh-overlay.cordis.yml");
  fs.writeFileSync(file, overlay, "utf-8");
  log.debug("Wrote dsh overlay", { file });
  return file;
}
