/**
 * 生成 dsh web 的 cordis overlay（用 --patch 传入，避免改动用户 profile）。
 * 注入：
 *  1. @deepseek-ai/dsh-mcp-client：把 AIPanel 的 MCP server 作为 dsh 工具来源（Streamable HTTP）
 *  2. aipanel 插件（审查工具 + 编辑后自动诊断）
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { MCP_API_PATH, createLogger } from "@aipanel/core/node";

const log = createLogger("DeepSeekProfile");

/** 组装 overlay YAML */
export function buildDshOverlay(options: {
  vitePort: number;
  cwd: string;
  pluginDistPath?: string;
  /** client 插件是否可被 dsh 解析（provider 已同步到 dsh profile）；false 时停用该行，避免 fail-loud */
  clientAvailable?: boolean;
}): string {
  const { vitePort, cwd, pluginDistPath, clientAvailable = true } = options;
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

  // 2) aipanel 宿主插件（dev 下直接用构建产物路径，file:// 引用）
  if (pluginDistPath && fs.existsSync(pluginDistPath)) {
    const pluginSpec = pathToFileURL(pluginDistPath).href;
    log.debug("injecting aipanel host plugin row", { pluginDistPath, pluginSpec });
    rows.push(
      [
        "    - id: aipanel",
        `      name: '${pluginSpec}'`,
        "      inject: [tools, subprocess]",
        "      config:",
        `        cwd: ${JSON.stringify(cwd)}`,
        "        autoDiagnose: true",
      ].join("\n"),
    );
  } else {
    log.debug("aipanel dsh-plugin dist not found, skipping host plugin row", { pluginDistPath });
  }

  // 3) aipanel 浏览器 client 插件（正式 @aipanel reference：file chip 高亮）
  // 注意：client 包的 name 须能被 dsh config-tree require.resolve 解析（不能 file://），
  // 可解析性由 provider.start() 的 ensureDshClientInstalled 保证（同步进 dsh profile node_modules）。
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

/** 将 overlay 写入文件并返回路径（供 dsh web --patch 使用） */
export function writeDshOverlay(workspaceCwd: string, overlay: string): string {
  const dir = path.join(workspaceCwd, ".aipanel");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "dsh-overlay.cordis.yml");
  fs.writeFileSync(file, overlay, "utf-8");
  log.debug("Wrote dsh overlay", { file });
  return file;
}
