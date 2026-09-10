/**
 * @aipanel/provider-opencode system（CLI 薄封装）单元测试。
 *
 * checkOpenCodeInstalled / getOpenCodeVersion / killOrphanOpenCodeProcesses 只是
 * @aipanel/core/node 同名函数的薄封装：vi.mock 该依赖后断言转发参数与返回值透传，
 * 与同仓 deepseek system 测试保持一致的写法。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkCliInstalled, getCliVersion, killOrphanCliProcesses } from "@aipanel/core/node";
import {
  checkOpenCodeInstalled,
  getOpenCodeVersion,
  killOrphanOpenCodeProcesses,
} from "../src/system";

vi.mock("@aipanel/core/node", () => ({
  checkCliInstalled: vi.fn(),
  getCliVersion: vi.fn(),
  killOrphanCliProcesses: vi.fn(),
}));

describe("CLI 薄封装转发 @aipanel/core/node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checkOpenCodeInstalled 转发 checkCliInstalled('opencode') 并透传结果", async () => {
    vi.mocked(checkCliInstalled).mockResolvedValue(true);
    await expect(checkOpenCodeInstalled()).resolves.toBe(true);
    vi.mocked(checkCliInstalled).mockResolvedValue(false);
    await expect(checkOpenCodeInstalled()).resolves.toBe(false);
    expect(checkCliInstalled).toHaveBeenCalledTimes(2);
    expect(checkCliInstalled).toHaveBeenCalledWith("opencode");
  });

  it("getOpenCodeVersion 转发 getCliVersion('opencode') 并透传结果", async () => {
    vi.mocked(getCliVersion).mockResolvedValue("1.18.0");
    await expect(getOpenCodeVersion()).resolves.toBe("1.18.0");
    vi.mocked(getCliVersion).mockResolvedValue(null);
    await expect(getOpenCodeVersion()).resolves.toBeNull();
    expect(getCliVersion).toHaveBeenCalledTimes(2);
    expect(getCliVersion).toHaveBeenCalledWith("opencode");
  });

  it("killOrphanOpenCodeProcesses 转发 killOrphanCliProcesses 及匹配选项并透传结果", async () => {
    vi.mocked(killOrphanCliProcesses).mockResolvedValue(2);
    await expect(killOrphanOpenCodeProcesses()).resolves.toBe(2);
    expect(killOrphanCliProcesses).toHaveBeenCalledTimes(1);
    expect(killOrphanCliProcesses).toHaveBeenCalledWith("opencode", {
      match: "opencode",
      winName: "opencode.exe",
      label: "opencode",
    });
  });
});
