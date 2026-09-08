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
import type { AIPanelWidgetEmits, AIPanelWidgetProps } from "./types";
import { provideAIPanelWidgetContext } from "./context";
import type { FloatingBubbleOffset } from "./components/FloatingBubble/types";
import { NOTIFICATION_DURATION, WIDGET_MSG } from "@aipanel/core";

defineOptions({
  name: "AIPanelWidget",
});

const props = withDefaults(defineProps<AIPanelWidgetProps>(), {
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
  reviewPanelEnabled: false,
  providerSidebar: false,
  sidebarCollapseControl: "host",
});

const emit = defineEmits<AIPanelWidgetEmits>();
const slots = useSlots();

const notificationMessage = ref("");
const notificationVisible = ref(false);
const notificationMode = ref<"widget" | "page">("widget");
let notificationTimer: ReturnType<typeof setTimeout> | null = null;

const showNotification = (
  message: string,
  options?: { duration?: number; mode?: "widget" | "page" },
) => {
  const { duration = NOTIFICATION_DURATION, mode = "widget" } = options || {};
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
const localSplitPosition = ref<"left" | "right">(props.splitMode?.position ?? "right");
const minimized = ref(false);
const promptDockVisible = ref(true);
const reviewPanelVisible = ref(false);
const isRestoring = ref(true);
const iframeLoaded = ref(false);
const iframeReady = ref(false);
const splitPanelWidth = ref(props.splitPanelWidth);

const syncStateToIframe = () => {
  if (!iframeLoaded.value || !iframeReady.value) return;
  sendMessageToIframe(WIDGET_MSG.PROMPT_DOCK_VISIBILITY, { visible: promptDockVisible.value });
  sendMessageToIframe(WIDGET_MSG.MINIMIZE_STATE, { minimized: minimized.value });
  // 侧栏归属期望（mode: host | provider）：单一事实来源下发，Provider 据此决定是否展示自家侧栏
  sendMessageToIframe(WIDGET_MSG.SIDEBAR_MODE, {
    mode: props.providerSidebar ? "provider" : "host",
  });
  // Provider 接管且折叠开关归宿主：同步驱动 Provider 自家侧栏折叠状态
  if (props.providerSidebar && props.sidebarCollapseControl === "host") {
    sendMessageToIframe(WIDGET_MSG.SIDEBAR_COLLAPSE, {
      collapsed: localSessionListCollapsed.value,
    });
  }
  // 审查面板仅当 Provider 声明支持时下发，避免向无此能力的 iframe 发无效消息
  if (props.reviewPanelEnabled) {
    sendMessageToIframe(WIDGET_MSG.REVIEW_PANEL_TOGGLE, { visible: reviewPanelVisible.value });
  }
};

const handleFrameLoaded = () => {
  emit("frame-loaded");
  iframeLoaded.value = true;
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

watch(
  () => [props.providerSidebar, props.sidebarCollapseControl] as const,
  () => {
    syncStateToIframe();
  },
);

const handleToggleDisplayMode = () => {
  if (localDisplayMode.value === "extension" || localDisplayMode.value === "extension-selector")
    return;
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
    // Provider 接管且折叠开关归宿主：左上角开关同时驱动 Provider 自家侧栏
    if (props.providerSidebar && props.sidebarCollapseControl === "host") {
      sendMessageToIframe(WIDGET_MSG.SIDEBAR_COLLAPSE, { collapsed });
    }
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
  reviewPanelVisible,
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
    if (
      state.sessionListCollapsed !== undefined &&
      state.sessionListCollapsed !== props.sessionListCollapsed
    ) {
      localSessionListCollapsed.value = state.sessionListCollapsed;
      emit("update:sessionListCollapsed", state.sessionListCollapsed);
    }
    if (state.promptDockVisible !== undefined) {
      promptDockVisible.value = state.promptDockVisible;
    } else if (minimized.value) {
      promptDockVisible.value = false;
    }
    if (state.reviewPanelVisible !== undefined) {
      reviewPanelVisible.value = state.reviewPanelVisible;
    }
    if (state.splitPanelWidth !== undefined && state.splitPanelWidth !== props.splitPanelWidth) {
      handleResize(state.splitPanelWidth);
    }
    if (state.displayMode !== undefined && state.displayMode !== props.displayMode) {
      // extension / extension-selector 模式由构建配置决定，不被 localStorage 覆盖
      if (props.displayMode !== "extension" && props.displayMode !== "extension-selector") {
        localDisplayMode.value = state.displayMode;
      }
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

const handleToggleReviewPanel = () => {
  reviewPanelVisible.value = !reviewPanelVisible.value;
  sendMessageToIframe(WIDGET_MSG.REVIEW_PANEL_TOGGLE, { visible: reviewPanelVisible.value });
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

const handleIframeMessage = (event: MessageEvent) => {
  if (event.data?.type === WIDGET_MSG.READY) {
    iframeReady.value = true;
    syncStateToIframe();
  }
  if (event.data?.type === WIDGET_MSG.SIDEBAR_STATE) {
    // Provider 内部折叠变化回传：host 折叠开关下同步左上角状态；不回发消息避免环
    if (props.providerSidebar && props.sidebarCollapseControl === "host") {
      const collapsed = event.data.collapsed === true;
      if (collapsed !== localSessionListCollapsed.value) {
        localSessionListCollapsed.value = collapsed;
        emit("update:sessionListCollapsed", collapsed);
        emit("toggle-session-list", collapsed);
      }
    }
  }
};

onMounted(() => {
  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("message", handleIframeMessage);
  }
});

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", handleWindowResize);
    window.removeEventListener("message", handleIframeMessage);
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
  const chatHeight = minimized.value
    ? 300
    : Math.min(windowHeight.value * 0.86, windowHeight.value - 40);
  const gap = 24;
  const bubbleSize = 44;
  const screenMargin = 20;

  const effectiveOffset = triggerRef.value?.offset ??
    bubbleOffset.value ?? {
      x: windowWidth.value - bubbleSize - gap,
      y: windowHeight.value - bubbleSize - gap,
    };

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

provideAIPanelWidgetContext({
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
  reviewPanelVisible,
  reviewPanelEnabled: toRef(props, "reviewPanelEnabled"),
  providerSidebar: toRef(props, "providerSidebar"),
  sidebarCollapseControl: toRef(props, "sidebarCollapseControl"),
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
  handleToggleReviewPanel,
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
        :provider-sidebar="props.providerSidebar"
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
            <div class="aipanel-session-empty">暂无会话</div>
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
      class="aipanel-element-highlight"
      :style="highlightStyle"
    />

    <div
      v-show="tooltipVisible"
      class="aipanel-element-tooltip"
      :style="tooltipStyle"
    >
      <div class="aipanel-tooltip-tag">
        {{ tooltipContent.description }}
      </div>
      <div class="aipanel-tooltip-file">
        {{ tooltipContent.fileInfo }}
      </div>
    </div>

    <div
      v-if="dialogVisible"
      class="aipanel-dialog-overlay"
    >
      <div
        class="aipanel-dialog"
        role="alertdialog"
        aria-modal="true"
      >
        <div class="aipanel-dialog-content">
          <div class="aipanel-dialog-message">{{ dialogMessage }}</div>
        </div>
        <div class="aipanel-dialog-actions">
          <button
            class="aipanel-dialog-btn cancel"
            @click="handleDialogCancel"
          >
            取消
          </button>
          <button
            class="aipanel-dialog-btn confirm"
            @click="handleDialogConfirm"
          >
            确认
          </button>
        </div>
      </div>
    </div>

    <Teleport
      to="body"
      :disabled="notificationMode === 'widget'"
    >
      <div
        v-if="notificationVisible"
        :class="notificationMode === 'page' ? 'aipanel-page-notification' : 'aipanel-notification'"
        role="alert"
      >
        {{ notificationMessage }}
      </div>
    </Teleport>
  </div>
</template>

<style>
.aipanel-widget {
  --ap-bg-main: #ffffff; /* dsw alias-bg-base = neutral-bluish-00 */
  --ap-bg-secondary: #f9fafb; /* bluish-50（侧栏/工具带等弱浮起面） */
  --ap-bg-tertiary: #ebeef2; /* bluish-100（代码片/弱浮起实底） */
  --ap-overlay-bg: rgba(249, 250, 251, 0.92);

  --ap-text-primary: #0f1115; /* bluish-1000 */
  --ap-text-secondary: #61666b; /* bluish-700 */
  --ap-text-tertiary: #81858c; /* bluish-600 */
  --ap-text-placeholder: #adb2b8; /* bluish-400 */

  /* 边框分层：faint=l1(分隔线) / primary=l2(卡片描边) / secondary=l3(按钮描边) */
  --ap-border-faint: rgba(15, 17, 21, 0.04); /* alias-border-l1 */
  --ap-border-primary: rgba(15, 17, 21, 0.1); /* alias-border-l2 */
  --ap-border-secondary: rgba(15, 17, 21, 0.12); /* alias-border-l3 */

  /* 交互覆盖层（official interactive-bg-hover = #2631480f） */
  --ap-hover-bg: rgba(38, 49, 72, 0.06);

  /* 浮起按钮（新建会话等）：official button-elevated-fill / button-floating-hover */
  --ap-elevated-fill: #ffffff;
  --ap-elevated-hover: #f1f3f5;

  /* 按下态（official interactive-bg-active = #2631481a） */
  --ap-press-bg: rgba(38, 49, 72, 0.1);

  /* 主操作 CTA：官方 primary = 近黑高对比 */
  --ap-primary: #0f1115; /* bluish-1000 */
  --ap-primary-hover: #43454a; /* bluish-750 */
  --ap-on-primary: #ffffff;

  /* 品牌强调：deepseek 蓝（链接 / 进行中 / 焦点 / 加载） */
  --ap-accent: #4176e6; /* deepseek-500 */
  --ap-accent-hover: #5686fe; /* deepseek-450 */
  --ap-accent-bg: rgba(65, 118, 230, 0.1);

  --ap-danger: #ec1313; /* red-600 = 官方 light error-primary */
  --ap-danger-hover: #c40f0f;

  /* 会话状态指示器（官方同值）：pending=amber-500 / completed=green-500 / ongoing=deepseek-450 #5686fe */
  --ap-state-pending: #f59e0b;
  --ap-state-completed: #22c55e;
  --ap-state-ongoing: #5686fe;

  --ap-tooltip-bg: #1e1e1e; /* 保留原样式 */
  /* 弹窗：mask 用 dsw bg-mask-1，卡片面 = layer-2 */
  --ap-dialog-overlay: rgba(0, 0, 0, 0.24);
  --ap-dialog-bg: #ffffff;

  /* 滚动条：dsw scrollbar-bg-l1 / hover-l1（light = neutral-200 / 300） */
  --ap-scrollbar-thumb: #e5e5e5;
  --ap-scrollbar-thumb-hover: #d4d4d4;

  /* thinking 光效：DeepSeek 蓝（deepseek-400/450） */
  --ap-thinking-glow: rgba(86, 134, 254, 0.3);
  --ap-thinking-glow-strong: rgba(86, 134, 254, 0.55);

  --ap-skeleton-bg: rgba(15, 17, 21, 0.06);
  --ap-skeleton-gradient: linear-gradient(
    90deg,
    rgba(15, 17, 21, 0.04) 25%,
    rgba(15, 17, 21, 0.1) 50%,
    rgba(15, 17, 21, 0.04) 75%
  );

  --ap-shadow-sm: 0 1px 2px rgba(15, 17, 21, 0.04), 0 1px 3px rgba(15, 17, 21, 0.06);
  --ap-shadow-md: 0 2px 8px rgba(15, 17, 21, 0.06), 0 4px 16px rgba(15, 17, 21, 0.06);
  --ap-shadow-lg:
    0 0 0 0.5px rgba(15, 17, 21, 0.06), 0 4px 16px rgba(15, 17, 21, 0.08),
    0 16px 48px rgba(15, 17, 21, 0.1);
  --ap-shadow-xl:
    0 0 0 0.5px rgba(15, 17, 21, 0.08), 0 8px 32px rgba(15, 17, 21, 0.12),
    0 24px 72px rgba(15, 17, 21, 0.14);
  --ap-shadow-accent: 0 1px 2px rgba(65, 118, 230, 0.14), 0 0 0 1px rgba(65, 118, 230, 0.18);

  position: fixed;
  z-index: 999999;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
    "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.aipanel-widget.aipanel-theme-dark {
  --ap-bg-main: #151517; /* alias-bg-base = neutral-bluish-950 */
  --ap-bg-secondary: #1b1b1c; /* bluish-900（sidebar-fill / code-block） */
  --ap-bg-tertiary: #2c2c2e; /* bluish-850（hover-solid / input-major） */
  --ap-overlay-bg: rgba(21, 21, 23, 0.92);

  --ap-text-primary: #f9fafb; /* bluish-50 */
  --ap-text-secondary: #cfd3d6; /* bluish-300 */
  --ap-text-tertiary: #adb2b8; /* bluish-400 */
  --ap-text-placeholder: #81858c; /* bluish-600 */

  /* 边框分层：faint=l1(分隔线) / primary=l2(卡片描边) / secondary=l3(按钮描边) */
  --ap-border-faint: rgba(255, 255, 255, 0.06); /* alias-border-l1 */
  --ap-border-primary: rgba(255, 255, 255, 0.12); /* alias-border-l2 */
  --ap-border-secondary: rgba(255, 255, 255, 0.16); /* alias-border-l3 */

  /* 交互覆盖层（official interactive-bg-hover = #ffffff14） */
  --ap-hover-bg: rgba(255, 255, 255, 0.08);

  /* 浮起按钮（新建会话等）：official button-elevated-fill / button-floating-hover */
  --ap-elevated-fill: #43454a;
  --ap-elevated-hover: #353638;

  /* 按下态（official interactive-bg-active = #ffffff24） */
  --ap-press-bg: rgba(255, 255, 255, 0.14);

  /* 主操作 CTA：官方 primary = 白底高亮 */
  --ap-primary: #f9fafb; /* bluish-50 */
  --ap-primary-hover: #ebeef2; /* bluish-100 */
  --ap-on-primary: #0f1115;

  /* 品牌强调：deepseek 蓝 */
  --ap-accent: #679efe; /* deepseek-400 */
  --ap-accent-hover: #5686fe; /* deepseek-450 */
  --ap-accent-bg: rgba(103, 158, 254, 0.16);

  --ap-danger: #f25a5a; /* red-400 = 官方 dark error-primary */
  --ap-danger-hover: #ff8383;

  /* 会话状态指示器（官方同值）：pending=amber-500 / completed=green-500 / ongoing=deepseek-450 #5686fe */
  --ap-state-pending: #f59e0b;
  --ap-state-completed: #22c55e;
  --ap-state-ongoing: #5686fe;

  --ap-tooltip-bg: #282828; /* 保留原样式 */
  /* 弹窗：mask 用 dsw bg-mask-1，卡片面 = layer-2 */
  --ap-dialog-overlay: rgba(0, 0, 0, 0.5);
  --ap-dialog-bg: #2c2c2e;

  /* 滚动条：dsw scrollbar-bg-l1 / hover-l1（dark = neutral-700 / 600） */
  --ap-scrollbar-thumb: #3c3c3d;
  --ap-scrollbar-thumb-hover: #545557;

  /* thinking 光效：DeepSeek 蓝 */
  --ap-thinking-glow: rgba(103, 158, 254, 0.35);
  --ap-thinking-glow-strong: rgba(103, 158, 254, 0.6);

  --ap-skeleton-bg: rgba(255, 255, 255, 0.07);
  --ap-skeleton-gradient: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.05) 25%,
    rgba(255, 255, 255, 0.12) 50%,
    rgba(255, 255, 255, 0.05) 75%
  );

  --ap-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.24);
  --ap-shadow-md: 0 2px 8px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.2);
  --ap-shadow-lg:
    0 0 0 0.5px rgba(255, 255, 255, 0.06), 0 4px 16px rgba(0, 0, 0, 0.3),
    0 16px 48px rgba(0, 0, 0, 0.25);
  --ap-shadow-xl:
    0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 8px 32px rgba(0, 0, 0, 0.36),
    0 24px 72px rgba(0, 0, 0, 0.3);
  --ap-shadow-accent: 0 1px 2px rgba(103, 158, 254, 0.2), 0 0 0 1px rgba(103, 158, 254, 0.25);
}

/* 滚动条皮肤：对齐 DeepSeek ui-theme/src/styles/scrollbar.css。
   仅作用于 widget 子树，避免污染宿主页面；track/corner 透明，thumb 8px 圆角 4，
   hover 用 hover-l1 加深。FF/无 webkit 路径走标准 scrollbar-width/color。 */
@supports not selector(::-webkit-scrollbar) {
  .aipanel-widget,
  .aipanel-widget * {
    scrollbar-width: thin;
    scrollbar-color: var(--ap-scrollbar-thumb) transparent;
  }
}

.aipanel-widget ::-webkit-scrollbar,
.aipanel-widget *::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.aipanel-widget ::-webkit-scrollbar-track,
.aipanel-widget *::-webkit-scrollbar-track {
  background: transparent;
}

.aipanel-widget ::-webkit-scrollbar-thumb,
.aipanel-widget *::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--ap-scrollbar-thumb);
}

