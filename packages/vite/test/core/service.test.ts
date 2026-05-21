import { describe, expect, it, vi, beforeEach } from "vitest";
import http from "http";
import { OpenCodeService } from "../../src/core/service";
import { OpenCodeAPI } from "../../src/core/api";
import { DEFAULT_CONFIG } from "@vite-plugin-opencode-assistant/shared";
import type { OpenCodeOptions } from "@vite-plugin-opencode-assistant/shared";

vi.mock("../../src/core/api");
vi.mock("../../src/core/opencode-web");
vi.mock("../../src/core/proxy-server");
vi.mock("../../src/utils/system", async () => {
  const actual = await vi.importActual("../../src/utils/system");
  return {
    ...actual,
    checkOpenCodeInstalled: vi.fn().mockResolvedValue(true),
    findAvailablePort: vi.fn().mockImplementation((port: number) => Promise.resolve(port)),
    findGitRoot: vi.fn().mockReturnValue("/fake/git/root"),
    killOrphanOpenCodeProcesses: vi.fn().mockResolvedValue(0),
    waitForServer: vi.fn().mockResolvedValue(undefined),
  };
});

describe("OpenCodeService", () => {
  let service: OpenCodeService;
  let mockApi: OpenCodeAPI;
  let sseClients: Set<http.ServerResponse>;
  let onPortAllocated: ReturnType<typeof vi.fn>;
  let onProxyPortAllocated: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();

    mockApi = new OpenCodeAPI(
      "127.0.0.1",
      () => 5097,
      () => 6097,
      false,
    ) as unknown as OpenCodeAPI;

    sseClients = new Set();
    onPortAllocated = vi.fn();
    onProxyPortAllocated = vi.fn();

    const config = { ...DEFAULT_CONFIG } as Required<OpenCodeOptions>;

    service = new OpenCodeService(
      config,
      mockApi,
      sseClients,
      onPortAllocated,
      onProxyPortAllocated,
    );
  });

  describe("constructor", () => {
    it("应该使用配置中指定的端口", () => {
      expect(service.actualWebPort).toBe(5097);
      expect(service.actualProxyPort).toBe(6097);
    });

    it("应该默认为未启动状态", () => {
      expect(service.isStarted).toBe(false);
      expect(service.webProcess).toBeNull();
      expect(service.workspaceRoot).toBeNull();
    });

    it("chromeMcp 预热默认应未失败", () => {
      expect(service.chromeMcpWarmupFailed).toBe(false);
      expect(service.chromeMcpWarmupErrorType).toBeNull();
      expect(service.chromeMcpWarmupErrorMessage).toBeNull();
    });
  });

  describe("stop", () => {
    it("停止时应该处理空状态（无 web 进程）", () => {
      expect(() => service.stop()).not.toThrow();
    });
  });
});
