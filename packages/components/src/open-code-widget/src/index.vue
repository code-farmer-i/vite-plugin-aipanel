<script setup lang="ts">
import { useSlots, toRef, ref, watch, computed, nextTick, onMounted, onUnmounted } from "vue";
import ChatPanel from "./components/ChatPanel.vue";
import SelectHint from "./components/SelectHint.vue";
import Trigger from "./components/Trigger.vue";
import { useSelection } from "../composables/use-selection";
import { useSession } from "../composables/use-session";
import { useWidget } from "../composables/use-widget";
import { useInspector } from "../composables/use-inspector";
import { usePersistState } from "../composables/use-persist-state";
import { useSplitMode } from "../composables/use-split";
import type { OpenCodeWidgetEmits, OpenCodeWidgetProps } from "./types";
import { provideOpenCodeWidgetContext } from "./context";
import type { FloatingBubbleOffset } from "./components/FloatingBubble/types";
import { WIDGET_MSG } from "@vite-plugin-opencode-assistant/shared";

defineOptions({
  name: "OpencodeWidget",
});

const props = withDefaults(defineProps<OpenCodeWidgetProps>(), {
  open: false,
  theme: "auto",
  title: "AI 助手",
  hotkeyLabel: "Ctrl+K",
  selectShortcutLabel: "按 ESC 或 Ctrl+P 退出",
  selectMode: false,
  sessionKey: "id",
  sessionListCollapsed: true,
  frameLoading: false,
  showSessionListSkeleton: false,
  showEmptyState: false,
  showError: false,
  iframeSrc: "",
  currentSessionId: null,
  sessions: () => [],
  selectedElements: () => [],
  showClearAll: true,
  selectEnabled: true,
  emptyStateText: "当前项目暂无会话",
  emptyStateActionText: "立即创建",
  thinking: false,
  displayMode: "bubble",
  splitMode: undefined,
  splitPanelWidth: 500,
  hideBubble: false,
});

const emit = defineEmits<OpenCodeWidgetEmits>();
const slots = useSlots();

const notificationMessage = ref("");
const notificationVisible = ref(false);
const notificationMode = ref<"widget" | "page">("widget");
let notificationTimer: ReturnType<typeof setTimeout> | null = null;

const showNotification = (message: string, options?: { duration?: number; mode?: "widget" | "page"; }) => {
  const { duration = 3000, mode = "widget" } = options || {};
  notificationMessage.value = message;
  notificationVisible.value = true;
  notificationMode.value = mode;
  if (notificationTimer) clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {
    notificationVisible.value = false;
  }, duration);
};

const dialogVisible = ref(false);
const dialogMessage = ref("");
let dialogResolve: ((value: boolean) => void) | null = null;

const showConfirmDialog = (message: string): Promise<boolean> => {
  dialogMessage.value = message;
  dialogVisible.value = true;
  return new Promise((resolve) => {
    dialogResolve = resolve;
  });
};

const handleDialogConfirm = () => {
  dialogVisible.value = false;
  if (dialogResolve) dialogResolve(true);
};

const handleDialogCancel = () => {
  dialogVisible.value = false;
  if (dialogResolve) dialogResolve(false);
};

const frameRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const triggerRef = ref<InstanceType<typeof Trigger> | null>(null);

const sendMessageToIframe = (type: string, data?: Record<string, unknown>) => {
  frameRef.value?.sendMessageToIframe(type, data);
};

const localSessionListCollapsed = ref(props.sessionListCollapsed);
const localDisplayMode = ref(props.displayMode);
const localSplitPosition = ref<"left" | "right">(
  props.splitMode?.position ?? "right"
);
const minimized = ref(false);
const promptDockVisible = ref(true);
const isRestoring = ref(true);
const iframeLoaded = ref(false);
const splitPanelWidth = ref(props.splitPanelWidth);