.aipanel-widget ::-webkit-scrollbar-thumb:hover,
.aipanel-widget *::-webkit-scrollbar-thumb:hover {
  background: var(--ap-scrollbar-thumb-hover);
}

.aipanel-widget ::-webkit-scrollbar-corner,
.aipanel-widget *::-webkit-scrollbar-corner {
  background: transparent;
}

.aipanel-chat {
  position: fixed;
  bottom: 20px;
  width: 700px;
  height: 86vh;
  max-height: calc(100vh - 40px);
  background: var(--ap-bg-main);
  border-radius: 16px;
  box-shadow: var(--ap-shadow-lg);
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transform: translate3d(v-bind("chatAnimationOrigin.x"), v-bind("chatAnimationOrigin.y"), 0)
    scale(0.95);
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  z-index: 99999;
}

.aipanel-chat.open {
  opacity: 1;
  visibility: visible;
  transform: translate3d(0, 0, 0) scale(1);
}

.aipanel-chat.no-transition,
.aipanel-chat.no-transition.open {
  transition: none !important;
}

.aipanel-chat.minimized {
  width: 320px;
  height: 320px;
}

.aipanel-chat.minimized .aipanel-iframe-container {
  margin-top: -146px;
}

.aipanel-chat-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.aipanel-notification {
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

.aipanel-notification::before {
  content: "💡";
  font-size: 16px;
}

.aipanel-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--ap-dialog-overlay);
  /* 对齐 DS Modal.mask：bg-mask-1 + blur(2px) */
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
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

