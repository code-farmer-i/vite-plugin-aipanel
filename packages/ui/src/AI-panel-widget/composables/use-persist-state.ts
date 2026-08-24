import { watch, onMounted, type Ref } from "vue";
import { createLogger } from "@aipanel/core";
import type { FloatingBubbleOffset } from "../src/components/FloatingBubble/types";
import type { AIPanelWidgetTheme, DisplayMode } from "../src/types";

const log = createLogger("AIPanelWidget");

export interface WidgetPersistState {
  open: boolean;
  minimized: boolean;
  promptDockVisible: boolean;
  reviewPanelVisible: boolean;
  bubbleOffset?: FloatingBubbleOffset;
  theme: AIPanelWidgetTheme;
  sessionListCollapsed: boolean;
  splitPanelWidth?: number;
  displayMode?: DisplayMode;
  splitPosition?: "left" | "right";
}

const STORAGE_KEY = "aipanel-widget-state";

function loadState(): Partial<WidgetPersistState> | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    log.error("Failed to load persisted state:", { error: e });
  }
  return null;
}

function saveState(state: WidgetPersistState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    log.error("Failed to save state:", { error: e });
  }
}

export interface UsePersistStateOptions {
  open: Ref<boolean>;
  minimized: Ref<boolean>;
  promptDockVisible: Ref<boolean>;
  reviewPanelVisible: Ref<boolean>;
  bubbleOffset: Ref<FloatingBubbleOffset | undefined>;
  theme: Ref<AIPanelWidgetTheme>;
  sessionListCollapsed: Ref<boolean>;
  splitPanelWidth?: Ref<number>;
  displayMode?: Ref<DisplayMode>;
  splitPosition?: Ref<"left" | "right">;
  onRestore?: (state: Partial<WidgetPersistState>) => void;
}

export function usePersistState(options: UsePersistStateOptions) {
  const restoreState = (): Partial<WidgetPersistState> | null => {
    const saved = loadState();
    if (options.onRestore) {
      options.onRestore(saved || {});
    }
    return saved;
  };

  const getCurrentState = (): WidgetPersistState => ({
    open: options.open.value,
    minimized: options.minimized.value,
    promptDockVisible: options.promptDockVisible.value,
    reviewPanelVisible: options.reviewPanelVisible.value,
    bubbleOffset: options.bubbleOffset.value,
    theme: options.theme.value,
    sessionListCollapsed: options.sessionListCollapsed.value,
    splitPanelWidth: options.splitPanelWidth?.value,
    displayMode: options.displayMode?.value,
    splitPosition: options.splitPosition?.value,
  });

  const persistState = () => {
    saveState(getCurrentState());
  };

  const watchers: Ref<unknown>[] = [
    options.open,
    options.minimized,
    options.promptDockVisible,
    options.reviewPanelVisible,
    options.bubbleOffset,
    options.theme,
    options.sessionListCollapsed,
  ];

  if (options.splitPanelWidth) {
    watchers.push(options.splitPanelWidth);
  }

  if (options.displayMode) {
    watchers.push(options.displayMode);
  }

  if (options.splitPosition) {
    watchers.push(options.splitPosition);
  }

  onMounted(() => {
    restoreState();

    watch(
      watchers,
      () => {
        persistState();
      },
      { deep: true },
    );
  });

  return {
    restoreState,
    persistState,
  };
}
