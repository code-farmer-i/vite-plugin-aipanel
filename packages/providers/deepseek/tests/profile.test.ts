/**
 * @aipanel/provider-deepseek profile（dsh cordis overlay 拼装）单元测试。
 *
 * buildDshOverlay 是纯字符串拼装函数（最有价值的纯逻辑面）：
 * 测试不做 YAML 解析，按行拆分后用行块前缀筛选做断言（- insert: 下的三个 - id: 行块）。
 * 所有协议路径/包名字面量均 import 源码/包导出常量做断言，避免散落硬编码：
 *   - DSH_LOOPBACK_HOST（src/constants）、MCP_API_PATH / CONTEXT_API_PATH /
 *     HOST_EVENTS_API_PATH / AIPANEL_CACHE_DIR（@aipanel/core/node）
 *   - DSH_PLUGIN_PACKAGE / DSH_CLIENT_PACKAGE（src/dsh-install）
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AIPANEL_CACHE_DIR,
  CONTEXT_API_PATH,
  HOST_EVENTS_API_PATH,
  MCP_API_PATH,
} from "@aipanel/core/node";
import { DSH_CLIENT_PACKAGE, DSH_PLUGIN_PACKAGE } from "../src/dsh-install";
import { buildDshOverlay, writeDshOverlay } from "../src/profile";

const VITE_PORT = 5173;
const VITE_HOST = "127.0.0.1";
const CWD = "/tmp/demo-project";

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
    const overlay = buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: CWD });
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
    const block = blockById(
      buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: CWD }),
      "aipanel-mcp",
    );
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
    const other = blockById(
      buildDshOverlay({ vitePort: 8088, viteHost: VITE_HOST, cwd: CWD }),
      "aipanel-mcp",
    );
    expect(other.lines).toContain(`        url: http://${VITE_HOST}:8088${MCP_API_PATH}`);
  });
});

describe("buildDshOverlay host 插件（aipanel / DSH_PLUGIN_PACKAGE）行块", () => {
  it("默认（pluginAvailable/autoDiagnose/eventsToken/预设均缺省）输出注入行与 config，且不写 disabled", () => {
    const block = blockById(
      buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: CWD }),
      "aipanel",
    );
    expect(block.lines).toEqual(
      expect.arrayContaining([
        `      name: ${JSON.stringify(DSH_PLUGIN_PACKAGE)}`,
        "      inject: [tools]",
        "      config:",
        `        cwd: ${JSON.stringify(CWD)}`,
        `        vitePort: ${VITE_PORT}`,
        `        contextApiPath: ${JSON.stringify(CONTEXT_API_PATH)}`,
        "        enableDiagnostics: true",
      ]),
    );
    // 默认可用：不得出现 disabled: true / autoDiagnose / eventsToken / eventsPath / providerOptions
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

  it("pluginAvailable=false 时输出 'disabled: true'（host 行块内），默认 true 不出现", () => {
    const disabled = blockById(
      buildDshOverlay({
        vitePort: VITE_PORT,
        viteHost: VITE_HOST,
        cwd: CWD,
        pluginAvailable: false,
      }),
      "aipanel",
    );
    expect(disabled.lines).toContain("      disabled: true");
    expect(disabled.lines).toContain("      inject: [tools]");

    const enabled = blockById(
      buildDshOverlay({
        vitePort: VITE_PORT,
        viteHost: VITE_HOST,
        cwd: CWD,
        pluginAvailable: true,
      }),
      "aipanel",
    );
    expect(enabled.lines).not.toContain("      disabled: true");
  });

  it("enableDiagnostics=false 时输出 'enableDiagnostics: false'", () => {
    for (const value of [false, true]) {
      const block = blockById(
        buildDshOverlay({
          vitePort: VITE_PORT,
          viteHost: VITE_HOST,
          cwd: CWD,
          enableDiagnostics: value,
        }),
        "aipanel",
      );
      expect(block.lines).toContain(`        enableDiagnostics: ${value}`);
    }
  });

  it("autoDiagnose=true/false 写入对应行；undefined（缺省）不写（由 dsh-plugin 回退 OPENCODE_ENABLE_LINT）", () => {
    const on = blockById(
      buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: CWD, autoDiagnose: true }),
      "aipanel",
    );
    expect(on.lines).toContain("        autoDiagnose: true");
    const off = blockById(
      buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: CWD, autoDiagnose: false }),
      "aipanel",
    );
    expect(off.lines).toContain("        autoDiagnose: false");
    // undefined：默认用例已断言不出现 autoDiagnose
  });

  it("eventsToken 存在时写 eventsToken/eventsPath（JSON.stringify 形式，路径引用 HOST_EVENTS_API_PATH）；缺省不写", () => {
    const block = blockById(
      buildDshOverlay({
        vitePort: VITE_PORT,
        viteHost: VITE_HOST,
        cwd: CWD,
        eventsToken: "tk_a1b2c3",
      }),
      "aipanel",
    );
    expect(block.lines).toContain(`        eventsToken: ${JSON.stringify("tk_a1b2c3")}`);
    expect(block.lines).toContain(`        eventsPath: ${JSON.stringify(HOST_EVENTS_API_PATH)}`);
  });

  it("agentPreset/permissionPreset/busyEnter 存在时才写，值用 JSON.stringify 形式", () => {
    const block = blockById(
      buildDshOverlay({
        vitePort: VITE_PORT,
        viteHost: VITE_HOST,
        cwd: CWD,
        agentPreset: "code",
        permissionPreset: "read-only",
        busyEnter: "queue",
      }),
      "aipanel",
    );
    expect(block.lines).toContain(`        agentPreset: ${JSON.stringify("code")}`);
    expect(block.lines).toContain(`        permissionPreset: ${JSON.stringify("read-only")}`);
    expect(block.lines).toContain(`        busyEnter: ${JSON.stringify("queue")}`);
  });
});

describe("buildDshOverlay client 插件（aipanel-client / DSH_CLIENT_PACKAGE）行块", () => {
  it("默认（clientAvailable=true、theme=auto）输出 name/config，不写 theme、不写 disabled", () => {
    const block = blockById(
      buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: CWD }),
      "aipanel-client",
    );
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

  it("clientAvailable=false 时输出 'disabled: true'（client 行块内）；host 行块不受影响", () => {
    const overlay = buildDshOverlay({
      vitePort: VITE_PORT,
      viteHost: VITE_HOST,
      cwd: CWD,
      clientAvailable: false,
    });
    const client = blockById(overlay, "aipanel-client");
    expect(client.lines).toContain("      disabled: true");
    const host = blockById(overlay, "aipanel");
    expect(host.lines).not.toContain("      disabled: true");
  });

  it("theme light/dark 写入对应行（JSON.stringify 形式）；'auto' 不干预（不写）", () => {
    for (const theme of ["light", "dark"] as const) {
      const block = blockById(
        buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: CWD, theme }),
        "aipanel-client",
      );
      expect(block.lines).toContain(`        theme: ${JSON.stringify(theme)}`);
    }
    const auto = blockById(
      buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: CWD, theme: "auto" }),
      "aipanel-client",
    );
    expect(auto.lines.some((l) => l.includes("theme"))).toBe(false);
  });
});

describe("writeDshOverlay 落盘位置", () => {
  it("写入 <workspaceCwd>/AIPANEL_CACHE_DIR/dsh/dsh-overlay.cordis.yml 并返回该路径，内容往返一致", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-dsh-overlay-"));
    try {
      const overlay = buildDshOverlay({ vitePort: VITE_PORT, viteHost: VITE_HOST, cwd: tmpRoot });
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
