/**
 * 嵌入式（AIPanel iframe）下的 dsh AppFrame 布局覆盖样式。
 *
 * AIPanel 自带会话列表，dsh 侧栏（会话/面板列表）需整列隐藏，避免两份会话导航；
 * 同时不能丢掉 AppFrame 的轨道结构：它的 grid 是 `侧栏 | 主列 | 右侧栏` 三轨
 * （右侧栏承载浏览器/终端等面板，dsh 仅在视口够宽时给它轨道），
 * 由 layout 组件以内联 grid-template-columns 下发。
 *
 * 因此这里只隐藏侧栏列，并让主列吃掉侧栏轨道——不去改写 grid-template-columns：
 * 一旦把轨道表压成单轨，右侧栏会落进隐式行，再被 frame 的 overflow:hidden 裁掉，
 * 表现为面板/侧栏“变宽后消失”。
 *
 * 单一来源：注入逻辑（client/index.ts）与回归测试共用本函数。
 */

/** 注入样式的 DOM id，用于幂等注入 */
export const LAYOUT_STYLE_ID = "aipanel-layout-overrides";

/**
 * 列位 CSS Module 类名锚点。类名取自 dsh-client-ui-layout 的 AppFrame
 * （形如 <hash>_sidebarCol / <hash>_centerCol），只模糊匹配语义后缀，
 * 不硬编码随构建变化的 hash 前缀。
 */
const SIDEBAR_COLUMN_SELECTOR = '[class*="sidebarCol"]';
const MAIN_COLUMN_SELECTOR = '[class*="centerCol"]';

/** 构造布局覆盖 CSS（嵌入式时注入 <head>） */
export function buildLayoutOverridesCss(): string {
  return [
    // 侧栏列（grid 容器的直接子级）
    `:has(> ${SIDEBAR_COLUMN_SELECTOR}) > ${SIDEBAR_COLUMN_SELECTOR} {`,
    "  display: none !important;",
    "}",
    // 主列跨过侧栏轨道：既回收侧栏宽度，又保留 AppFrame 的三轨结构。
    // 1 / -2 = 由首条网格线跨到最后一条之前，即吃掉除右侧栏外的全部轨道。
    `:has(> ${SIDEBAR_COLUMN_SELECTOR}) > ${MAIN_COLUMN_SELECTOR} {`,
    "  grid-column: 1 / -2 !important;",
    "}",
    // 展开态会渲染侧栏拖拽手柄，一并隐藏
    '[data-side="sidebar"] {',
    "  display: none !important;",
    "}",
    // 工作区下拉（portal 到 body，随侧栏一起隐藏）
    '[aria-label="选择工作区"] {',
    "  display: none !important;",
    "}",
  ].join("\n");
}
