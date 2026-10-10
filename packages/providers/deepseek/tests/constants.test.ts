/**
 * @aipanel/provider-deepseek constants 运行时常量单元测试。
 *
 * 覆盖目标：dsh 协议路径、绑定主机、默认端口与 provider 默认选项的值与单一来源关系。
 * 仅断言定义处的值/关系，不在用例里散布协议字面量副本。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEEPSEEK_PROVIDER_OPTIONS,
  DSH_API_BASE,
  DSH_DEFAULT_PORT,
  DSH_DEFAULT_PROFILE,
  DSH_LOOPBACK_HOST,
  DSH_REMOTE_MUX_PATH,
} from "../src/constants";

describe("dsh 协议常量", () => {
  it("RPC 前缀为 /api，remote mux 端点以其为前缀", () => {
    expect(DSH_API_BASE).toBe("/api");
    expect(DSH_REMOTE_MUX_PATH.startsWith(DSH_API_BASE)).toBe(true);
    expect(DSH_REMOTE_MUX_PATH).toBe(`${DSH_API_BASE}/remote.mux`);
  });

  it("绑定主机为 loopback，默认端口为数值，默认 profile 为 web", () => {
    expect(DSH_LOOPBACK_HOST).toBe("127.0.0.1");
    expect(DSH_DEFAULT_PORT).toBe(3080);
    expect(DSH_DEFAULT_PROFILE).toBe("web");
  });
});

describe("DEFAULT_DEEPSEEK_PROVIDER_OPTIONS", () => {
  it("profile 默认值单一来源 DSH_DEFAULT_PROFILE；不含诊断默认值（其单一来源是 @aipanel/core 的 DEFAULT_DIAGNOSTICS_POLICY）", () => {
    expect(DEFAULT_DEEPSEEK_PROVIDER_OPTIONS).toEqual({ profile: DSH_DEFAULT_PROFILE });
    expect(DEFAULT_DEEPSEEK_PROVIDER_OPTIONS).not.toHaveProperty("diagnostics");
  });
});