const syncStateToIframe = () => {
  if (!iframeLoaded.value) return;
  sendMessageToIframe(WIDGET_MSG.PROMPT_DOCK_VISIBILITY, { visible: promptDockVisible.value });
  sendMessageToIframe(WIDGET_MSG.MINIMIZE_STATE, { minimized: minimized.value });
};

const handleFrameLoaded = () => {
  emit("frame-loaded");
  iframeLoaded.value = true;
  syncStateToIframe();
};

watch(
  () => props.sessionListCollapsed,
  (val: boolean) => {
    localSessionListCollapsed.value = val;
  },
);

watch(
  () => props.splitPanelWidth,
  (val: number) => {
    splitPanelWidth.value = val;
  },
);

watch(
  () => props.displayMode,
  (val) => {
    localDisplayMode.value = val;
  },
);

const handleToggleDisplayMode = () => {
  if (localDisplayMode.value === "extension" || localDisplayMode.value === "extension-selector") return;
  const modes: ("bubble" | "split" | "auto")[] = ["bubble", "split", "auto"];
  const currentIndex = modes.indexOf(localDisplayMode.value);
  const nextIndex = (currentIndex + 1) % modes.length;
  localDisplayMode.value = modes[nextIndex];
};

const {
  buttonActive,
  containerClasses,
  iframeSource,
  sessionListTitle,
  resolvedTheme,
  handleClose,
  handleEmptyAction,
  handleToggle,
  handleToggleSessionList,
  handleToggleTheme,
} = useWidget({
  theme: toRef(props, "theme"),
  open: toRef(props, "open"),
  selectMode: toRef(props, "selectMode"),
  iframeSrc: toRef(props, "iframeSrc"),
  sessionListCollapsed: localSessionListCollapsed,
  onToggle: (nextOpen) => {
    emit("update:open", nextOpen);
    emit("toggle", nextOpen);
  },
  onToggleSelectMode: (mode) => {
    emit("update:selectMode", mode);
    emit("toggle-select-mode", mode);
  },
  onClose: () => {
    emit("update:open", false);
    emit("close");
  },
  onToggleSessionList: (collapsed) => {
    localSessionListCollapsed.value = collapsed;
    emit("update:sessionListCollapsed", collapsed);
    emit("toggle-session-list", collapsed);
  },
  onEmptyAction: () => {
    emit("empty-action");
  },
  onToggleTheme: (newTheme) => {
    emit("update:theme", newTheme);
    emit("toggle-theme", newTheme);
  },
});

const { sessionItems, handleCreateSession, handleDeleteSession, handleSelectSession } = useSession({
  sessions: toRef(props, "sessions"),
  currentSessionId: toRef(props, "currentSessionId"),
  onCreateSession: () => emit("create-session"),
  onSelectSession: (session) => {
    emit("update:currentSessionId", session.id);
    emit("select-session", session);
  },
  onDeleteSession: (session) => emit("delete-session", session),
  showConfirmDialog,
});

const {
  bubbleVisible,
  hasSelectedElements,
  selectedElementItems,
  handleClearSelectedNodes,
  handleClickSelectedNode,
  handleRemoveSelectedNode,
  handleToggleSelectMode,
} = useSelection({
  selectMode: toRef(props, "selectMode"),
  selectedElements: toRef(props, "selectedElements"),
  onToggleSelectMode: (mode) => {
    emit("update:selectMode", mode);
    emit("toggle-select-mode", mode);
  },
  onRemoveSelectedNode: (payload) => {
    emit("remove-selected-node", payload);
    const newElements = [...props.selectedElements];
    newElements.splice(payload.index, 1);
    emit("update:selectedElements", newElements);
  },
  onClearSelectedNodes: () => {
    emit("clear-selected-nodes");
    emit("update:selectedElements", []);
  },
  showConfirmDialog,
});

const { highlightVisible, highlightStyle, tooltipVisible, tooltipStyle, tooltipContent } =
  useInspector({
    selectMode: toRef(props, "selectMode"),
    onAddSelectedNode: (element) => {
      emit("click-selected-node", element);
    },
    onExitSelectMode: () => {
      emit("update:selectMode", false);
      emit("toggle-select-mode", false);
    },
  });

