/**
 * injectWidget 输出结构的 vitest 单元测试：
 * - 输出同时包含样式 <link> 与 <script type="module">，且样式行位于脚本行之前；
 * - 脚本的 src 使用 core 导出的 WIDGET_SCRIPT_PATH，样式 href 使用 WIDGET_STYLE_PATH；
 * - data-aipanel-config 属性值为入参 options 的 base64(JSON)，可无损反解并 deep-equal 回入参。
 * 常量一律引用 @aipanel/core 导出，避免测试内散落硬编码路径字面量。
 */
import { describe, expect, it } from "vitest";
import { CONFIG_DATA_ATTR, WIDGET_SCRIPT_PATH, WIDGET_STYLE_PATH } from "@aipanel/core";
import { injectWidget } from "../src/core/injector";

const SCRIPT_CLOSE = "</script>";

/** 从注入结果中截取完整 <script ...></script> 标签文本（避开正斜杠转义的脆弱写法） */
function extractScriptTag(html: string): string {
  const start = html.indexOf("<script");
  const end = html.indexOf(SCRIPT_CLOSE, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + SCRIPT_CLOSE.length);
}

describe("injectWidget", () => {
  const options: Parameters<typeof injectWidget>[0] = {
    theme: "dark",
    open: true,
    hotkey: "alt+a",
    proxyPort: 8081,
    proxyHost: "localhost",
    displayMode: "auto",
    serviceInstanceId: "svc-test-1",
    projectRoot: "/repo",
    verbose: true,
  };

  it("输出含样式 link 与脚本标签，且样式行位于脚本行之前", () => {
    const html = injectWidget(options);
    const styleIdx = html.indexOf(`<link rel="stylesheet" href="${WIDGET_STYLE_PATH}"`);
    const scriptIdx = html.indexOf("<script");
    expect(styleIdx).toBeGreaterThanOrEqual(0);
    expect(scriptIdx).toBeGreaterThan(styleIdx);
    expect(html).toContain(SCRIPT_CLOSE);
  });

  it("样式 href 与脚本 src 引用 core 导出的 WIDGET_STYLE_PATH / WIDGET_SCRIPT_PATH", () => {
    const html = injectWidget(options);
    expect(html).toContain(`<link rel="stylesheet" href="${WIDGET_STYLE_PATH}" />`);
    const script = extractScriptTag(html);
    expect(script).toContain('type="module"');
    expect(script).toContain(`src="${WIDGET_SCRIPT_PATH}"`);
  });

  it("data-aipanel-config 为 options 的 base64 JSON，反解后与入参相等", () => {
    const html = injectWidget(options);
    const script = extractScriptTag(html);
    const attrMatcher = new RegExp(`${CONFIG_DATA_ATTR}="([^"]*)"`);
    const matched = script.match(attrMatcher);
    expect(matched).not.toBeNull();
    const base64 = matched![1];
    // base64 只含 [A-Za-z0-9+/=]，不会破坏引号包裹的 HTML 属性
    expect(base64).toMatch(/^[A-Za-z0-9+/=]+$/);
    const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    expect(decoded).toEqual(options);
  });

  it("多 optional 字段的 options 也能无损往返（含中文字符）", () => {
    const richOptions: Parameters<typeof injectWidget>[0] = {
      theme: "auto",
      open: false,
      hotkey: undefined,
      displayMode: "extension-selector",
      proxyPort: 0,
      proxyHost: "127.0.0.1",
      serviceInstanceId: "",
      projectRoot: "项目根目录/测试",
      verbose: false,
    };
    const html = injectWidget(richOptions);
    const script = extractScriptTag(html);
    const matched = script.match(new RegExp(`${CONFIG_DATA_ATTR}="([^"]*)"`));
    const decoded = JSON.parse(Buffer.from(matched![1], "base64").toString("utf8"));
    expect(decoded).toEqual(richOptions);
  });
});
