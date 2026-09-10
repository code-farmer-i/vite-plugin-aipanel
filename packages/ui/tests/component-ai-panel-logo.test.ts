/**
 * 覆盖目标：AIPanelLogo.vue
 * - 通过 v-html 注入 logo.svg 原始内容，并渲染出 svg 根节点
 * - size prop：默认 "100%"；number 转 px；string 原样
 * - 渐变 id 使用 useId 生成，避免同页多实例 id 冲突
 *
 * 该组件无 props 之外的交互，用例聚焦渲染结果。
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import AIPanelLogo from "../src/AI-panel-widget/src/components/AIPanelLogo.vue";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountLogo(props: Record<string, unknown> = {}) {
  wrapper = mount(AIPanelLogo, { props });
  return wrapper;
}

describe("AIPanelLogo", () => {
  it("渲染注入的 svg，默认尺寸 100%", () => {
    const w = mountLogo();
    expect(w.find("span.aipanel-logo").exists()).toBe(true);
    expect(w.find("svg").exists()).toBe(true);
    const style = w.find("span.aipanel-logo").attributes("style") ?? "";
    expect(style).toContain("width: 100%");
    expect(style).toContain("height: 100%");
  });

  it("size 为数字时转换为 px", () => {
    const w = mountLogo({ size: 42 });
    const style = w.find("span.aipanel-logo").attributes("style") ?? "";
    expect(style).toContain("width: 42px");
    expect(style).toContain("height: 42px");
  });

  it("size 为字符串时原样使用", () => {
    const w = mountLogo({ size: "2em" });
    const style = w.find("span.aipanel-logo").attributes("style") ?? "";
    expect(style).toContain("width: 2em");
  });

  it("渐变 id 被替换为带 useId 的唯一值，原始 id 不再出现", () => {
    const w = mountLogo();
    const html = w.html();
    expect(html).not.toContain('id="aipanel-logo-gradient"');
    expect(html).toMatch(/id="aipanel-logo-gradient-[\w-]+"/);
    expect(html).toMatch(/url\(#aipanel-logo-gradient-[\w-]+\)/);
  });

  it("同一应用内的两个实例渐变 id 互不相同", () => {
    const Host = defineComponent({
      setup: () => () => h("div", [h(AIPanelLogo), h(AIPanelLogo)]),
    });
    wrapper = mount(Host);
    const ids = [...wrapper.html().matchAll(/id="(aipanel-logo-gradient-[\w-]+)"/g)].map(
      (match) => match[1],
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