const bubbleOffset = ref<FloatingBubbleOffset | undefined>(undefined);

const {
  effectiveMode,
  isSplitMode,
  isExtensionMode,
  panelWidth,
  splitConfig,
  splitPosition,
  handleResize,
  handleToggle: handleSplitToggle,
  handleTogglePosition,
} = useSplitMode({
  displayMode: localDisplayMode,
  splitMode: toRef(props, "splitMode"),
  open: toRef(props, "open"),
  splitPosition: localSplitPosition,
  onOpenChange: (nextOpen) => {
    emit("update:open", nextOpen);
    emit("toggle", nextOpen);
  },
  onWidthChange: (width) => {
    splitPanelWidth.value = width;
    emit("update:splitPanelWidth", width);
    emit("split-panel-width-change", width);
  },
  onPositionChange: (position) => {
    localSplitPosition.value = position;
  },
});

usePersistState({
  open: toRef(props, "open"),
  minimized,
  promptDockVisible,
  bubbleOffset,
  theme: toRef(props, "theme"),
  sessionListCollapsed: localSessionListCollapsed,
  splitPanelWidth,
  displayMode: localDisplayMode,
  splitPosition: localSplitPosition,
  onRestore: (state) => {
    if (state.open !== undefined && state.open !== props.open) {
      emit("update:open", state.open);
      emit("toggle", state.open);
    }
    if (state.minimized !== undefined) {
      minimized.value = state.minimized;
    }
    if (state.bubbleOffset !== undefined) {
      const bubbleSize = 44;
      const margin = 10;
      const maxX = window.innerWidth - bubbleSize - margin;
      const maxY = window.innerHeight - bubbleSize - margin;

      bubbleOffset.value = {
        x: Math.max(margin, Math.min(state.bubbleOffset.x, maxX)),
        y: Math.max(margin, Math.min(state.bubbleOffset.y, maxY)),
      };
    }
    if (state.theme !== undefined && state.theme !== props.theme) {
      emit("update:theme", state.theme);
      emit("toggle-theme", state.theme);
    }
    if (state.sessionListCollapsed !== undefined && state.sessionListCollapsed !== props.sessionListCollapsed) {
      localSessionListCollapsed.value = state.sessionListCollapsed;
      emit("update:sessionListCollapsed", state.sessionListCollapsed);
    }
    if (state.promptDockVisible !== undefined) {
      promptDockVisible.value = state.promptDockVisible;
    } else if (minimized.value) {
      promptDockVisible.value = false;
    }
    if (state.splitPanelWidth !== undefined && state.splitPanelWidth !== props.splitPanelWidth) {
      handleResize(state.splitPanelWidth);
    }
    if (state.displayMode !== undefined && state.displayMode !== props.displayMode) {
      localDisplayMode.value = state.displayMode;
    }
    if (state.splitPosition !== undefined) {
      localSplitPosition.value = state.splitPosition;
    }
    nextTick(() => {
      syncStateToIframe();
      setTimeout(() => {
        isRestoring.value = false;
      }, 50);
    });
  },
});

const handleToggleMinimize = () => {
  minimized.value = !minimized.value;
  promptDockVisible.value = !minimized.value;
  sendMessageToIframe(WIDGET_MSG.PROMPT_DOCK_VISIBILITY, { visible: promptDockVisible.value });
  sendMessageToIframe(WIDGET_MSG.MINIMIZE_STATE, { minimized: minimized.value });
};

const handleTogglePromptDock = () => {
  promptDockVisible.value = !promptDockVisible.value;
  sendMessageToIframe(WIDGET_MSG.PROMPT_DOCK_VISIBILITY, { visible: promptDockVisible.value });
};

const handleRefresh = () => {
  window.location.reload();
};

type BubbleQuadrant = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const windowWidth = ref(typeof window !== "undefined" ? window.innerWidth : 0);
const windowHeight = ref(typeof window !== "undefined" ? window.innerHeight : 0);

