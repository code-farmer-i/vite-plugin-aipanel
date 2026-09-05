/**
 * 生成 dsh web 的 cordis overlay（用 --patch 传入，避免改动用户 profile）。
 * 注入：
 *  1. @deepseek-ai/dsh-mcp-client：把 AIPanel 的 MCP server 作为 dsh 工具来源（Streamable HTTP）
 *  2. @aipanel/dsh-plugin（宿主）：run_diagnostics 审查工具、编辑后自动诊断、事件中继，
 *     providerOptions 设置（agentPreset/permissionPreset/busyEnter）经其 config 下发，
 *     由插件在 dsh boot 期经 ctx.settings 应用。
 *  3. @aipanel/dsh-client（浏览器）：@ 菜单 chip、会话聚焦（sessions.open）、主题/布局/选中元素；
 *     诊断开关与主题初值经其 config 下发。
 */
import fs from "fs";
import path from "path";
import {
  AIPANEL_CACHE_DIR,
  MCP_API_PATH,
  CONTEXT_API_PATH,
  HOST_EVENTS_API_PATH,
  createLogger,
} from "@aipanel/core/node";
import type { AIPanelWidgetTheme } from "@aipanel/core";
import type { DeepSeekBusyEnter, DeepSeekPermissionPreset } from "./types";

const log = createLogger("DeepSeekProfile");

/** 组装 overlay YAML */
export function buildDshOverlay(options: {
  vitePort: number;
  cwd: string;
  /** host 插件（@aipanel/dsh-plugin）是否已同步到 dsh profile；false 时停用该行，避免 fail-loud */
  pluginAvailable?: boolean;
  /** client 插件（@aipanel/dsh-client）是否可被 dsh 解析；false 时停用该行，避免 fail-loud */
  clientAvailable?: boolean;
  /**
   * 编辑后自动诊断开关（provider option autoDiagnose）。
   * undefined 时不写入 overlay，由 dsh-plugin 回退到 OPENCODE_ENABLE_LINT=1（与 opencode 一致）。
   */
  autoDiagnose?: boolean;
  /**
   * 宿主事件推送令牌（core 每轮启动随机）：随 plugin config 注入 dsh-plugin，
   * 使其把归一化 ProviderEvent POST 到 core 的 HOST_EVENTS_API_PATH。
   */
  eventsToken?: string;
  /**
   * 诊断功能总开关（provider option enableDiagnostics）。
   * true（默认，对齐 opencode enableLsp）时 host 插件注册 run_diagnostics 工具与自动诊断逻辑，
   * client 插件注册诊断卡片视图。
   */
  enableDiagnostics?: boolean;
  /** provider option agentPreset：dsh settings agent-presets.default（随 host 插件 config 下发） */
  agentPreset?: string;
  /** provider option permissionPreset：dsh settings permission.defaultPreset（单一来源 ./types） */
  permissionPreset?: DeepSeekPermissionPreset;
  /** provider option busyEnter：dsh settings ui-conversation.busyEnter（单一来源 ./types） */
  busyEnter?: DeepSeekBusyEnter;
  /** AIPanel 侧主题偏好（applyConfig.theme，AIPanelWidgetTheme）；auto 不干预（沿用 dsh 持久化偏好），light/dark 随 client 插件 config 下发 */
  theme?: AIPanelWidgetTheme;
}): string {
  const {
    vitePort,
    cwd,
    pluginAvailable = true,
    clientAvailable = true,
    autoDiagnose,
    enableDiagnostics = true,
    eventsToken,
    agentPreset,
    permissionPreset,
    busyEnter,
    theme = "auto",
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
      ...(eventsToken
        ? [
            `        eventsToken: ${JSON.stringify(eventsToken)}`,
            `        eventsPath: ${JSON.stringify(HOST_EVENTS_API_PATH)}`,
          ]
        : []),
      // providerOptions → 启动期设置（dsh-plugin/applyProviderSettings 经 ctx.settings 写入）
      ...(agentPreset !== undefined ? [`        agentPreset: ${JSON.stringify(agentPreset)}`] : []),
      ...(permissionPreset !== undefined
        ? [`        permissionPreset: ${JSON.stringify(permissionPreset)}`]
        : []),
      ...(busyEnter !== undefined ? [`        busyEnter: ${JSON.stringify(busyEnter)}`] : []),
    ].join("\n"),
  );

  // 3) aipanel 浏览器 client 插件（页内全部行为的承载：@ 菜单 chip / 会话聚焦 / 主题 / 布局 / 选中元素）
  // 注意：client 包的 name 须能被 dsh config-tree require.resolve 解析（不能 file://），
  // 可解析性由 provider.start() 的 ensureDshPackage 保证（同步进 dsh profile node_modules）。
  // 同步失败时停用该行（disabled 不触发解析），避免 dsh 因无法解析而 fail-loud 崩溃。
  rows.push(
    [
      "    - id: aipanel-client",
      "      name: '@aipanel/dsh-client'",
      ...(clientAvailable ? [] : ["      disabled: true"]),
      "      config:",
      `        enableDiagnostics: ${enableDiagnostics ? "true" : "false"}`,
      ...(theme !== "auto" ? [`        theme: ${JSON.stringify(theme)}`] : []),
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
