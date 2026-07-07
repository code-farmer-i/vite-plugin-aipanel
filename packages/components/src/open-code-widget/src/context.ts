import { inject, provide, type Ref } from "vue";
import type {
  OpenCodeWidgetSessionItem,
  OpenCodeSelectedElementItem,
  OpenCodeRemoveSelectedPayload,
  OpencodeSessionThinkingState,
  DisplayMode,
} from "./types";
import type { FloatingBubbleOffset } from "./components/FloatingBubble/types";

export interface OpenCodeWidgetContext {
  theme: Ref<string>;
  resolvedTheme: Ref<"light" | "dark">;
  title: Ref<string>;
  hotkeyLabel: Ref<string>;
  selectShortcutLabel: Ref<string>;
  selectMode: Ref<boolean>;
  selectEnabled: Ref<boolean>;
  sessionListCollapsed: Ref<boolean>;
  sessionKey: Ref<string>;
  frameLoading: Ref<boolean>;
  loadingSessionList: Ref<boolean | undefined>;
  showSessionListSkeleton: Ref<boolean>;
  showEmptyState: Ref<boolean>;
  showError: Ref<boolean>;
  emptyStateText: Ref<string>;
  emptyStateActionText: Ref<string>;
  showClearAll: Ref<boolean>;
  open: Ref<boolean>;
  thinking: Ref<boolean>;
  minimized: Ref<boolean>;
  promptDockVisible: Ref<boolean>;
  bubbleOffset: Ref<FloatingBubbleOffset | undefined>;
  mode: Ref<"bubble" | "split">;
  displayMode: Ref<DisplayMode>;
  splitPosition: Ref<"left" | "right">;

  // Session states for thinking indicator
  sessionStates: Ref<Record<string, OpencodeSessionThinkingState>>;

  // Computed
  iframeSource: Ref<string>;
  buttonActive: Ref<boolean>;
  sessionListTitle: Ref<string>;
  bubbleVisible: Ref<boolean>;
  hasSelectedElements: Ref<boolean>;
  sessionItems: Ref<OpenCodeWidgetSessionItem[]>;
  selectedElementItems: Ref<OpenCodeSelectedElementItem[]>;

  // Actions
  handleToggle: () => void;
  handleClose: () => void;
  handleToggleMinimize: () => void;
  handleTogglePromptDock: () => void;
  handleToggleSessionList: () => void;
  handleToggleTheme: () => void;
  handleToggleDisplayMode: () => void;
  handleToggleSplitPosition: () => void;
  handleEmptyAction: () => void;
  handleCreateSession: () => void;
  handleSelectSession: (item: OpenCodeWidgetSessionItem) => void;
  handleDeleteSession: (item: OpenCodeWidgetSessionItem) => void;
  handleToggleSelectMode: () => void;
  handleClickSelectedNode: (item: OpenCodeSelectedElementItem) => void;
  handleRemoveSelectedNode: (payload: {
    item: OpenCodeSelectedElementItem;
    index: number;
    source: OpenCodeRemoveSelectedPayload["source"];
  }) => void;
  handleClearSelectedNodes: () => void;
  handleFrameLoaded: () => void;
  handleBubbleOffsetChange: (offset: FloatingBubbleOffset | undefined) => void;
  handleRefresh: () => void;
}

const CONTEXT_KEY = Symbol("OpenCodeWidgetContext");

export function provideOpenCodeWidgetContext(context: OpenCodeWidgetContext) {
  provide(CONTEXT_KEY, context);
}

export function useOpenCodeWidgetContext(): OpenCodeWidgetContext {
  const context = inject<OpenCodeWidgetContext>(CONTEXT_KEY);
  if (!context) {
    throw new Error("useOpenCodeWidgetContext must be used within OpenCodeWidget");
  }
  return context;
}
