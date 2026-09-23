/**
 * @aipanel/provider-deepseek profile（dsh cordis overlay 拼装）单元测试。
 *
 * buildDshOverlay 是纯字符串拼装函数（最有价值的纯逻辑面）：
 * 测试不做 YAML 解析，按行拆分后用行块前缀筛选做断言（- insert: 下的三个 - id: 行块）。
 * 所有协议路径/包名字面量均 import 源码/包导出常量做断言，避免散落硬编码：
 *   - DSH_LOOPBACK_HOST（src/constants）、MCP_API_PATH / CONTEXT_API_PATH /
 *     HOST_EVENTS_API_PATH / AIPANEL_CACHE_DIR（@aipanel/core/node）
 *   - DSH_PLUGIN_PACKAGE / DSH_CLIENT_PACKAGE（src/dsh-install）
 *
 * 诊断配置面：overlay 里没有 enableDiagnostics / autoDiagnose 两行——
 * host 插件 config 写一行 `diagnostics: <完整 DiagnosticsPolicy 的 JSON>`（JSON 即合法 YAML），
 * client 插件只取派生值 `diagnostics.exposeTool || diagnostics.auto`（是否需要诊断卡片视图）。
 * 策略默认值与归一化都引用 @aipanel/core 的单一来源（DEFAULT_DIAGNOSTICS_POLICY /
 * resolveDiagnosticsPolicy），不在用例里复刻默认值。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AIPANEL_CACHE_DIR,
  CONTEXT_API_PATH,
  DEFAULT_DIAGNOSTICS_POLICY,
  HOST_EVENTS_API_PATH,
  MCP_API_PATH,
  resolveDiagnosticsPolicy,
} from "@aipanel/core/node";
import type { DiagnosticsPolicy } from "@aipanel/core";
import { DSH_CLIENT_PACKAGE, DSH_PLUGIN_PACKAGE } from "../src/dsh-install";
import { buildDshOverlay, writeDshOverlay } from "../src/profile";

const VITE_PORT = 5173;
const VITE_HOST = "127.0.0.1";
const CWD = "/tmp/demo-project";

type OverlayOptions = Partial<Omit<Parameters<typeof buildDshOverlay>[0], "diagnostics">> & {
  /** 用户面只写要覆盖的字段（与 providerOptions.diagnostics 同形），用例内归一化成完整策略 */
  diagnostics?: Partial<DiagnosticsPolicy>;
};

/** 镜像 provider 侧归一化：默认值单一来源 = @aipanel/core 的 DEFAULT_DIAGNOSTICS_POLICY */
const resolvePolicy = (overrides: Partial<DiagnosticsPolicy> = {}): DiagnosticsPolicy =>
  resolveDiagnosticsPolicy([DEFAULT_DIAGNOSTICS_POLICY, overrides]);

/** 固定 vitePort/viteHost/cwd 的 overlay 构造（diagnostics 必填参数由用例给出） */
function overlayFor(options: OverlayOptions = {}): string {
  const { diagnostics, vitePort = VITE_PORT, viteHost = VITE_HOST, cwd = CWD, ...rest } = options;
  return buildDshOverlay({
    ...rest,
    vitePort,
    viteHost,
    cwd,
    diagnostics: resolvePolicy(diagnostics),
  });
}

/** overlay 内的一个插件行块（- insert: 下每个 "- id: xxx" 到下一个 "- id:" 之间的行） */
interface OverlayBlock {
  id: string;
  lines: string[];
}