const handleWindowResize = () => {
  if (typeof window !== "undefined") {
    windowWidth.value = window.innerWidth;
    windowHeight.value = window.innerHeight;
  }
};

onMounted(() => {
  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleWindowResize);
  }
});

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", handleWindowResize);
  }
});

const bubbleQuadrant = computed((): BubbleQuadrant => {
  if (typeof window === "undefined") return "bottom-right";

  const centerX = windowWidth.value / 2;
  const centerY = windowHeight.value / 2;

  const bubbleSize = 44;
  const currentOffset = triggerRef.value?.offset ?? bubbleOffset.value;
  const effectiveX = (currentOffset?.x ?? windowWidth.value - bubbleSize - 24) + bubbleSize / 2;
  const effectiveY = (currentOffset?.y ?? windowHeight.value - bubbleSize - 24) + bubbleSize / 2;

  if (effectiveX >= centerX && effectiveY >= centerY) {
    return "bottom-right";
  } else if (effectiveX < centerX && effectiveY >= centerY) {
    return "bottom-left";
  } else if (effectiveX >= centerX && effectiveY < centerY) {
    return "top-right";
  } else {
    return "top-left";
  }
});

const isBubbleOnRightSide = computed(() => {
  const quadrant = bubbleQuadrant.value;
  return quadrant === "top-right" || quadrant === "bottom-right";
});

const chatPositionStyle = computed(() => {
  if (typeof window === "undefined") return {};

  const chatWidth = minimized.value ? 300 : 700;
  const chatHeight = minimized.value ? 300 : Math.min(windowHeight.value * 0.86, windowHeight.value - 40);
  const gap = 24;
  const bubbleSize = 44;
  const screenMargin = 20;

  const effectiveOffset = triggerRef.value?.offset ?? bubbleOffset.value ?? { x: windowWidth.value - bubbleSize - gap, y: windowHeight.value - bubbleSize - gap };

  const style: Record<string, string> = {};

  if (isBubbleOnRightSide.value) {
    let rightPos = windowWidth.value - effectiveOffset.x + gap;
    const minRight = screenMargin;
    const maxRight = windowWidth.value - chatWidth - screenMargin;

    if (rightPos > maxRight) {
      rightPos = maxRight;
    }
    if (rightPos < minRight) {
      rightPos = minRight;
    }

    style.right = `${rightPos}px`;
    style.left = "auto";
  } else {
    let leftPos = effectiveOffset.x + bubbleSize + gap;
    const minLeft = screenMargin;
    const maxLeft = windowWidth.value - chatWidth - screenMargin;

    if (leftPos > maxLeft) {
      leftPos = maxLeft;
    }
    if (leftPos < minLeft) {
      leftPos = minLeft;
    }

    style.left = `${leftPos}px`;
    style.right = "auto";
  }

  let bottomPos = windowHeight.value - effectiveOffset.y - bubbleSize;
  const maxBottom = windowHeight.value - chatHeight - screenMargin;

  if (bottomPos > maxBottom) {
    bottomPos = maxBottom;
  }

  if (bottomPos < screenMargin) {
    bottomPos = screenMargin;
  }

  style.bottom = `${bottomPos}px`;

  return style;
});

const handleBubbleOffsetChange = (offset: FloatingBubbleOffset | undefined) => {
  bubbleOffset.value = offset;
};

const handleResizeStart = () => {
  isDragging.value = true;
};

const handleResizeEnd = () => {
  isDragging.value = false;
};

const chatAnimationOrigin = computed(() => {
  const quadrant = bubbleQuadrant.value;
  switch (quadrant) {
    case "top-left":
      return { x: "-20px", y: "-20px" };
    case "top-right":
      return { x: "20px", y: "-20px" };
    case "bottom-left":
      return { x: "-20px", y: "20px" };
    case "bottom-right":
    default:
      return { x: "20px", y: "20px" };
  }
});

const isDragging = ref(false);
let wasOpenBeforeDrag = false;

