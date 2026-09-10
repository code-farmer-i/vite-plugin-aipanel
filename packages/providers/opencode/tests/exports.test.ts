/**
 * @aipanel/provider-opencode 入口（index.ts）导出面测试。
 *
 * 断言约定工厂与各能力面在包入口上可见，且常量/函数与定义模块为同一引用（单一来源，
 * 不做镜像副本）。types.ts 在 opencode 包内为纯类型导出（无运行时导出），其形状由
 * tsconfig 声明构建期校验，这里不做运行时断言。
 */
import { describe, expect, it } from "vitest";
import * as providerEntry from "../src/index";
import { OpenCodeAPI } from "../src/api";
import { generateBridgeScript } from "../src/bridge-script";
import { DEFAULT_OPENCODE_PROVIDER_OPTIONS } from "../src/constants";
import { prepareOpenCodeRuntime, startOpenCodeWeb } from "../src/opencode-web";

const FUNCTION_EXPORTS = [
  "createProvider",
  "prepareOpenCodeRuntime",
  "startOpenCodeWeb",
  "generateBridgeScript",
  "checkOpenCodeInstalled",
  "getOpenCodeVersion",
  "killOrphanOpenCodeProcesses",
  "OpenCodeAPI",
] as const;

describe("index.ts 导出面", () => {
  it("约定工厂 createProvider 与各能力面均导出且为函数", () => {
    for (const name of FUNCTION_EXPORTS) {
      expect(typeof providerEntry[name], name).toBe("function");
    }
  });

  it("导出的默认 provider 选项引用 constants 定义处（单一来源）", () => {
    expect(providerEntry.DEFAULT_OPENCODE_PROVIDER_OPTIONS).toBe(DEFAULT_OPENCODE_PROVIDER_OPTIONS);
  });

  it("导出的实现与各定义模块为同一引用", () => {
    expect(providerEntry.OpenCodeAPI).toBe(OpenCodeAPI);
    expect(providerEntry.generateBridgeScript).toBe(generateBridgeScript);
    expect(providerEntry.prepareOpenCodeRuntime).toBe(prepareOpenCodeRuntime);
    expect(providerEntry.startOpenCodeWeb).toBe(startOpenCodeWeb);
  });
});
