/**
 * @aipanel/provider-deepseek 入口（index.ts）导出面测试。
 *
 * 断言约定工厂与各能力面在包入口上可见，且导出的常量/函数与定义模块为同一引用
 * （单一来源，不做镜像副本）。types.ts 为纯类型导出（SESSION_EVENT_TYPES 运行时常量
 * 在 constants.test.ts 覆盖）。
 */
import { describe, expect, it } from "vitest";
import * as providerEntry from "../src/index";
import { buildDshOverlay, writeDshOverlay } from "../src/profile";
import { DeepSeekAPI } from "../src/api";
import { startDeepSeekWeb } from "../src/deepseek-web";
import {
  DEFAULT_DEEPSEEK_PROVIDER_OPTIONS,
  DSH_DEFAULT_PORT,
  DSH_LOOPBACK_HOST,
} from "../src/constants";

const FUNCTION_EXPORTS = [
  "createProvider",
  "DeepSeekAPI",
  "startDeepSeekWeb",
  "buildDshOverlay",
  "writeDshOverlay",
  "checkDeepSeekInstalled",
  "getDeepSeekVersion",
  "killOrphanDeepSeekProcesses",
] as const;

describe("index.ts 导出面", () => {
  it("约定工厂 createProvider 与各能力面均导出且为函数", () => {
    for (const name of FUNCTION_EXPORTS) {
      expect(typeof providerEntry[name], name).toBe("function");
    }
  });

  it("导出的常量引用 constants 定义处（单一来源）", () => {
    expect(providerEntry.DEFAULT_DEEPSEEK_PROVIDER_OPTIONS).toBe(
      DEFAULT_DEEPSEEK_PROVIDER_OPTIONS,
    );
    expect(providerEntry.DSH_LOOPBACK_HOST).toBe(DSH_LOOPBACK_HOST);
    expect(providerEntry.DSH_DEFAULT_PORT).toBe(DSH_DEFAULT_PORT);
  });

  it("导出的实现与各定义模块为同一引用", () => {
    expect(providerEntry.DeepSeekAPI).toBe(DeepSeekAPI);
    expect(providerEntry.startDeepSeekWeb).toBe(startDeepSeekWeb);
    expect(providerEntry.buildDshOverlay).toBe(buildDshOverlay);
    expect(providerEntry.writeDshOverlay).toBe(writeDshOverlay);
  });
});
