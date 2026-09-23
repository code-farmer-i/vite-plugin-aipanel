/**
 * Vue Inspector 注入的框架门控测试（真实走一遍 Vite 插件解析）：
 * unplugin-vue-inspector 会在 dev 阶段向 index.html 注入依赖 vue 的运行时（src/load.js
 * 里 `import * as Vue from 'vue'`）；在未安装 vue 的项目里注册它，浏览器会直接报
 * `Failed to resolve import "vue" from .../vite-plugin-vue-inspector/src/load.js`。
 * 该注入在 configResolved 阶段已无法撤销，只能在 Vite 解析插件列表时（apply）按框架拦截。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "vite";
import type { ConfigEnv, Plugin } from "vite";
import aipanelPlugin from "../src/index";

/** Vite 解析后最终注册的 Vue Inspector 插件 */
async function resolveVueInspectorPlugins(
  frameworkPluginName: string,
  command: ConfigEnv["command"] = "serve",
): Promise<Plugin[]> {
  const config = await resolveConfig(
    {
      configFile: false,
      root: process.cwd(),
      logLevel: "silent",
      plugins: [aipanelPlugin(), [{ name: frameworkPluginName }]],
    },
    command,
  );
  return config.plugins.filter((plugin) => plugin.name.includes("vue-inspector"));
}

describe("Vue Inspector 注入门控", () => {
  // 第三方插件自带 `NODE_ENV !== "test"` 门控，按其真实运行环境（dev server）求值
  beforeEach(() => vi.stubEnv("NODE_ENV", "development"));
  afterEach(() => vi.unstubAllEnvs());

  it("Vue 项目注入 unplugin-vue-inspector，且注入所需钩子完整", async () => {
    const plugins = await resolveVueInspectorPlugins("vite:vue");
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      "vite-plugin-vue-inspector",
      "vite-plugin-vue-inspector:post",
    ]);
    // transformIndexHtml 注入 load.js（内部 import * as Vue from 'vue'），框架门控包装后不能丢
    const main = plugins.find((plugin) => plugin.name === "vite-plugin-vue-inspector")!;
    expect(main.transformIndexHtml).toBeTypeOf("function");
    expect(main.transform).toBeTypeOf("function");
    expect(main.configResolved).toBeTypeOf("function");
  });

  it('React 项目不注入（否则报 Failed to resolve import "vue"）', async () => {
    expect(await resolveVueInspectorPlugins("vite:react-swc")).toHaveLength(0);
  });

  it("未识别框架不注入（可能是未安装 vue 的 React / Svelte 等项目）", async () => {
    expect(await resolveVueInspectorPlugins("vite:css-post")).toHaveLength(0);
  });

  it("build 阶段不注入（保留插件原有的 serve 门控）", async () => {
    expect(await resolveVueInspectorPlugins("vite:vue", "build")).toHaveLength(0);
  });
});
