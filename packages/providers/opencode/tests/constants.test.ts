/**
 * @aipanel/provider-opencode constants 单元测试。
 *
 * 常量单一来源自检：localStorage 键名唯一、默认设置与 provider 默认选项结构稳定；
 * 这里只断言“源码定义处的值”，不重复硬编码到桥接脚本等消费方。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENCODE_PROVIDER_OPTIONS,
  DEFAULT_OPENCODE_SETTINGS,
  OPENCODE_STORAGE_KEYS,
} from "../src/constants";

describe("OPENCODE_STORAGE_KEYS", () => {
  it("包含 settings.v3 / color-scheme / theme-id 三个键且互不重复", () => {
    expect(OPENCODE_STORAGE_KEYS.SETTINGS).toBe("settings.v3");
    expect(OPENCODE_STORAGE_KEYS.COLOR_SCHEME).toBe("opencode-color-scheme");
    expect(OPENCODE_STORAGE_KEYS.THEME_ID).toBe("opencode-theme-id");

    const values = Object.values(OPENCODE_STORAGE_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("DEFAULT_OPENCODE_SETTINGS", () => {
  it("仅含 general 分区，且各字段为布尔默认值", () => {
    expect(Object.keys(DEFAULT_OPENCODE_SETTINGS)).toEqual(["general"]);
    for (const value of Object.values(DEFAULT_OPENCODE_SETTINGS.general)) {
      expect(typeof value).toBe("boolean");
    }
  });
});

describe("DEFAULT_OPENCODE_PROVIDER_OPTIONS", () => {
  it("默认开启 LSP 与 prettier", () => {
    expect(DEFAULT_OPENCODE_PROVIDER_OPTIONS).toEqual({ enableLsp: true, enablePrettier: true });
  });
});
