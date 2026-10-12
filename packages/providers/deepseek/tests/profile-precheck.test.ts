/**
 * @aipanel/provider-deepseek profile 预检的**行为**测试（provider.start 顶部那道闸）。
 *
 * 为什么值得单独测：这道闸的全部价值在**顺序** —— 它必须排在 `ensureDshPackage` 之前。
 * `dsh plugin --profile <名> add …` 在 profile 缺失时会自己初始化一个空壳，
 * 那一步一旦先发生，后面只会表现为"启动超时"，而且机器上留下一个看起来存在的 profile。
 * 所以这里既断言错误内容，也断言 **execa 一次都没被调用**、**没有冒出 profile 目录**。
 *
 * Stub 策略：home 用真实临时目录（profile 目录自己造），execa 用 vi.mock 隔离并断言"没被调用"。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { DSH_LOOPBACK_HOST, DSH_DEFAULT_PORT } from "../src/constants";
import { DeepSeekWebProvider } from "../src/provider";

vi.mock("execa", () => ({ execa: vi.fn() }));

vi.mock("@aipanel/core/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aipanel/core/node")>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const roots: string[] = [];

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aipanel-precheck-"));
  roots.push(dir);
  return dir;
}

function provider(home: string, profile: string): DeepSeekWebProvider {
  return new DeepSeekWebProvider(
    { hostname: DSH_LOOPBACK_HOST },
    { getWebPort: () => DSH_DEFAULT_PORT, getProxyPort: () => 6097 },
    { home, profile },
  );
}

function startOptions() {
  return {
    port: DSH_DEFAULT_PORT,
    hostname: DSH_LOOPBACK_HOST,
    cwd: "/work/proj",
    corsOrigins: [],
    vitePort: 5273,
    viteHost: DSH_LOOPBACK_HOST,
  };
}

beforeEach(() => {
  vi.mocked(execa).mockClear();
});

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("provider.start 的 profile 预检", () => {
  it("profile 不存在：当场拒绝，且不建 profile、不跑任何命令", async () => {
    const home = tempHome();
    const profileDir = path.join(home, "profiles", "workbench");

    await expect(provider(home, "workbench").start(startOptions())).rejects.toThrow(/还不存在/);

    expect(vi.mocked(execa)).not.toHaveBeenCalled();
    expect(fs.existsSync(profileDir)).toBe(false);
  });

  it("空壳 profile（只有 dsh-base）：拒绝信息说清缺 web 应用 bundle 与现有 bundles", async () => {
    const home = tempHome();
    const profileDir = path.join(home, "profiles", "workbench");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, "package.json"),
      JSON.stringify({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } } }),
    );

    await expect(provider(home, "workbench").start(startOptions())).rejects.toThrow(
      /没有 Web 应用 bundle/,
    );
    await expect(provider(home, "workbench").start(startOptions())).rejects.toThrow(
      /@deepseek-ai\/dsh-base/,
    );
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("报错里给绝对路径（用户照着就能去看/去建）", async () => {
    const home = tempHome();
    const profileDir = path.join(home, "profiles", "workbench");
    await expect(provider(home, "workbench").start(startOptions())).rejects.toThrow(
      new RegExp(profileDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});