const handleDragStart = () => {
  isDragging.value = true;
  wasOpenBeforeDrag = props.open;
  if (props.open) {
    emit("update:open", false);
  }
};

const handleDragEnd = () => {
  isDragging.value = false;
  if (wasOpenBeforeDrag) {
    emit("update:open", true);
  }
};

provideOpenCodeWidgetContext({
  theme: toRef(props, "theme"),
  resolvedTheme,
  title: toRef(props, "title"),
  hotkeyLabel: toRef(props, "hotkeyLabel"),
  selectShortcutLabel: toRef(props, "selectShortcutLabel"),
  selectMode: toRef(props, "selectMode"),
  selectEnabled: toRef(props, "selectEnabled"),
  sessionListCollapsed: localSessionListCollapsed,
  sessionKey: toRef(props, "sessionKey"),
  frameLoading: toRef(props, "frameLoading"),
  loadingSessionList: toRef(props, "loadingSessionList"),
  showSessionListSkeleton: toRef(props, "showSessionListSkeleton"),
  showEmptyState: toRef(props, "showEmptyState"),
  showError: toRef(props, "showError"),
  emptyStateText: toRef(props, "emptyStateText"),
  emptyStateActionText: toRef(props, "emptyStateActionText"),
  showClearAll: toRef(props, "showClearAll"),
  open: toRef(props, "open"),
  thinking: toRef(props, "thinking"),
  minimized,
  promptDockVisible,
  bubbleOffset,
  mode: effectiveMode,
  displayMode: localDisplayMode,
  splitPosition,
  sessionStates: computed(() => props.sessionStates ?? {}),
  iframeSource,
  buttonActive,
  sessionListTitle,
  bubbleVisible,
  hasSelectedElements,
  sessionItems,
  selectedElementItems,
  handleToggle,
  handleClose,
  handleToggleMinimize,
  handleTogglePromptDock,
  handleToggleSessionList,
  handleToggleTheme,
  handleToggleDisplayMode,
  handleToggleSplitPosition: handleTogglePosition,
  handleEmptyAction,
  handleCreateSession,
  handleSelectSession,
  handleDeleteSession,
  handleToggleSelectMode,
  handleClickSelectedNode,
  handleRemoveSelectedNode: (payload) =>
    handleRemoveSelectedNode(payload.item, payload.index, payload.source),
  handleClearSelectedNodes,
  handleFrameLoaded,
  handleBubbleOffsetChange,
  handleRefresh,
});

defineExpose({
  showNotification,
  showConfirmDialog,
  sendMessageToIframe,
  isSplitMode,
});
</script>

