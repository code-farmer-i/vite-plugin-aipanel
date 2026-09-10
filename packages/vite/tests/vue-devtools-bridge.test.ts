/**
 * client/vue-devtools-bridge.ts（注入页面的 Vue DevTools 桥）vitest 单元测试。
 *
 * 覆盖目标：safeStringify 的循环引用/函数/undefined/bigint/symbol 处理；
 * API Proxy 对读操作自动 safeStringify、非读操作原样透传；
 * getInspectorState 的 nodeId 有效性校验、状态裁剪（去 Vue 内部对象与噪音类型、截断长字符串）、
 * 以及异常降级为可读错误信息；window.__aipanel_vue 暴露的 api/router/ctx/safeStringify。
 *
 * stub 策略：vi.mock 替换 @vue/devtools-kit 为可控对象（api/ctx/router/init），
 * 并在导入被测模块前注入 globalThis.window，避免真实浏览器环境与 devtools 初始化。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const api: Record<string, any> = {};
  const ctx = { state: { appRecords: [{ id: "app1", name: "App" }] } };
  const router = { value: { currentRoute: { value: { path: "/home" } }, getRoutes: () => [] } };
  const init = vi.fn();
  return { api, ctx, router, init };
});

vi.mock("@vue/devtools-kit", () => ({
  devtools: { api: h.api, ctx: h.ctx, init: h.init },
  devtoolsRouter: h.router,
}));

type BridgeGlobal = {
  window: {
    __aipanel_vue: {
      api: Record<string, any>;
      router: unknown;
      ctx: unknown;
      safeStringify: (v: unknown) => string;
    };
  };
};

let exposed: BridgeGlobal["window"]["__aipanel_vue"];

beforeAll(async () => {
  (globalThis as unknown as BridgeGlobal).window = {} as BridgeGlobal["window"];
  await import("../src/client/vue-devtools-bridge");
  exposed = (globalThis as unknown as BridgeGlobal).window.__aipanel_vue;
});

beforeEach(() => {
  for (const key of Object.keys(h.api)) delete h.api[key];
});

describe("vue-devtools-bridge — 初始化与暴露", () => {
  it("初始化 devtools 并把 api/router/ctx/safeStringify 暴露到 window.__aipanel_vue", () => {
    expect(h.init).toHaveBeenCalledTimes(1);
    expect(exposed).toBeDefined();
    expect(exposed.router).toBe(h.router);
    expect(exposed.ctx).toBe(h.ctx);
    expect(typeof exposed.safeStringify).toBe("function");
  });
});

describe("safeStringify", () => {
  it("循环引用替换为占位符", () => {
    const obj: Record<string, unknown> = { name: "a" };
    obj.self = obj;
    expect(exposed.safeStringify(obj)).toContain("[Circular Reference]");
  });

  it("函数 / undefined / bigint / symbol 转为可读占位", () => {
    expect(exposed.safeStringify({ fn: () => 1 })).toContain("[Function]");
    expect(exposed.safeStringify({ v: undefined })).toContain("__undefined__");
    expect(exposed.safeStringify({ n: 10n })).toContain("10n");
    expect(exposed.safeStringify({ s: Symbol("sym") })).toContain("Symbol(sym)");
  });
});

describe("API Proxy", () => {
  it("读操作自动 safeStringify 为 JSON 字符串", async () => {
    h.api.getInspectorTree = vi.fn(async () => [{ id: "1", name: "App" }]);
    const result = await exposed.api.getInspectorTree({ inspectorId: "components", filter: "" });
    expect(typeof result).toBe("string");
    expect(JSON.parse(result)).toEqual([{ id: "1", name: "App" }]);
  });

  it("非读操作原样透传返回值", async () => {
    h.api.toggleApp = vi.fn(async () => "ok");
    await expect(exposed.api.toggleApp("app1")).resolves.toBe("ok");
  });

  it("getInspectorState：nodeId 不在最新组件树中时返回失效提示", async () => {
    h.api.getInspectorTree = vi.fn(async () => [{ id: "1", children: [{ id: "2" }] }]);
    h.api.getInspectorState = vi.fn(async () => ({ state: [] }));

    const result = await exposed.api.getInspectorState({
      inspectorId: "components",
      nodeId: "999",
    });
    expect(JSON.parse(result).error).toContain("已失效");
    expect(h.api.getInspectorState).not.toHaveBeenCalled();
  });

  it("getInspectorState：nodeId 有效时裁剪 Vue 内部对象与噪音类型、截断长字符串", async () => {
    const longString = "y".repeat(200);
    h.api.getInspectorTree = vi.fn(async () => [{ id: "1" }]);
    h.api.getInspectorState = vi.fn(async () => ({
      state: [
        { type: "setup", key: "count", value: 3, stateType: "ref" },
        { type: "provided", key: "injectedThing", value: 1 },
        { type: "setup", key: "internal", value: { dep: 1, subs: 2, flags: 3 } },
        { type: "setup", key: "longText", value: longString },
        { type: "props", key: "title", value: "hello" },
      ],
    }));

    const result = await exposed.api.getInspectorState({ inspectorId: "components", nodeId: "1" });
    const parsed = JSON.parse(result);
    expect(parsed.state.setup).toEqual({
      count: { value: 3, type: "ref" },
      longText: { value: `<${longString.slice(0, 50)}... (200 chars)>` },
    });
    expect(parsed.state.props).toEqual({ title: { value: "hello" } });
    // provided 属于噪音类型，整个分类被跳过
    expect(parsed.state.provided).toBeUndefined();
    expect(h.api.getInspectorState).toHaveBeenCalledTimes(1);
  });

  it("getInspectorState：底层抛错时降级为可读错误信息（不产生未处理拒绝）", async () => {
    h.api.getInspectorTree = vi.fn(async () => [{ id: "1" }]);
    h.api.getInspectorState = vi.fn(async () => {
      throw new Error("component not found");
    });

    const result = await exposed.api.getInspectorState({ inspectorId: "components", nodeId: "1" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("组件状态获取失败");
    expect(parsed.error).toContain("component not found");
  });

  it("getInspectorState：组件树查询抛错时视为 nodeId 失效", async () => {
    h.api.getInspectorTree = vi.fn(async () => {
      throw new Error("devtools not ready");
    });
    h.api.getInspectorState = vi.fn(async () => ({ state: [] }));

    const result = await exposed.api.getInspectorState({ inspectorId: "components", nodeId: "1" });
    expect(JSON.parse(result).error).toContain("已失效");
  });

  it("getComponentRenderCode 同样属于读操作并被 safeStringify", async () => {
    h.api.getComponentRenderCode = vi.fn(async () => ({ code: "<div/>" }));
    const result = await exposed.api.getComponentRenderCode("1");
    expect(JSON.parse(result)).toEqual({ code: "<div/>" });
  });
});