.aipanel-dialog {
  /* 对齐 DS Modal.dialog：layer-2 面、r24、min(380px,100%)、elevation-prominent */
  width: min(380px, 100%);
  background: var(--ap-dialog-bg);
  border-radius: 24px;
  padding: 24px 24px 20px;
  box-shadow: var(--ap-shadow-xl);
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

.aipanel-dialog-content {
  margin-bottom: 20px;
}

.aipanel-dialog-message {
  /* 对齐 DS Modal.description：14px / 22 / 400 */
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  color: var(--ap-text-primary);
}

.aipanel-dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.aipanel-dialog-btn {
  height: 36px;
  padding: 0 20px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.aipanel-dialog-btn.cancel {
  background: transparent;
  border-color: var(--ap-border-primary);
  color: var(--ap-text-secondary);
}

.aipanel-dialog-btn.cancel:hover {
  background: var(--ap-hover-bg);
  color: var(--ap-text-primary);
}

.aipanel-dialog-btn.confirm {
  background: var(--ap-danger);
  color: #fff;
}

.aipanel-dialog-btn.confirm:hover {
  background: var(--ap-danger-hover);
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

.aipanel-page-notification {
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

.aipanel-page-notification::before {
  content: "💡";
  font-size: 16px;
}

.aipanel-element-highlight {
  position: fixed;
  pointer-events: none;
  z-index: 999998;
  border-radius: 4px;
}

#vue-inspector-container {
  display: none !important;
}

.aipanel-element-tooltip {
  position: fixed;
  background: var(--ap-tooltip-bg);
  color: white;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  z-index: 9999998;
  box-shadow: var(--ap-shadow-md);
  max-width: 300px;
  pointer-events: none;
  line-height: 1;
}

.aipanel-tooltip-tag {
  font-weight: 500;
  margin-bottom: 4px;
  word-break: break-all;
}

.aipanel-tooltip-file {
  font-size: 11px;
  color: var(--ap-text-placeholder);
  word-break: break-all;
}

.aipanel-element-highlight-temp {
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
  .aipanel-chat {
    width: calc(100vw - 40px);
    height: calc(100vh - 100px);
  }
}

body.has-aipanel-split {
  transition: padding 0.3s ease;
  min-width: auto;
}

body.has-aipanel-split-right {
  padding-right: var(--aipanel-split-width, 500px);
}

body.has-aipanel-split-left {
  padding-left: var(--aipanel-split-width, 500px);
}

.aipanel-widget.extension-mode {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
}

/* 插件模式下 fixed 元素改为 absolute，跟随 rootEl 定位，避免多实例切换时泄漏 */
.aipanel-widget.extension-mode .aipanel-select-mode-hint,
.aipanel-widget.extension-mode .aipanel-dialog-overlay {
  position: absolute;
}
</style>
