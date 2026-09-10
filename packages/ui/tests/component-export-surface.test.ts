/**
 * 覆盖目标：@aipanel/ui 的导出面与 context 契约。
 * - AI-panel-widget/index.ts：默认导出 = 具名 AIPanelWidget，且导出 AIPanelLogo
 * - src/setup.ts：导出 AIPanelLogo（与 index 同一组件，单一来源）
 * - FloatingBubble/index.ts：导出 FloatingBubble 组件
 * - context.ts：provide/use 配对（无 provider 时抛错）
 * - types.ts / FloatingBubble/types.ts：纯类型模块（运行时无导出）
 *
 * 说明：任务描述里提到的 packages/ui/src/index.ts 在仓库中不存在（包入口为
 * src/setup.ts + src/AI-panel-widget/index.ts），此处以实际入口断言。
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import AIPanelWidgetDefault, { AIPanelLogo, AIPanelWidget } from "../src/AI-panel-widget";
import { AIPanelLogo as SetupAIPanelLogo } from "../src/setup";
import { FloatingBubble } from "../src/AI-panel-widget/src/components/FloatingBubble";
import {
  provideAIPanelWidgetContext,
  useAIPanelWidgetContext,
} from "../src/AI-panel-widget/src/context";
import * as widgetTypes from "../src/AI-panel-widget/src/types";
import * as bubbleTypes from "../src/AI-panel-widget/src/components/FloatingBubble/types";
import { createWidgetContext } from "./component-widget-context";

let mounted: ReturnType<typeof mount> | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("导出面", () => {
  it("AI-panel-widget 入口：默认导出即具名 AIPanelWidget，并导出 AIPanelLogo", () => {
    expect(AIPanelWidgetDefault).toBe(AIPanelWidget);
    expect(AIPanelWidget).toBeTruthy();
    expect(AIPanelLogo).toBeTruthy();
    // 都是可挂载的组件（对象形态）
    expect(AIPanelWidget).toBeTypeOf("object");
    expect(AIPanelLogo).toBeTypeOf("object");
  });

  it("src/setup.ts 的 AIPanelLogo 与 index 导出的为同一组件（单一来源）", () => {
    expect(SetupAIPanelLogo).toBe(AIPanelLogo);
  });

  it("FloatingBubble 子入口导出组件", () => {
    expect(FloatingBubble).toBeTruthy();
    expect(FloatingBubble).toBeTypeOf("object");
  });

  it("types.ts / FloatingBubble/types.ts 为纯类型模块（运行时无导出）", () => {
    expect(Object.keys(widgetTypes)).toHaveLength(0);
    expect(Object.keys(bubbleTypes)).toHaveLength(0);
  });
});

describe("context provide/use 契约", () => {
  it("provide 后后代组件可 inject 到同一份 context", () => {
    const context = createWidgetContext({ title: ref("自定义标题") });
    let injected: ReturnType<typeof useAIPanelWidgetContext> | null = null;
    const Consumer = defineComponent({
      setup() {
        injected = useAIPanelWidgetContext();
        return () => null;
      },
    });
    const Host = defineComponent({
      setup() {
        provideAIPanelWidgetContext(context);
        return () => h(Consumer);
      },
    });
    mounted = mount(Host);
    expect(injected).toBe(context);
    expect(injected!.title.value).toBe("自定义标题");
  });

  it("无 provider 时 useAIPanelWidgetContext 抛出明确错误", () => {
    expect(() => useAIPanelWidgetContext()).toThrowError(
      "useAIPanelWidgetContext must be used within AIPanelWidget",
    );
  });
});
