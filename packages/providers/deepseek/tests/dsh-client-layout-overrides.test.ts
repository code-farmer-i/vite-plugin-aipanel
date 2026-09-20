/**
 * dsh 嵌入式布局覆盖样式（@aipanel/dsh-client layout-overrides）回归测试。
 *
 * 背景：AppFrame 的 grid 是 `侧栏 | 主列 | 右侧栏` 三轨，右侧栏（浏览器/终端等面板）
 * 仅在视口够宽时才有轨道。曾用 `grid-template-columns: auto !important` 回收侧栏宽度，
 * 把轨道表压成单轨——右侧栏随之落进隐式行，被 frame 的 overflow:hidden 裁掉，
 * 表现为面板/侧栏“变宽后消失”。这里锁定修复后的契约：
 *   1. 侧栏列整列隐藏（与 AIPanel 自带会话列表去重）；
 *   2. 不触碰 grid-template-columns（保留 dsh 自己下发的三轨表）；
 *   3. 改由主列跨过侧栏轨道回收宽度。
 */
import { describe, expect, it } from "vitest";
import {
  buildLayoutOverridesCss,
  LAYOUT_STYLE_ID,
} from "../dsh-client/src/client/layout-overrides";

const css = buildLayoutOverridesCss();

describe("dsh 嵌入式布局覆盖样式", () => {
  it("注入 id 稳定（幂等注入依赖它）", () => {
    expect(LAYOUT_STYLE_ID).toBe("aipanel-layout-overrides");
  });

  it("侧栏列、拖拽手柄与工作区下拉一律隐藏", () => {
    expect(css).toContain(':has(> [class*="sidebarCol"]) > [class*="sidebarCol"]');
    expect(css).toContain('[data-side="sidebar"]');
    expect(css).toContain('[aria-label="选择工作区"]');
    expect(css.match(/display: none !important/g)).toHaveLength(3);
  });

  it("不改写 grid-template-columns（否则右侧栏被挤出可见区）", () => {
    expect(css).not.toContain("grid-template-columns");
  });

  it("主列跨过侧栏轨道以回收宽度（保留右侧栏轨道）", () => {
    expect(css).toContain(':has(> [class*="sidebarCol"]) > [class*="centerCol"]');
    expect(css).toContain("grid-column: 1 / -2 !important");
  });
});
