/**
 * detectViteFramework 的 vitest 单元测试：
 * - 依据已解析插件名前缀（vite:vue* / vite:react*）判定框架；
 * - vue 优先于 react（与运行时适配器解析顺序一致）；未识别框架返回 null；
 * - 嵌套插件数组可展平。
 */
import { describe, expect, it } from "vitest";
import type { Plugin, ResolvedConfig } from "vite";
import { detectViteFramework } from "../src/core/framework";

/** 允许任意嵌套的插件形态：字符串视为 { name } 插件 */
type PluginLike = string | Plugin | PluginLike[];

function resolveConfig(items: PluginLike[]): ResolvedConfig {
  const toPlugins = (list: PluginLike[]): unknown[] =>
    list.map((item) =>
      typeof item === "string" ? { name: item } : Array.isArray(item) ? toPlugins(item) : item,
    );
  return { plugins: toPlugins(items) } as unknown as ResolvedConfig;
}

describe("detectViteFramework", () => {
  it("@vitejs/plugin-vue → vue", () => {
    expect(detectViteFramework(resolveConfig(["vite:vue", "vite-plugin-aipanel"]))).toBe("vue");
  });

  it("@vitejs/plugin-vue-jsx → vue（前缀匹配）", () => {
    expect(detectViteFramework(resolveConfig(["vite:vue-jsx"]))).toBe("vue");
  });

  it("@vitejs/plugin-react（babel + refresh）→ react", () => {
    expect(detectViteFramework(resolveConfig(["vite:react-babel", "vite:react-refresh"]))).toBe(
      "react",
    );
  });

  it("@vitejs/plugin-react-swc → react", () => {
    expect(detectViteFramework(resolveConfig(["vite:react-swc", "vite:react-refresh"]))).toBe(
      "react",
    );
  });

  it("vue 与 react 共存时 vue 优先", () => {
    expect(detectViteFramework(resolveConfig(["vite:react-swc", "vite:vue"]))).toBe("vue");
  });

  it("未识别框架（solid / svelte / 纯原生）→ null", () => {
    expect(detectViteFramework(resolveConfig(["solid", "vite:css-post"]))).toBeNull();
    expect(detectViteFramework(resolveConfig([]))).toBeNull();
    expect(detectViteFramework({} as ResolvedConfig)).toBeNull();
  });

  it("嵌套插件数组可展平", () => {
    const config = resolveConfig([
      [{ name: "vite:react-babel" }, [{ name: "vite:react-refresh" }] as Plugin[]],
    ]);
    expect(detectViteFramework(config)).toBe("react");
  });
});
