/**
 * @aipanel/provider-deepseek dsh-install（dsh 侧插件安装/检测）单元测试。
 *
 * 覆盖目标：
 *   - 路径解析：dev workspace 包产物探测（resolveDevDshPackageSource）、profile 目录解析
 *     （显式 home / $DSH_HOME / ~/.dsh 回退）；
 *   - 可解析性/版本读取：scoped 包 node_modules 路径、package.json 异常降级为 null；
 *   - ensureDshPackage：安装命令与 DSH_HOME 透传、安装后不可解析降级 false、
 *     版本与 provider 不同步时告警但仍视为成功、安装抛错降级 false。
 *
 * Stub 策略：fs 用真实临时目录，execa 与 @aipanel/core/node 的日志面 vi.mock 隔离；
 * 不真实执行 dsh plugin add。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import {
  DSH_CLIENT_PACKAGE,
  DSH_PLUGIN_PACKAGE,
  dshProfileDir,
  ensureDshPackage,
  isDshPackageInstalled,
  readPackageVersion,
  readProviderVersion,
  resolveDevDshPackageSource,
} from "../src/dsh-install";

const mocks = vi.hoisted(() => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@aipanel/core/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aipanel/core/node")>();
  return {
    ...actual,
    createLogger: () => ({
      debug: mocks.logDebug,
      info: vi.fn(),
      warn: mocks.logWarn,
      error: mocks.logError,
    }),
  };
});

vi.mock("execa", () => ({ execa: vi.fn() }));

const tmpDirs: string[] = [];

function makeTmpDir(prefix = "aipanel-dsh-install-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** 在 profile 的 node_modules 下写入某 scoped 包的 package.json */
function installPackage(profileDir: string, packageName: string, version: unknown): void {
  const pkgDir = path.join(profileDir, "node_modules", ...packageName.split("/"));
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ version }));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("resolveDevDshPackageSource", () => {
  it("dev workspace 下存在 package.json 与产物文件时返回该目录", () => {
    const root = makeTmpDir();
    const providerDir = path.join(root, "provider");
    const esDir = path.join(providerDir, "es");
    const clientDir = path.join(providerDir, "dsh-client");
    fs.mkdirSync(esDir, { recursive: true });
    fs.mkdirSync(path.join(clientDir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(clientDir, "package.json"), "{}");
    fs.writeFileSync(path.join(clientDir, "lib", "client.js"), "export {};");

    const metaUrl = pathToFileURL(path.join(esDir, "index.js")).href;
    expect(resolveDevDshPackageSource(metaUrl, "dsh-client", "lib/client.js")).toBe(clientDir);
  });

  it("缺少 package.json 或产物文件时返回 null（生产安装路径）", () => {
    const root = makeTmpDir();
    const esDir = path.join(root, "provider", "es");
    fs.mkdirSync(esDir, { recursive: true });
    const metaUrl = pathToFileURL(path.join(esDir, "index.js")).href;

    // dsh-client 目录完全不存在
    expect(resolveDevDshPackageSource(metaUrl, "dsh-client", "lib/client.js")).toBeNull();

    // 只有 package.json、缺产物
    const pluginDir = path.join(root, "provider", "dsh-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "package.json"), "{}");
    expect(resolveDevDshPackageSource(metaUrl, "dsh-plugin", "dist/index.js")).toBeNull();
  });
});

describe("dshProfileDir", () => {
  it("显式 home 优先；否则取 $DSH_HOME；再否则回退 ~/.dsh", () => {
    expect(dshProfileDir("/tmp/custom-home")).toBe(
      path.join("/tmp/custom-home", "profiles", "web"),
    );

    const original = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = "/tmp/env-home";
      expect(dshProfileDir()).toBe(path.join("/tmp/env-home", "profiles", "web"));

      delete process.env.DSH_HOME;
      vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
      expect(dshProfileDir()).toBe(path.join("/home/tester", ".dsh", "profiles", "web"));
    } finally {
      if (original === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = original;
    }
  });
});

describe("包可解析性与版本读取", () => {
  it("isDshPackageInstalled 按 scoped 包拆分的 node_modules 路径判断", () => {
    const profileDir = makeTmpDir();
    expect(isDshPackageInstalled(profileDir, DSH_CLIENT_PACKAGE)).toBe(false);
    installPackage(profileDir, DSH_CLIENT_PACKAGE, "1.2.19");
    expect(isDshPackageInstalled(profileDir, DSH_CLIENT_PACKAGE)).toBe(true);
    expect(isDshPackageInstalled(profileDir, DSH_PLUGIN_PACKAGE)).toBe(false);
  });

  it("readPackageVersion 返回字符串版本；缺失/非法/非字符串版本均返回 null", () => {
    const profileDir = makeTmpDir();
    expect(readPackageVersion(profileDir, DSH_CLIENT_PACKAGE)).toBeNull();

    installPackage(profileDir, DSH_CLIENT_PACKAGE, "1.2.19");
    expect(readPackageVersion(profileDir, DSH_CLIENT_PACKAGE)).toBe("1.2.19");

    installPackage(profileDir, DSH_PLUGIN_PACKAGE, 123);
    expect(readPackageVersion(profileDir, DSH_PLUGIN_PACKAGE)).toBeNull();

    const brokenDir = path.join(profileDir, "node_modules", "@aipanel", "dsh-broken");
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "package.json"), "{not json");
    expect(readPackageVersion(profileDir, "@aipanel/dsh-broken")).toBeNull();
  });

  it("readProviderVersion 读取源码上一级 package.json；缺失时返回 null", () => {
    const root = makeTmpDir();
    const pkgRoot = path.join(root, "provider");
    const libDir = path.join(pkgRoot, "lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, "package.json"), JSON.stringify({ version: "9.9.9" }));

    expect(readProviderVersion(pathToFileURL(path.join(libDir, "index.js")).href)).toBe("9.9.9");
    expect(
      readProviderVersion(pathToFileURL(path.join(root, "missing", "index.js")).href),
    ).toBeNull();
  });
});

describe("ensureDshPackage", () => {
  beforeEach(() => {
    vi.mocked(execa).mockResolvedValue({} as never);
  });

  it("经 dsh plugin --profile web add 安装，成功且可解析时返回 true", async () => {
    const profileDir = makeTmpDir();
    installPackage(profileDir, DSH_CLIENT_PACKAGE, "1.2.19");

    await expect(
      ensureDshPackage(profileDir, DSH_CLIENT_PACKAGE, "/dev/dsh-client", "/tmp/home"),
    ).resolves.toBe(true);

    expect(execa).toHaveBeenCalledTimes(1);
    const [command, args, options] = vi.mocked(execa).mock.calls[0] as unknown as [
      string,
      string[],
      { reject: boolean; shell: boolean; env: Record<string, string> },
    ];
    expect(command).toBe("dsh");
    expect(args).toEqual(["plugin", "--profile", "web", "add", "/dev/dsh-client"]);
    expect(options.reject).toBe(true);
    expect(options.shell).toBe(true);
    expect(options.env.DSH_HOME).toBe("/tmp/home");
  });

  it("安装命令成功但包仍不可解析时降级为 false 并告警", async () => {
    const profileDir = makeTmpDir();
    await expect(
      ensureDshPackage(profileDir, DSH_CLIENT_PACKAGE, DSH_CLIENT_PACKAGE),
    ).resolves.toBe(false);
    expect(mocks.logWarn.mock.calls.some((c) => String(c[0]).includes("not resolvable"))).toBe(
      true,
    );
  });

  it("版本与当前 provider 不同步时告警，但仍返回 true", async () => {
    const profileDir = makeTmpDir();
    installPackage(profileDir, DSH_PLUGIN_PACKAGE, "1.0.0");

    await expect(
      ensureDshPackage(profileDir, DSH_PLUGIN_PACKAGE, DSH_PLUGIN_PACKAGE, undefined, "1.2.19"),
    ).resolves.toBe(true);
    const mismatch = mocks.logWarn.mock.calls.find((c) =>
      String(c[0]).includes("out of sync with provider"),
    );
    expect(mismatch).toBeDefined();
    expect(mismatch?.[1]).toMatchObject({
      install: `dsh plugin --profile web add ${DSH_PLUGIN_PACKAGE}@1.2.19`,
    });

    // 版本一致时不告警
    mocks.logWarn.mockClear();
    installPackage(profileDir, DSH_PLUGIN_PACKAGE, "1.2.19");
    await expect(
      ensureDshPackage(profileDir, DSH_PLUGIN_PACKAGE, DSH_PLUGIN_PACKAGE, undefined, "1.2.19"),
    ).resolves.toBe(true);
    expect(mocks.logWarn).not.toHaveBeenCalled();
  });

  it("安装命令抛错时降级为 false（不阻塞启动）", async () => {
    const profileDir = makeTmpDir();
    vi.mocked(execa).mockRejectedValue(new Error("pnpm add failed"));

    await expect(
      ensureDshPackage(profileDir, DSH_CLIENT_PACKAGE, DSH_CLIENT_PACKAGE),
    ).resolves.toBe(false);
    const warn = mocks.logWarn.mock.calls.find((c) => String(c[0]).includes("failed to install"));
    expect(warn?.[1]).toMatchObject({ error: "pnpm add failed" });
  });
});
