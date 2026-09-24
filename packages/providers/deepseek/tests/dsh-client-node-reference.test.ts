/**
 * 节点 chip 引用载荷解析（dsh-client/src/client/node-reference.ts）单元测试。
 *
 * 覆盖目标：chip 的 `ref`（选中元素 JSON）能被还原成元素对象——chip 点击（openReference）
 * 依赖它取到 description / previewPageUrl 才能让挂件跳页面并高亮；
 * 非本 source 形态的载荷（非法 JSON、非对象、原始标量）返回 null，调用方据此保留编辑器原有手势。
 */
import { describe, expect, it } from "vitest";
import type { AIPanelSelectedElement } from "@aipanel/core";
import { parseElementRef, serializeElementRef } from "../dsh-client/src/client/node-reference";

describe("parseElementRef", () => {
  it("解析选中元素 JSON（含 chip 点击定位所需的描述与页面 URL）", () => {
    const element: AIPanelSelectedElement = {
      id: "n12345678",
      filePath: "/repo/packages/docs/site/desktop/views/index.vue",
      line: 53,
      column: 11,
      innerText: "让 AI 成为",
      description: ".line:nth-child(1)",
      previewPageUrl: "http://localhost:5173/#/index",
    };

    expect(parseElementRef(JSON.stringify(element))).toStrictEqual(element);
  });

  it("非法 JSON 返回 null", () => {
    expect(parseElementRef("not json")).toBeNull();
    expect(parseElementRef("")).toBeNull();
  });

  it("非对象载荷返回 null", () => {
    expect(parseElementRef("null")).toBeNull();
    expect(parseElementRef('"node"')).toBeNull();
    expect(parseElementRef("123")).toBeNull();
  });
});

describe("serializeElementRef", () => {
  const element: AIPanelSelectedElement = {
    id: "n12345678",
    filePath: "/repo/packages/docs/site/desktop/views/index.vue",
    line: 53,
    column: 11,
    innerText: "让 AI 成为",
    description: ".line:nth-child(1)",
    previewPageUrl: "http://localhost:5173/#/index",
  };

  it("序列化成 `@节点[id]` 标记（完整上下文由 host 端按 id 反查注入）", () => {
    expect(serializeElementRef(JSON.stringify(element))).toBe("@节点[n12345678]");
  });

  it("没有文件路径的元素同样只留节点标记", () => {
    const noPath = { ...element, filePath: null };
    expect(serializeElementRef(JSON.stringify(noPath))).toBe("@节点[n12345678]");
  });

  it("载荷无法解析时退回 @ref（不丢引用）", () => {
    expect(serializeElementRef("not-json")).toBe("@not-json");
  });
});
