/**
 * @aipanel/provider-deepseek profile-check（目标 dsh profile 的通用预检）单元测试。
 *
 * 覆盖目标：
 *   - 判据只用 dsh 自己的 profile 契约：目录在不在 / `dsh.profile.bundles` 里有没有 web 应用；
 *   - 空壳 profile（只有 dsh-base，正是 `dsh plugin --profile <新名>` 会建出来的那种）必须判不过；
 *   - package.json 坏掉、bundles 不是字符串数组等异常一律降级为"判不过"，不抛；
 *   - 报错文案带上 profile 名、绝对路径与现有 bundles（用户要能照着修）；
 *   - 超时诊断上下文给出 profile 与 bundles。
 *
 * Stub 策略：fs 用真实临时目录；不 mock 任何东西（本模块不碰 execa / 日志）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DSH_WEB_APP_BUNDLE,
  describeDshProfile,
  inspectDshProfile,
  profileProblemText,
} from "../src/profile-check";

const roots: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-profile-"));
  roots.push(dir);
  return dir;
}

function profileWith(bundles: unknown, name = "probe"): string {
  const dir = path.join(tempDir(), "profiles", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: `dsh-profile-${name}`, dsh: { profile: { bundles } } }),
  );
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("inspectDshProfile", () => {
  it("web profile（bundles 含 web 应用）：通过", () => {
    const dir = profileWith(["@deepseek-ai/dsh-base", DSH_WEB_APP_BUNDLE]);
    const check = inspectDshProfile(dir);
    expect(check.ok).toBe(true);
    expect(check.problem).toBeNull();
    expect(check.bundles).toEqual(["@deepseek-ai/dsh-base", DSH_WEB_APP_BUNDLE]);
  });

  it("dsh 自己建出来的空壳 profile（只有 dsh-base）：不通过，且把现有 bundles 报出来", () => {
    const dir = profileWith(["@deepseek-ai/dsh-base"]);
    const check = inspectDshProfile(dir);
    expect(check.ok).toBe(false);
    expect(check.problem).toBe("no-web-app");
    expect(check.bundles).toEqual(["@deepseek-ai/dsh-base"]);
  });

  it("目录/清单不存在：判 missing（不是抛）", () => {
    const missing = path.join(tempDir(), "profiles", "nope");
    const check = inspectDshProfile(missing);
    expect(check.ok).toBe(false);
    expect(check.problem).toBe("missing");
    expect(check.manifest).toBe(path.join(missing, "package.json"));
  });

  it("package.json 坏掉：判 missing（不是抛）", () => {
    const dir = path.join(tempDir(), "profiles", "broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), "{ 不是 json");
    expect(inspectDshProfile(dir).problem).toBe("missing");
  });

  it("bundles 不是字符串数组：只留字符串项，缺 web 应用仍判不过", () => {
    const dir = profileWith(["@deepseek-ai/dsh-base", 42, null]);
    const check = inspectDshProfile(dir);
    expect(check.bundles).toEqual(["@deepseek-ai/dsh-base"]);
    expect(check.problem).toBe("no-web-app");
  });

  it("声明里压根没有 dsh.profile：判不过，不抛", () => {
    const dir = path.join(tempDir(), "profiles", "bare");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(inspectDshProfile(dir).problem).toBe("no-web-app");
  });
});

describe("profileProblemText", () => {
  it("说清三件事：哪个 profile / 绝对路径 / 现有 bundles，并给出怎么修", () => {
    const dir = profileWith(["@deepseek-ai/dsh-base"], "workbench");
    const text = profileProblemText(inspectDshProfile(dir), dir, "workbench");
    expect(text).toContain('"workbench"');
    expect(text).toContain(dir);
    expect(text).toContain("@deepseek-ai/dsh-base");
    expect(text).toContain("--from-default-profile");
  });

  it("目录不存在时：说的是「还不存在」，不是「缺 bundle」", () => {
    const dir = path.join(tempDir(), "profiles", "nope");
    const text = profileProblemText(inspectDshProfile(dir), dir, "nope");
    expect(text).toContain("还不存在");
    expect(text).not.toContain("没有 Web 应用 bundle");
  });
});

describe("describeDshProfile", () => {
  it("给出 profile 名、目录与 bundles（给 launch token 超时用）", () => {
    const dir = profileWith(["@deepseek-ai/dsh-base", DSH_WEB_APP_BUNDLE], "workbench");
    const text = describeDshProfile(dir, "workbench");
    expect(text).toContain("profile: workbench");
    expect(text).toContain(dir);
    expect(text).toContain(DSH_WEB_APP_BUNDLE);
  });

  it("读不到清单时照实说读不到，不抛", () => {
    const dir = path.join(tempDir(), "profiles", "nope");
    expect(describeDshProfile(dir, "nope")).toContain("（读不到）");
  });
});
