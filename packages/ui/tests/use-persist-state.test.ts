/**
 * @aipanel/ui usePersistState（AI-panel-widget 状态本地持久化）单元测试。
 *
 * 覆盖目标：
 *  - onMounted 读取 localStorage 并把保存值透传给 onRestore（无数据时回传 {}）；
 *  - restoreState 返回值语义（无数据 null / 有数据对象）；
 *  - 任一被观察 ref 变化后自动写回，含可选 splitPanelWidth/displayMode/splitPosition；
 *  - 可选 ref 缺省时不写入对应字段；
 *  - 未提供 onRestore 时不抛错；
 *  - onUnmounted 后停止持久化。
 *
 * 策略：用 helpers.mountComposable 驱动 onMounted/onUnmounted/watch。
 * 存储键为源码模块私有常量，测试不硬编码：先用 persistState 写一次再从 localStorage 反查键名。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { AIPanelWidgetTheme, DisplayMode } from "@aipanel/core";
import type { FloatingBubbleOffset } from "../src/AI-panel-widget/src/components/FloatingBubble/types";
import { usePersistState } from "../src/AI-panel-widget/composables/use-persist-state";
import { mountComposable, unmountAll, flushVue } from "./helpers";

type Options = Parameters<typeof usePersistState>[0];

/** 枚举 localStorage 中已有的键（避免在测试里硬编码源码私有的存储键常量） */
function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

/** 读取唯一存储项并 JSON 解析 */
function readStored<T>(): T {
  const key = storedKeys()[0];
  return JSON.parse(localStorage.getItem(key)!) as T;
}

function setup(overrides: Partial<Options> = {}) {
  const open = ref(false);
  const minimized = ref(false);
  const promptDockVisible = ref(true);
  const reviewPanelVisible = ref(false);
  const bubbleOffset = ref<FloatingBubbleOffset | undefined>(undefined);
  const theme = ref<AIPanelWidgetTheme>("auto");
  const sessionListCollapsed = ref(true);
  const splitPanelWidth = ref(500);
  const displayMode = ref<DisplayMode>("bubble");
  const splitPosition = ref<"left" | "right">("right");
  const onRestore = vi.fn();

  const { ctx } = mountComposable(() =>
    usePersistState({
      open,
      minimized,
      promptDockVisible,
      reviewPanelVisible,
      bubbleOffset,
      theme,
      sessionListCollapsed,
      splitPanelWidth,
      displayMode,
      splitPosition,
      onRestore,
      ...overrides,
    }),
  );

  return {
    api: ctx,
    open,
    minimized,
    promptDockVisible,
    reviewPanelVisible,
    bubbleOffset,
    theme,
    sessionListCollapsed,
    splitPanelWidth,
    displayMode,
    splitPosition,
    onRestore,
  };
}

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("usePersistState", () => {
  it("onMounted 无历史数据时 onRestore 收到 {}，restoreState 返回 null", () => {
    const s = setup();
    expect(s.onRestore).toHaveBeenCalledWith({});
    expect(s.api.restoreState()).toBeNull();
  });

  it("restoreState 读取已保存状态并透传 onRestore", async () => {
    const seed = setup();
    seed.api.persistState();
    const key = storedKeys()[0];
    const saved = { open: true, theme: "dark" as const, sessionListCollapsed: false };
    localStorage.setItem(key, JSON.stringify(saved));
    await unmountAll();

    const s = setup();
    expect(s.onRestore).toHaveBeenCalledWith(saved);
    expect(s.api.restoreState()).toStrictEqual(saved);
  });

  it("被观察 ref 变化后自动持久化完整状态（含可选字段）", async () => {
    const s = setup();
    s.open.value = true;
    s.minimized.value = true;
    s.theme.value = "dark";
    s.sessionListCollapsed.value = false;
    s.displayMode.value = "split";
    s.splitPosition.value = "left";
    s.splitPanelWidth.value = 640;
    s.bubbleOffset.value = { x: 12, y: 34 };
    await flushVue();

    expect(readStored()).toMatchObject({
      open: true,
      minimized: true,
      promptDockVisible: true,
      reviewPanelVisible: false,
      theme: "dark",
      sessionListCollapsed: false,
      displayMode: "split",
      splitPosition: "left",
      splitPanelWidth: 640,
      bubbleOffset: { x: 12, y: 34 },
    });
  });

  it("未提供可选 ref 时不写入 splitPanelWidth/displayMode/splitPosition", async () => {
    const s = setup({
      splitPanelWidth: undefined,
      displayMode: undefined,
      splitPosition: undefined,
    });
    s.api.persistState();

    const stored = readStored<Record<string, unknown>>();
    expect(stored).not.toHaveProperty("splitPanelWidth");
    expect(stored).not.toHaveProperty("displayMode");
    expect(stored).not.toHaveProperty("splitPosition");
  });

  it("未提供 onRestore 时 restoreState 不抛错并返回保存值", () => {
    const s = setup({ onRestore: undefined });
    s.api.persistState();

    const restored = s.api.restoreState();
    expect(restored).toMatchObject({ open: false, theme: "auto" });
  });

  it("onUnmounted 后 watch 停止，ref 变化不再写回", async () => {
    const s = setup();
    s.open.value = true;
    await flushVue();
    const before = localStorage.getItem(storedKeys()[0]);

    await unmountAll();
    s.open.value = false;
    s.theme.value = "dark";
    await flushVue();

    expect(localStorage.getItem(storedKeys()[0])).toBe(before);
  });
});
