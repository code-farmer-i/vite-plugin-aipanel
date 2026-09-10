/**
 * 覆盖目标：Frame.vue（iframe 容器 + loading/empty/error 覆盖层）
 * - iframe.src 绑定 context.iframeSource，frameLoading 取反驱动 .loaded class 与 loading 遮罩
 * - showEmptyState / showError 驱动对应遮罩 visible class
 * - 空态默认文案与操作按钮，点击回调 handleEmptyAction
 * - iframe @load 回调 handleFrameLoaded
 * - 各具名插槽可覆盖默认内容（empty-state / loading / error / content）
 * - 暴露的 sendMessageToIframe 通过 postMessage 发送 widgetEnvelope 信封
 *
 * 策略：mountWithContext 真实 provide/inject；postMessage 用间谍验证载荷与 targetOrigin。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import { widgetEnvelope } from "@aipanel/core";
import Frame from "../src/AI-panel-widget/src/components/Frame.vue";
import { createWidgetContext, mountWithContext } from "./component-widget-context";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Frame", () => {
  it("iframe 绑定 iframeSource，frameLoading 为假时加 loaded class", () => {
    const { wrapper: w } = mountWithContext(Frame, {
      context: createWidgetContext({
        iframeSource: ref("https://example.com/chat"),
        frameLoading: ref(false),
      }),
    });
    wrapper = w;

    const iframe = w.find("iframe.aipanel-iframe");
    expect(iframe.attributes("src")).toBe("https://example.com/chat");
    expect(iframe.classes()).toContain("loaded");
    expect(w.find(".aipanel-loading-overlay").classes()).not.toContain("visible");
  });

  it("frameLoading 为真时移除 loaded class 并显示 loading 遮罩", () => {
    const { wrapper: w } = mountWithContext(Frame, {
      context: createWidgetContext({ frameLoading: ref(true) }),
    });
    wrapper = w;

    expect(w.find("iframe.aipanel-iframe").classes()).not.toContain("loaded");
    expect(w.find(".aipanel-loading-overlay").classes()).toContain("visible");
    expect(w.find(".aipanel-loading-text").text()).toBe("加载中...");
  });

  it("空态遮罩：visible 由 showEmptyState 驱动，渲染文案与按钮并可点击回调", async () => {
    const handleEmptyAction = vi.fn();
    const { wrapper: w } = mountWithContext(Frame, {
      context: createWidgetContext({
        showEmptyState: ref(true),
        emptyStateText: ref("暂无数据"),
        emptyStateActionText: ref("去创建"),
        handleEmptyAction,
      }),
    });
    wrapper = w;

    expect(w.find(".aipanel-empty-state-overlay").classes()).toContain("visible");
    expect(w.find(".aipanel-empty-state-text").text()).toBe("暂无数据");
    const btn = w.find(".aipanel-empty-state-btn");
    expect(btn.text()).toBe("去创建");

    await btn.trigger("click");
    expect(handleEmptyAction).toHaveBeenCalledTimes(1);
  });

  it("错误遮罩 visible 由 showError 驱动", () => {
    const { wrapper: w } = mountWithContext(Frame, {
      context: createWidgetContext({ showError: ref(true) }),
    });
    wrapper = w;
    expect(w.find(".aipanel-error-overlay").classes()).toContain("visible");
  });

  it("iframe load 事件回调 handleFrameLoaded", async () => {
    const handleFrameLoaded = vi.fn();
    const { wrapper: w } = mountWithContext(Frame, {
      context: createWidgetContext({ handleFrameLoaded }),
    });
    wrapper = w;

    await w.find("iframe.aipanel-iframe").trigger("load");
    expect(handleFrameLoaded).toHaveBeenCalledTimes(1);
  });

  it("具名插槽覆盖默认覆盖层内容", () => {
    const { wrapper: w } = mountWithContext(Frame, {
      context: createWidgetContext({
        showEmptyState: ref(true),
        frameLoading: ref(true),
        showError: ref(true),
      }),
      slots: {
        "empty-state": () => h("div", { class: "slot-empty" }, "自定义空态"),
        loading: () => h("div", { class: "slot-loading" }, "自定义加载"),
        error: () => h("div", { class: "slot-error" }, "自定义错误"),
        content: () => h("div", { class: "slot-content" }, "自定义内容"),
      },
    });
    wrapper = w;

    expect(w.find(".slot-empty").text()).toBe("自定义空态");
    expect(w.find(".slot-loading").text()).toBe("自定义加载");
    expect(w.find(".slot-error").text()).toBe("自定义错误");
    expect(w.find(".slot-content").text()).toBe("自定义内容");
    // content 插槽替换掉默认 iframe
    expect(w.find("iframe.aipanel-iframe").exists()).toBe(false);
    // 默认 loading 文案被覆盖
    expect(w.find(".aipanel-loading-text").exists()).toBe(false);
  });

  it("暴露的 sendMessageToIframe 以 widgetEnvelope 信封 postMessage", () => {
    const { wrapper: w } = mountWithContext(Frame, {
      context: createWidgetContext({ iframeSource: ref("about:blank") }),
    });
    wrapper = w;

    // jsdom 默认不提供 iframe 的 contentWindow，打桩注入受控实现
    const contentWindow = { postMessage: vi.fn() };
    const iframe = w.find("iframe.aipanel-iframe").element as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentWindow", { value: contentWindow, configurable: true });

    w.findComponent(Frame).vm.sendMessageToIframe("AIPANEL_READY", { a: 1 });
    expect(contentWindow.postMessage).toHaveBeenCalledWith(
      widgetEnvelope("AIPANEL_READY", { a: 1 }),
      "*",
    );
  });

  it("contentWindow 缺失时 sendMessageToIframe 静默返回", () => {
    const { wrapper: w } = mountWithContext(Frame, {
      context: createWidgetContext(),
    });
    wrapper = w;

    const iframe = w.find("iframe.aipanel-iframe").element as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentWindow", { value: null, configurable: true });

    expect(() => w.findComponent(Frame).vm.sendMessageToIframe("AIPANEL_READY")).not.toThrow();
  });
});
