/**
 * Vue DevTools 桥接脚本
 * 注入到用户页面，初始化 @vue/devtools-kit 并暴露到 window.__opencode_vue
 * AI 通过 Chrome DevTools evaluate_script 调用此 API
 */
import { devtools, stringify, devtoolsRouterInfo, devtoolsRouter } from "@vue/devtools-kit";
import type { DevToolsApiType } from "@vue/devtools-kit";

declare global {
  interface Window {
    __opencode_vue: typeof devtools & {
      api: DevToolsApiType;
      routerInfo: typeof devtoolsRouterInfo;
      router: typeof devtoolsRouter;
    };
  }
}

// 初始化 devtools，监听 Vue app 创建
devtools.init();

// 只有 getInspectorState 和 getComponentRenderCode 存在循环引用，需要 stringify
const NEEDS_STRINGIFY = new Set(["getInspectorState", "getComponentRenderCode"]);

const safeApi = new Proxy(devtools.api, {
  get(target, prop) {
    const value = Reflect.get(target, prop);
    if (typeof value === "function") {
      return async (...args: unknown[]) => {
        const raw = await value.apply(target, args);
        return NEEDS_STRINGIFY.has(String(prop)) ? stringify(raw) : raw;
      };
    }
    return value;
  },
});

// 暴露到 window — 展开 devtools 到普通对象，覆盖 api getter
// routerInfo/router 使用 getter 确保每次访问获取最新值
window.__opencode_vue = {
  ...devtools,
  api: safeApi,
  get routerInfo() {
    return devtoolsRouterInfo;
  },
  get router() {
    return devtoolsRouter;
  },
};