<template>
  <div :class="[...containerClasses, { 'extension-mode': isExtensionMode }]">
    <template v-if="displayMode !== 'extension-selector'">
      <Trigger
        v-if="!isSplitMode && !props.hideBubble"
        ref="triggerRef"
        @drag-start="handleDragStart"
        @drag-end="handleDragEnd"
      >
        <template
          v-if="slots['button-icon']"
          #default
        >
          <slot name="button-icon" />
        </template>
      </Trigger>

      <ChatPanel
        ref="frameRef"
        :mode="effectiveMode"
        :open="open"
        :minimized="minimized"
        :position-style="chatPositionStyle"
        :animation-origin="chatAnimationOrigin"
        :panel-width="panelWidth"
        :resizable="splitConfig.resizable"
        :min-width="splitConfig.minWidth"
        :max-width="splitConfig.maxWidth"
        :no-transition="isRestoring"
        :dragging="isDragging"
        :thinking="thinking"
        :resolved-theme="resolvedTheme"
        :split-position="splitPosition"
        :extension="isExtensionMode"
        @resize="handleResize"
        @resize-start="handleResizeStart"
        @resize-end="handleResizeEnd"
        @toggle="handleSplitToggle"
      >
        <template
          v-if="slots['session-toggle-icon']"
          #session-toggle-icon
        >
          <slot name="session-toggle-icon" />
        </template>

        <template
          v-if="slots['select-icon']"
          #select-icon
        >
          <slot name="select-icon" />
        </template>

        <template
          v-if="slots['close-icon']"
          #close-icon
        >
          <slot name="close-icon" />
        </template>

        <template #sessions-empty>
          <slot name="sessions-empty">
            <div class="opencode-session-empty">暂无会话</div>
          </slot>
        </template>

        <template
          v-if="slots['empty-state']"
          #empty-state
        >
          <slot name="empty-state" />
        </template>

        <template
          v-if="slots.loading"
          #loading
        >
          <slot name="loading" />
        </template>

        <template
          v-if="slots.error"
          #error
        >
          <slot name="error" />
        </template>

        <template
          v-if="slots.content"
          #content
        >
          <slot name="content" />
        </template>
      </ChatPanel>

      <SelectHint />
    </template>

    <div
      v-show="highlightVisible"
      class="opencode-element-highlight"
      :style="highlightStyle"
    />

    <div
      v-show="tooltipVisible"
      class="opencode-element-tooltip"
      :style="tooltipStyle"
    >
      <div class="opencode-tooltip-tag">
        {{ tooltipContent.description }}
      </div>
      <div class="opencode-tooltip-file">
        {{ tooltipContent.fileInfo }}
      </div>
    </div>

    <div
      v-if="dialogVisible"
      class="opencode-dialog-overlay"
    >
      <div
        class="opencode-dialog"
        role="alertdialog"
        aria-modal="true"
      >
        <div class="opencode-dialog-content">
          <div class="opencode-dialog-message">{{ dialogMessage }}</div>
        </div>
        <div class="opencode-dialog-actions">
          <button
            class="opencode-dialog-btn cancel"
            @click="handleDialogCancel"
          >取消</button>
          <button
            class="opencode-dialog-btn confirm"
            @click="handleDialogConfirm"
          >确认</button>
        </div>
      </div>
    </div>

    <Teleport
      to="body"
      :disabled="notificationMode === 'widget'"
    >
      <div
        v-if="notificationVisible"
        :class="notificationMode === 'page' ? 'opencode-page-notification' : 'opencode-notification'"
        role="alert"
      >
        {{ notificationMessage }}
      </div>
    </Teleport>
  </div>
</template>

