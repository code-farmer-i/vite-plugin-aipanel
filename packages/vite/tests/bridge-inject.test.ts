/**
 * Vue DevTools 桥注入门控的 vitest 单元测试：
 * - Vue 项目注入桥接 script 标签（vue-devtools_* 工具依赖 window.__aipanel_vue）；
 * - React 项目（vite:react* 插件）跳过桥接注入；
 * - 未识别框架保守注入（保持现状，避免自定义 Vue 接入方式回归）。
 */
import { describe, expect, it } from "vitest";
import type { HtmlTagDescriptor, ResolvedConfig } from "vite";
import aipanelPlugin from "../src/index";

const HTML = "<!doctype html><html><head></head><body></body></html>";

interface TransformResult {
  html: string;
  tags: HtmlTagDescriptor[];
}

/** 实例化插件并按给定插件名模拟 configResolved 后执行 transformIndexHtml */
function transformHtml(pluginNames: string[]): TransformResult {
  const plugins = aipanelPlugin();
  const main = plugins.find((p) => p.name === "vite-plugin-aipanel")!;
  expect(main).toBeDefined();
  (main.configResolved as (config: ResolvedConfig) => void)({
    plugins: pluginNames.map((name) => ({ name })),
  } as unknown as ResolvedConfig);
  return (main.transformIndexHtml as (html: string) => TransformResult)(HTML);
}

function bridgeTags(result: TransformResult): HtmlTagDescriptor[] {
  return result.tags.filter(
    (tag) =>
      tag.tag === "script" &&
      typeof tag.attrs?.src === "string" &&
      tag.attrs.src.includes("vue-devtools-bridge"),
  );
}

describe("Vue DevTools 桥注入门控", () => {
  it("Vue 项目注入桥接 script 标签", () => {
    const result = transformHtml(["vite:vue", "vite-plugin-aipanel"]);
    expect(bridgeTags(result)).toHaveLength(1);
  });

  it("React 项目跳过桥接注入", () => {
    const result = transformHtml([
      "vite:react-swc",
      "vite:react-refresh",
      "vite-plugin-aipanel",
    ]);
    expect(bridgeTags(result)).toHaveLength(0);
  });

  it("未识别框架保守注入（保持现状）", () => {
    const result = transformHtml(["vite:css-post"]);
    expect(bridgeTags(result)).toHaveLength(1);
  });
});
