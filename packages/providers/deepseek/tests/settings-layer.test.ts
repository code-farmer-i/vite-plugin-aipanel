/**
 * @aipanel/provider-deepseek settings-layer（把来源 profile 的配置叠到目标 profile 上）单元测试。
 *
 * 覆盖目标：
 *   - inheritSourceOf：默认就叠（目标 ≠ 来源）、目标就是来源时不叠、`false` 关掉；
 *   - stripEntries：按顶层 `- id:` 剥块（只剥命中的那一段、不碰别的、不碰注释与嵌套行）；
 *   - writeInheritLayer：来源存在 → 写出剥好的层；来源缺失/读不动 → null 且不留文件（不阻断启动）。
 *
 * Stub 策略：fs 用真实临时目录；不 mock 任何东西（本模块只写项目缓存目录）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIPANEL_CACHE_DIR } from "@aipanel/core/node";
import { DSH_DEFAULT_PROFILE } from "../src/constants";
import {
  INHERIT_LAYER_FILENAME,
  INHERIT_SKIP_IDS,
  inheritSourceOf,
  stripEntries,
  writeInheritLayer,
} from "../src/settings-layer";

vi.mock("@aipanel/core/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aipanel/core/node")>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function writeSource(home: string, profile: string, text: string): string {
  const dir = path.join(home, "profiles", profile);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "cordis.patch.yml");
  fs.writeFileSync(file, text);
  return file;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("inheritSourceOf", () => {
  it("默认叠：目标 profile 不是 web 时，来源是 web", () => {
    expect(inheritSourceOf("workbench", DSH_DEFAULT_PROFILE)).toBe("web");
    expect(inheritSourceOf("codexlab", DSH_DEFAULT_PROFILE)).toBe("web");
  });

  it("目标就是来源（profile 默认 web）：不叠", () => {
    expect(inheritSourceOf("web", DSH_DEFAULT_PROFILE)).toBeNull();
  });

  it("`false` = 关掉", () => {
    expect(inheritSourceOf("workbench", false)).toBeNull();
  });

  it("显式指别的来源：用它", () => {
    expect(inheritSourceOf("workbench", "codexlab")).toBe("codexlab");
  });
});

describe("stripEntries", () => {
  const source = [
    "# 注释留着",
    "- id: agent-default-model",
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    "  config:",
    "    provider: huoyong",
    "- id: ui-theme",
    "  name: '@deepseek-ai/dsh-client-ui-theme'",
    "  config:",
    "    preference: dark",
    "- id: llm-deepseek",
    "  name: '@deepseek-ai/dsh-llm-deepseek'",
    "",
  ].join("\n");

  it("剥掉命中那一段（含它的嵌套行），别的原样留着", () => {
    const out = stripEntries(source, INHERIT_SKIP_IDS);
    expect(out).not.toContain("ui-theme");
    expect(out).not.toContain("preference: dark");
    expect(out).toContain("- id: agent-default-model");
    expect(out).toContain("provider: huoyong");
    expect(out).toContain("- id: llm-deepseek");
    expect(out).toContain("# 注释留着");
  });

  it("命中的是最后一段时也剥得干净（丢到文件末尾）", () => {
    const out = stripEntries(source, ["llm-deepseek"]);
    expect(out).not.toContain("llm-deepseek");
    expect(out).toContain("ui-theme");
    expect(out.trimEnd().endsWith("preference: dark")).toBe(true);
  });

  it("跳过名单为空 / 没命中：逐字不变", () => {
    expect(stripEntries(source, [])).toBe(source);
    expect(stripEntries(source, ["nope"])).toBe(source);
  });

  it("只认顶层条目：嵌套的 `- ` 不会被当成新条目头", () => {
    const nested = ["- id: keep", "  config:", "  list:", "    - id: ui-theme"].join("\n");
    expect(stripEntries(nested, ["ui-theme"])).toBe(nested);
  });
});

describe("writeInheritLayer", () => {
  it("来源存在：写到项目缓存的 dsh/ 目录，且已剥掉跳过名单", () => {
    const home = tempDir("aipanel-home-");
    const cwd = tempDir("aipanel-cwd-");
    writeSource(
      home,
      "web",
      [
        "- id: ui-theme",
        "  config:",
        "    preference: dark",
        "- id: llm-x",
        "  config: {}",
        "",
      ].join("\n"),
    );

    const file = writeInheritLayer({ cwd, home, source: "web" });

    expect(file).toBe(path.join(cwd, AIPANEL_CACHE_DIR, "dsh", INHERIT_LAYER_FILENAME));
    const written = fs.readFileSync(file as string, "utf8");
    expect(written).toContain("llm-x");
    expect(written).not.toContain("ui-theme");
  });

  it("来源不存在：返回 null，且不留下任何文件（不阻断启动）", () => {
    const home = tempDir("aipanel-home-");
    const cwd = tempDir("aipanel-cwd-");

    expect(writeInheritLayer({ cwd, home, source: "web" })).toBeNull();
    expect(fs.existsSync(path.join(cwd, AIPANEL_CACHE_DIR, "dsh", INHERIT_LAYER_FILENAME))).toBe(
      false,
    );
  });

  it("`home` 缺省时跟随 $DSH_HOME（与 dshProfileDir 同口径，不在这里另立一份）", () => {
    const home = tempDir("aipanel-home-");
    const cwd = tempDir("aipanel-cwd-");
    writeSource(home, "web", "- id: llm-x\n  config: {}\n");
    const before = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
      expect(writeInheritLayer({ cwd, source: "web" })).not.toBeNull();
    } finally {
      if (before === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = before;
    }
  });
});
