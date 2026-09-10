/**
 * dsh-plugin 宿主插件入口（applyProviderSettings / 插件元信息）单元测试。
 *
 * 覆盖目标：
 *   - 插件契约导出（name/inject）；
 *   - applyProviderSettings：无设置项时空操作、settings 服务缺失时告警、
 *     命名空间已注册时按 ns/patch 写入、命名空间延迟注册的轮询、超时告警、
 *     单命名空间写入失败只告警且不重复重试。
 *
 * Stub 策略：以最小 ctx 桩（get/effect）替代 @deepseek-ai/cordis Context，
 * settings 服务用 describe/update 桩；轮询与超时用 vi.useFakeTimers 驱动，
 * 不引入真实 dsh 运行时。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyProviderSettings, inject, name } from "../dsh-plugin/src/index";

type PluginCtx = Parameters<typeof applyProviderSettings>[0];

/** 最小 ctx 桩：仅实现 applyProviderSettings 触达的 get/effect */
function createCtx(settings: unknown) {
  const get = vi.fn((key: string) => (key === "settings" ? settings : undefined));
  const effect = vi.fn((callback: () => unknown) => {
    void callback;
  });
  return { ctx: { get, effect } as unknown as PluginCtx, get, effect };
}

/** settings 服务桩：describe 报告已注册命名空间，update 记录写入 */
function createSettings(ns: string[]) {
  const update = vi.fn(async () => undefined);
  const describeFn = vi.fn(() => ns.map((entry) => ({ ns: entry })));
  return { describe: describeFn, update };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("dsh-plugin 插件元信息", () => {
  it("name 为 aipanel，inject 声明 tools 服务", () => {
    expect(name).toBe("aipanel");
    expect(inject).toEqual(["tools"]);
  });
});

describe("applyProviderSettings", () => {
  it("未提供任何设置项时不访问 settings 服务（空操作）", () => {
    const { ctx, get } = createCtx(createSettings([]));
    applyProviderSettings(ctx, {});
    expect(get).not.toHaveBeenCalled();
  });

  it("settings 服务缺失时告警并放弃（不抛错）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, get } = createCtx(undefined);
    expect(() => applyProviderSettings(ctx, { agentPreset: "code" })).not.toThrow();
    expect(get).toHaveBeenCalledWith("settings");
    warn.mockRestore();
  });

  it("命名空间已注册时按 ns/patch 写入三项设置", () => {
    const settings = createSettings(["agent-presets", "permission", "ui-conversation"]);
    const { ctx } = createCtx(settings);

    applyProviderSettings(ctx, {
      agentPreset: "code",
      permissionPreset: "read-only",
      busyEnter: "queue",
    });

    expect(settings.update).toHaveBeenCalledTimes(3);
    expect(settings.update).toHaveBeenCalledWith("agent-presets", { default: "code" });
    expect(settings.update).toHaveBeenCalledWith("permission", { defaultPreset: "read-only" });
    expect(settings.update).toHaveBeenCalledWith("ui-conversation", { busyEnter: "queue" });
  });

  it("忽略空字符串设置项", () => {
    const settings = createSettings(["agent-presets"]);
    const { ctx } = createCtx(settings);
    applyProviderSettings(ctx, { agentPreset: "", permissionPreset: "" } as unknown as Parameters<
      typeof applyProviderSettings
    >[1]);
    expect(settings.update).not.toHaveBeenCalled();
  });

  it("命名空间延迟注册时轮询等待，注册后写入", async () => {
    vi.useFakeTimers();
    let ready = false;
    const update = vi.fn(async () => undefined);
    const settings = {
      describe: vi.fn(() => (ready ? [{ ns: "agent-presets" }] : [])),
      update,
    };
    const { ctx } = createCtx(settings);

    applyProviderSettings(ctx, { agentPreset: "code" });
    expect(update).not.toHaveBeenCalled();

    ready = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(update).toHaveBeenCalledWith("agent-presets", { default: "code" });
  });

  it("命名空间始终未注册时超时告警（不阻塞启动）", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const settings = createSettings([]);
    const { ctx } = createCtx(settings);

    applyProviderSettings(ctx, { agentPreset: "code" });
    await vi.advanceTimersByTimeAsync(20000);

    expect(settings.update).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("单命名空间写入失败只告警，不重复重试", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const update = vi.fn(async () => {
      throw new Error("write denied");
    });
    const settings = { describe: vi.fn(() => [{ ns: "agent-presets" }]), update };
    const { ctx } = createCtx(settings);

    applyProviderSettings(ctx, { agentPreset: "code" });
    await vi.advanceTimersByTimeAsync(5000);

    expect(update).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("注册清理 effect（取消未完成的轮询定时器）", () => {
    vi.useFakeTimers();
    const settings = createSettings([]);
    const { ctx, effect } = createCtx(settings);
    applyProviderSettings(ctx, { agentPreset: "code" });
    expect(effect).toHaveBeenCalledTimes(1);
    const [, label] = effect.mock.calls[0] as unknown as [unknown, string];
    expect(label).toBe("aipanel: settings apply timer");
  });
});

describe("applyProviderSettings 异步写入落地", () => {
  it("写入成功后可安全 flush（无未处理拒绝）", async () => {
    const settings = createSettings(["agent-presets"]);
    const { ctx } = createCtx(settings);
    applyProviderSettings(ctx, { agentPreset: "code" });
    await flush();
    expect(settings.update).toHaveBeenCalledTimes(1);
  });
});
