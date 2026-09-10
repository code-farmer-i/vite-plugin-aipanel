/**
 * useServiceStatus 单元测试
 * 覆盖 updateStatusFromTask 状态机：idle→starting、ready 复位、chrome_mcp_failed→partial、
 * 失败类→failed、loadingText 映射、setStarting；console（spy console.debug）。
 * 状态机实现没有生命周期钩子，直接调用即可。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { SERVICE_STARTUP_TASKS, setVerbose } from "@aipanel/core";
import { useServiceStatus } from "../src/composables/useServiceStatus";

afterEach(() => {
  vi.restoreAllMocks();
  // 恢复 logger 全局配置，避免影响同 worker 内其他测试文件
  setVerbose(false);
});

describe("useServiceStatus", () => {
  it("初始状态：idle / 空任务 / 默认加载文案", () => {
    const s = useServiceStatus();
    expect(s.serviceStatus.value).toBe("idle");
    expect(s.currentTask.value).toBe("");
    expect(s.chromeMcpFailed.value).toBe(false);
    expect(s.loadingText.value).toBe("加载中...");
  });

  it("idle 收到启动任务 → starting", () => {
    const s = useServiceStatus();
    s.updateStatusFromTask("checking_provider");
    expect(s.serviceStatus.value).toBe("starting");
    expect(s.currentTask.value).toBe("checking_provider");
    expect(s.loadingText.value).toBe(SERVICE_STARTUP_TASKS["checking_provider"]);
  });

  it("ready 复位：状态置 ready 并清空 chrome 错误字段", () => {
    const s = useServiceStatus();
    s.updateStatusFromTask("chrome_mcp_failed", "CHROME_NOT_CONNECTED", "cannot connect");
    expect(s.serviceStatus.value).toBe("partial");
    expect(s.chromeMcpFailed.value).toBe(true);
    expect(s.chromeMcpErrorType.value).toBe("CHROME_NOT_CONNECTED");
    expect(s.chromeMcpErrorMessage.value).toBe("cannot connect");
    expect(s.loadingText.value).toBe(SERVICE_STARTUP_TASKS["chrome_mcp_failed"]);

    s.updateStatusFromTask("ready");
    expect(s.serviceStatus.value).toBe("ready");
    expect(s.chromeMcpFailed.value).toBe(false);
    expect(s.chromeMcpErrorType.value).toBeUndefined();
    expect(s.chromeMcpErrorMessage.value).toBeUndefined();
    expect(s.loadingText.value).toBe(SERVICE_STARTUP_TASKS["ready"]);
  });

  it("chrome_mcp_failed → partial，并记录错误类型/信息", () => {
    const s = useServiceStatus();
    s.updateStatusFromTask("ready");
    s.updateStatusFromTask("chrome_mcp_failed", "UNKNOWN", "boom");
    expect(s.serviceStatus.value).toBe("partial");
    expect(s.chromeMcpFailed.value).toBe(true);
    expect(s.chromeMcpErrorType.value).toBe("UNKNOWN");
    expect(s.chromeMcpErrorMessage.value).toBe("boom");
  });

  it.each([
    ["provider_not_installed"],
    ["web_start_timeout"],
    ["proxy_start_failed"],
    ["session_creation_failed"],
  ] as const)("失败类任务 %s → failed 并记录失败原因", (task) => {
    const s = useServiceStatus();
    s.updateStatusFromTask("ready");
    s.updateStatusFromTask(task, "BOOM", "boom");
    expect(s.serviceStatus.value).toBe("failed");
    expect(s.loadingText.value).toBe(SERVICE_STARTUP_TASKS[task]);
    expect(s.failureErrorType.value).toBe("BOOM");
    expect(s.failureErrorMessage.value).toBe("boom");
  });

  it("ready 复位时清空失败原因", () => {
    const s = useServiceStatus();
    s.updateStatusFromTask("provider_not_installed", "BOOM", "boom");
    expect(s.failureErrorMessage.value).toBe("boom");

    s.updateStatusFromTask("ready");
    expect(s.failureErrorType.value).toBeUndefined();
    expect(s.failureErrorMessage.value).toBeUndefined();
  });

  it("失败态收到普通启动任务不会被降级为 starting（保持 failed）", () => {
    const s = useServiceStatus();
    s.updateStatusFromTask("provider_not_installed");
    s.updateStatusFromTask("checking_provider");
    expect(s.serviceStatus.value).toBe("failed");
  });

  it("setStarting 强制置为 starting", () => {
    const s = useServiceStatus();
    s.setStarting();
    expect(s.serviceStatus.value).toBe("starting");
  });

  it("开启 DEBUG 后 console.debug 输出状态迁移日志", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    setVerbose(true);
    const s = useServiceStatus();
    s.updateStatusFromTask("ready");
    expect(debugSpy).toHaveBeenCalled();
    const args = debugSpy.mock.calls.flat().map(String);
    expect(args.some((a) => a.includes("ready"))).toBe(true);
  });
});