<style>
.opencode-widget {
  --oc-bg-main: #ffffff;
  --oc-bg-secondary: #f8f9fa;
  --oc-bg-tertiary: #f3f4f6;
  --oc-overlay-bg: rgba(255, 255, 255, 0.9);
  --oc-bg-inverse: #1e1e1e;

  --oc-text-primary: #282828;
  --oc-text-secondary: #4b5563;
  --oc-text-tertiary: #6b7280;
  --oc-text-placeholder: #9ca3af;
  --oc-text-inverse: #ffffff;

  --oc-border-primary: #e5e7eb;
  --oc-border-secondary: #d1d5db;

  --oc-primary: #3b82f6;
  --oc-primary-hover: #2563eb;
  --oc-primary-bg: rgba(59, 130, 246, 0.1);

  --oc-danger: #ef4444;
  --oc-danger-hover: #dc2626;
  --oc-danger-active: #b91c1c;

  --oc-success: #10b981;

  --oc-overlay: rgba(0, 0, 0, 0.5);
  --oc-tooltip-bg: #1e1e1e;
  --oc-dialog-overlay: rgba(0, 0, 0, 0.5);

  --oc-thinking-gradient-1: #10b981;
  --oc-thinking-gradient-2: #059669;
  --oc-thinking-glow: rgba(16, 185, 129, 0.3);
  --oc-thinking-glow-strong: rgba(16, 185, 129, 0.6);

  --oc-skeleton-bg: #e5e7eb;
  --oc-skeleton-gradient: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);

  --oc-shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.1);
  --oc-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
  --oc-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.12);
  --oc-shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.3);
  --oc-shadow-primary: 0 2px 4px rgba(59, 130, 246, 0.2);
  --oc-shadow-primary-hover: 0 4px 6px rgba(59, 130, 246, 0.3);
  --oc-shadow-danger: 0 4px 12px rgba(239, 68, 68, 0.3);

  --oc-trigger-bg: #3b82f6;
  --oc-trigger-bg-hover: #2563eb;
  --oc-trigger-bg-active: #1d4ed8;
  --oc-trigger-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
  --oc-trigger-shadow-hover: 0 4px 12px rgba(59, 130, 246, 0.4);
  --oc-trigger-shadow-active: 0 4px 12px rgba(59, 130, 246, 0.5);

  position: fixed;
  z-index: 999999;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.opencode-widget.opencode-theme-dark {
  --oc-bg-main: #1a1a1a;
  --oc-bg-secondary: #1e1e1e;
  --oc-bg-tertiary: #282828;
  --oc-overlay-bg: rgba(26, 26, 26, 0.9);
  --oc-bg-inverse: #ffffff;

  --oc-text-primary: #f3f4f6;
  --oc-text-secondary: #d1d5db;
  --oc-text-tertiary: #9ca3af;
  --oc-text-placeholder: #6b7280;
  --oc-text-inverse: #282828;

  --oc-border-primary: #282828;
  --oc-border-secondary: #4b5563;

  --oc-primary: #3b82f6;
  --oc-primary-hover: #2563eb;
  --oc-primary-bg: rgba(59, 130, 246, 0.15);

  --oc-danger: #ef4444;
  --oc-danger-hover: #dc2626;
  --oc-danger-active: #b91c1c;

  --oc-success: #10b981;

  --oc-overlay: rgba(26, 26, 26, 0.9);
  --oc-tooltip-bg: #282828;
  --oc-dialog-overlay: rgba(0, 0, 0, 0.7);

  --oc-thinking-gradient-1: #34d399;
  --oc-thinking-gradient-2: #10b981;
  --oc-thinking-glow: rgba(52, 211, 153, 0.3);
  --oc-thinking-glow-strong: rgba(52, 211, 153, 0.6);

  --oc-skeleton-bg: #151515;
  --oc-skeleton-gradient: linear-gradient(90deg, #282828 25%, #4b5563 50%, #282828 75%);

  --oc-shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.3);
  --oc-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --oc-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4);
  --oc-shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.6);
  --oc-shadow-primary: 0 2px 4px rgba(59, 130, 246, 0.3);
  --oc-shadow-primary-hover: 0 4px 6px rgba(59, 130, 246, 0.4);
  --oc-shadow-danger: 0 4px 12px rgba(239, 68, 68, 0.4);

  --oc-trigger-bg: #60a5fa;
  --oc-trigger-bg-hover: #3b82f6;
  --oc-trigger-bg-active: #2563eb;
  --oc-trigger-shadow: 0 2px 8px rgba(96, 165, 250, 0.4);
  --oc-trigger-shadow-hover: 0 4px 12px rgba(96, 165, 250, 0.5);
  --oc-trigger-shadow-active: 0 4px 12px rgba(96, 165, 250, 0.6);
}

.opencode-chat {
  position: fixed;
  bottom: 20px;
  width: 700px;
  height: 86vh;
  max-height: calc(100vh - 40px);
  background: var(--oc-bg-main);
  border-radius: 16px;
  box-shadow: var(--oc-shadow-lg);
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transform: translate3d(v-bind("chatAnimationOrigin.x"), v-bind("chatAnimationOrigin.y"), 0) scale(0.95);
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  z-index: 99999;
}

.opencode-chat.open {
  opacity: 1;
  visibility: visible;
  transform: translate3d(0, 0, 0) scale(1);
}

.opencode-chat.no-transition,
.opencode-chat.no-transition.open {
  transition: none !important;
}

.opencode-chat.minimized {
  width: 320px;
  height: 320px;
}

.opencode-chat.minimized .opencode-iframe-container {
  margin-top: -146px;
}