/** 按行块前缀拆解 overlay（不解析 YAML，仅按缩进/行内容分组） */
function overlayBlocks(overlay: string): OverlayBlock[] {
  const blocks: OverlayBlock[] = [];
  for (const line of overlay.split("\n")) {
    const m = /^ {4}- id: (.+)$/.exec(line);
    if (m) {
      blocks.push({ id: m[1].trim(), lines: [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks;
}

function blockById(overlay: string, id: string): OverlayBlock {
  const block = overlayBlocks(overlay).find((b) => b.id === id);
  if (!block) throw new Error("missing overlay block: " + id);
  return block;
}

describe("buildDshOverlay 输出骨架", () => {
  it("以 '- insert:' 开头、结尾留空行，且行块顺序为 mcp → host(aipanel) → client(aipanel-client)", () => {
    const overlay = overlayFor();
    expect(overlay.startsWith("- insert:\n")).toBe(true);
    // 结尾空行：末行为空字符串
    expect(overlay.endsWith("\n")).toBe(true);
    expect(overlay.split("\n").pop()).toBe("");

    expect(overlayBlocks(overlay).map((b) => b.id)).toEqual([
      "aipanel-mcp",
      "aipanel",
      "aipanel-client",
    ]);
  });
});

describe("buildDshOverlay aipanel-mcp（MCP 工具来源）行块", () => {
  it("以 streamable-http 引用 AIPanel MCP server，URL 由 DSH_LOOPBACK_HOST + vitePort + MCP_API_PATH 拼装", () => {
    const block = blockById(overlayFor(), "aipanel-mcp");
    expect(block.lines).toEqual(
      expect.arrayContaining([
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config:",
        "        serverName: aipanel",
        "        transport: streamable-http",
        `        url: http://${VITE_HOST}:${VITE_PORT}${MCP_API_PATH}`,
        "        headers: {}",
      ]),
    );
    // 端口参与 URL 拼装（换端口应出现在 url 行）
    const other = blockById(overlayFor({ vitePort: 8088 }), "aipanel-mcp");
    expect(other.lines).toContain(`        url: http://${VITE_HOST}:8088${MCP_API_PATH}`);
  });
});

describe("buildDshOverlay host 插件（aipanel / DSH_PLUGIN_PACKAGE）行块", () => {
  it("默认（pluginAvailable/eventsToken/预设均缺省）输出注入行与 config，且不写 disabled", () => {
    const block = blockById(overlayFor(), "aipanel");
    expect(block.lines).toEqual(
      expect.arrayContaining([
        `      name: ${JSON.stringify(DSH_PLUGIN_PACKAGE)}`,
        "      inject: [tools]",
        "      config:",
        `        cwd: ${JSON.stringify(CWD)}`,
        // viteHost 单一来源：overlay 必须把运行时 viteHost 下发进 host 插件 config（回推目标）
        `        viteHost: ${JSON.stringify(VITE_HOST)}`,
        `        vitePort: ${VITE_PORT}`,
        `        contextApiPath: ${JSON.stringify(CONTEXT_API_PATH)}`,
      ]),
    );
    // 默认可用：不得出现 disabled: true / 旧开关行 / eventsToken / eventsPath / providerOptions
    expect(block.lines).not.toContain("      disabled: true");
    for (const key of [
      "autoDiagnose",
      "eventsToken",
      "eventsPath",
      "agentPreset",
      "permissionPreset",
      "busyEnter",
    ]) {
      expect(block.lines.some((l) => l.includes(key))).toBe(false);
    }
  });

  it("默认策略下 host config 写一行 diagnostics = 完整 DEFAULT_DIAGNOSTICS_POLICY 的 JSON", () => {
    const block = blockById(overlayFor(), "aipanel");
    expect(block.lines).toContain(
      `        diagnostics: ${JSON.stringify(DEFAULT_DIAGNOSTICS_POLICY)}`,
    );
    // 旧的 enableDiagnostics / autoDiagnose 行已删除：host 侧只有这一行诊断配置
    expect(block.lines.some((l) => l.trimStart().startsWith("enableDiagnostics:"))).toBe(false);
    expect(block.lines.some((l) => l.trimStart().startsWith("autoDiagnose:"))).toBe(false);
  });

  it("自定义 diagnostics（{auto:false, severity:'error'}）归一化后原样写进 host config", () => {
    const custom: Partial<DiagnosticsPolicy> = { auto: false, severity: "error" };
    const block = blockById(overlayFor({ diagnostics: custom }), "aipanel");
    const line = `        diagnostics: ${JSON.stringify(resolvePolicy(custom))}`;
    expect(block.lines).toContain(line);
    // 未配置的字段取默认（checks 仍为内置检查），已配置字段原样落地
    expect(line).toContain('"auto":false');
    expect(line).toContain('"severity":"error"');
    expect(line).toContain(JSON.stringify(DEFAULT_DIAGNOSTICS_POLICY.checks));
  });

  it("pluginAvailable=false 时输出 'disabled: true'（host 行块内），默认 true 不出现", () => {
    const disabled = blockById(overlayFor({ pluginAvailable: false }), "aipanel");
    expect(disabled.lines).toContain("      disabled: true");
    expect(disabled.lines).toContain("      inject: [tools]");

    const enabled = blockById(overlayFor({ pluginAvailable: true }), "aipanel");
    expect(enabled.lines).not.toContain("      disabled: true");
  });

  it("eventsToken 存在时写 eventsToken/eventsPath（JSON.stringify 形式，路径引用 HOST_EVENTS_API_PATH）；缺省不写", () => {
    const block = blockById(overlayFor({ eventsToken: "tk_a1b2c3" }), "aipanel");
    expect(block.lines).toContain(`        eventsToken: ${JSON.stringify("tk_a1b2c3")}`);
    expect(block.lines).toContain(`        eventsPath: ${JSON.stringify(HOST_EVENTS_API_PATH)}`);
  });

  it("agentPreset/permissionPreset/busyEnter 存在时才写，值用 JSON.stringify 形式", () => {
    const block = blockById(
      overlayFor({ agentPreset: "code", permissionPreset: "read-only", busyEnter: "queue" }),
      "aipanel",
    );
    expect(block.lines).toContain(`        agentPreset: ${JSON.stringify("code")}`);
    expect(block.lines).toContain(`        permissionPreset: ${JSON.stringify("read-only")}`);
    expect(block.lines).toContain(`        busyEnter: ${JSON.stringify("queue")}`);
  });
});

describe("buildDshOverlay client 插件（aipanel-client / DSH_CLIENT_PACKAGE）行块", () => {
  it("默认（clientAvailable=true、theme=auto）输出 name/config，不写 theme、不写 disabled", () => {
    const block = blockById(overlayFor(), "aipanel-client");
    expect(block.lines).toEqual(
      expect.arrayContaining([
        `      name: ${JSON.stringify(DSH_CLIENT_PACKAGE)}`,
        "      config:",
        "        enableDiagnostics: true",
      ]),
    );
    expect(block.lines).not.toContain("      disabled: true");
    expect(block.lines.some((l) => l.includes("theme"))).toBe(false);
  });

  it("client 的 enableDiagnostics 是派生值 exposeTool || auto（工具或自动诊断任一开启即需卡片视图）", () => {
    const cases: { diagnostics: Partial<DiagnosticsPolicy>; expected: boolean }[] = [
      { diagnostics: {}, expected: true },
      { diagnostics: { exposeTool: false }, expected: true },
      { diagnostics: { auto: false }, expected: true },
      { diagnostics: { exposeTool: false, auto: false }, expected: false },
    ];
    for (const { diagnostics, expected } of cases) {
      const block = blockById(overlayFor({ diagnostics }), "aipanel-client");
      expect(block.lines).toContain(`        enableDiagnostics: ${expected}`);
    }
  });

  it("clientAvailable=false 时输出 'disabled: true'（client 行块内）；host 行块不受影响", () => {
    const overlay = overlayFor({ clientAvailable: false });
    const client = blockById(overlay, "aipanel-client");
    expect(client.lines).toContain("      disabled: true");
    const host = blockById(overlay, "aipanel");
    expect(host.lines).not.toContain("      disabled: true");
  });

  it("theme light/dark 写入对应行（JSON.stringify 形式）；'auto' 不干预（不写）", () => {
    for (const theme of ["light", "dark"] as const) {
      const block = blockById(overlayFor({ theme }), "aipanel-client");
      expect(block.lines).toContain(`        theme: ${JSON.stringify(theme)}`);
    }
    const auto = blockById(overlayFor({ theme: "auto" }), "aipanel-client");
    expect(auto.lines.some((l) => l.includes("theme"))).toBe(false);
  });
});

describe("writeDshOverlay 落盘位置", () => {
  it("写入 <workspaceCwd>/AIPANEL_CACHE_DIR/dsh/dsh-overlay.cordis.yml 并返回该路径，内容往返一致", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-dsh-overlay-"));
    try {
      const overlay = overlayFor({ cwd: tmpRoot });
      const file = writeDshOverlay(tmpRoot, overlay);
      const expectedDir = path.join(tmpRoot, AIPANEL_CACHE_DIR, "dsh");
      const expectedFile = path.join(expectedDir, "dsh-overlay.cordis.yml");
      expect(file).toBe(expectedFile);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, "utf-8")).toBe(overlay);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
