import { inject, provide, type Ref } from "vue";
import type {
  AIPanelWidgetSessionItem,
  AIPanelSelectedElementItem,
  AIPanelRemoveSelectedPayload,
  AIPanelSessionThinkingState,
  DisplayMode,
} from "./types";
import type { FloatingBubbleOffset } from "./components/FloatingBubble/types";

export interface AIPanelWidgetContext {
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
  reviewPanelVisible: Ref<boolean>;
  bubbleOffset: Ref<FloatingBubbleOffset | undefined>;
  mode: Ref<"bubble" | "split">;
  displayMode: Ref<DisplayMode>;
  splitPosition: Ref<"left" | "right">;

  // Session states for thinking indicator
  sessionStates: Ref<Record<string, AIPanelSessionThinkingState>>;

  // Computed
  iframeSource: Ref<string>;
  buttonActive: Ref<boolean>;
  sessionListTitle: Ref<string>;
  bubbleVisible: Ref<boolean>;
  hasSelectedElements: Ref<boolean>;
  sessionItems: Ref<AIPanelWidgetSessionItem[]>;
  selectedElementItems: Ref<AIPanelSelectedElementItem[]>;

  // Actions
  handleToggle: () => void;
  handleClose: () => void;
  handleToggleMinimize: () => void;
  handleTogglePromptDock: () => void;
  handleToggleReviewPanel: () => void;
  handleToggleSessionList: () => void;
  handleToggleTheme: () => void;
  handleToggleDisplayMode: () => void;
  handleToggleSplitPosition: () => void;
  handleEmptyAction: () => void;
  handleCreateSession: () => void;
  handleSelectSession: (item: AIPanelWidgetSessionItem) => void;
  handleDeleteSession: (item: AIPanelWidgetSessionItem) => void;
  handleToggleSelectMode: () => void;
  handleClickSelectedNode: (item: AIPanelSelectedElementItem) => void;
  handleRemoveSelectedNode: (payload: {
    item: AIPanelSelectedElementItem;
    index: number;
    source: AIPanelRemoveSelectedPayload["source"];
  }) => void;
  handleClearSelectedNodes: () => void;
  handleFrameLoaded: () => void;
  handleBubbleOffsetChange: (offset: FloatingBubbleOffset | undefined) => void;
  handleRefresh: () => void;
}

const CONTEXT_KEY = Symbol("AIPanelWidgetContext");

export function provideAIPanelWidgetContext(context: AIPanelWidgetContext) {
  provide(CONTEXT_KEY, context);
}

export function useAIPanelWidgetContext(): AIPanelWidgetContext {
  const context = inject<AIPanelWidgetContext>(CONTEXT_KEY);
  if (!context) {
    throw new Error("useAIPanelWidgetContext must be used within AIPanelWidget");
  }
  return context;
}