.opencode-chat-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.opencode-notification {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  box-shadow:
    0 4px 16px rgba(59, 130, 246, 0.4),
    0 0 0 2px rgba(59, 130, 246, 0.2);
  animation: slideDown 0.3s ease;
  z-index: 10000000;
  display: flex;
  align-items: center;
  gap: 10px;
}

.opencode-notification::before {
  content: "💡";
  font-size: 16px;
}

.opencode-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--oc-dialog-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999999;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.opencode-dialog {
  background: var(--oc-bg-main);
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  max-width: 400px;
  box-shadow: var(--oc-shadow-xl);
  animation: scaleIn 0.2s ease;
}

@keyframes scaleIn {
  from {
    transform: scale(0.9);
    opacity: 0;
  }

  to {
    transform: scale(1);
    opacity: 1;
  }
}

.opencode-dialog-content {
  margin-bottom: 20px;
}

.opencode-dialog-message {
  font-size: 15px;
  color: var(--oc-text-primary);
  line-height: 1.5;
}

.opencode-dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.opencode-dialog-btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.opencode-dialog-btn.cancel {
  background: var(--oc-bg-tertiary);
  color: var(--oc-text-primary);
}

.opencode-dialog-btn.cancel:hover {
  background: var(--oc-text-primary);
  color: var(--oc-bg-main);
}

.opencode-dialog-btn.confirm {
  background: var(--oc-danger);
  color: white;
}

.opencode-dialog-btn.confirm:hover {
  background: var(--oc-danger-hover);
}

@keyframes slideDown {
  from {
    transform: translateX(-50%) translateY(-100%);
    opacity: 0;
  }

  to {
    transform: translateX(-50%) translateY(0px);
    opacity: 1;
  }
}

.opencode-page-notification {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  box-shadow:
    0 4px 16px rgba(59, 130, 246, 0.4),
    0 0 0 2px rgba(59, 130, 246, 0.2);
  animation: slideDown 0.3s ease;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.opencode-page-notification::before {
  content: "💡";
  font-size: 16px;
}

.opencode-element-highlight {
  position: fixed;
  pointer-events: none;
  z-index: 999998;
  border-radius: 4px;
}

#vue-inspector-container {
  display: none !important;
}

.opencode-element-tooltip {
  position: fixed;
  background: var(--oc-tooltip-bg);
  color: white;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  z-index: 9999998;
  box-shadow: var(--oc-shadow-md);
  max-width: 300px;
  pointer-events: none;
  line-height: 1;
}

.opencode-tooltip-tag {
  font-weight: 500;
  margin-bottom: 4px;
  word-break: break-all;
}

.opencode-tooltip-file {
  font-size: 11px;
  color: var(--oc-text-placeholder);
  word-break: break-all;
}

.opencode-element-highlight-temp {
  position: absolute;
  pointer-events: none;
  z-index: 999998;
  border-radius: 4px;
  animation: highlight-pulse 2s ease-out forwards;
}

@keyframes highlight-pulse {
  0% {
    opacity: 1;
    transform: scale(1);
  }

  50% {
    opacity: 0.8;
    transform: scale(1.02);
  }

  100% {
    opacity: 0;
    transform: scale(1);
  }
}

@media (max-width: 768px) {
  .opencode-chat {
    width: calc(100vw - 40px);
    height: calc(100vh - 100px);
  }
}

body.has-opencode-split {
  transition: padding 0.3s ease;
  min-width: auto;
}

body.has-opencode-split-right {
  padding-right: var(--opencode-split-width, 500px);
}

body.has-opencode-split-left {
  padding-left: var(--opencode-split-width, 500px);
}

.opencode-widget.extension-mode {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
}

/* 插件模式下 fixed 元素改为 absolute，跟随 rootEl 定位，避免多实例切换时泄漏 */
.opencode-widget.extension-mode .opencode-select-mode-hint,
.opencode-widget.extension-mode .opencode-dialog-overlay {
  position: absolute;
}
</style>
