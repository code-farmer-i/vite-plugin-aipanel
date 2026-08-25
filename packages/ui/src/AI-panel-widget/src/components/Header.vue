<script setup lang="ts">
import { computed } from "vue";
import { useAIPanelWidgetContext } from "../context";

const {
  title,
  sessionListTitle,
  sessionListCollapsed,
  selectMode,
  selectEnabled,
  theme,
  resolvedTheme,
  minimized,
  promptDockVisible,
  reviewPanelVisible,
  reviewPanelEnabled,
  mode,
  displayMode,
  splitPosition,
  handleToggleSessionList,
  handleToggleSelectMode,
  handleToggleTheme,
  handleToggleDisplayMode,
  handleToggleSplitPosition,
  handleClose,
  handleToggleMinimize,
  handleTogglePromptDock,
  handleToggleReviewPanel,
  handleRefresh,
  handleCreateSession,
} = useAIPanelWidgetContext();

const isSplitMode = computed(() => mode.value === "split");

const themeIconTitle = computed(() => {
  const themeLabels = {
    auto: "自动",
    light: "亮色",
    dark: "暗色",
  };
  return `主题: ${themeLabels[theme.value as keyof typeof themeLabels]} (${resolvedTheme.value})`;
});

const themeIconLabel = computed(() => {
  const themeLabels = {
    auto: "自动跟随系统",
    light: "亮色主题",
    dark: "暗色主题",
  };
  return `切换主题 - 当前: ${themeLabels[theme.value as keyof typeof themeLabels]}`;
});

const displayModeIconTitle = computed(() => {
  const displayModeLabels: Record<string, string> = {
    bubble: "气泡模式",
    split: "分屏模式",
    auto: "自动模式",
    extension: "扩展模式",
    "extension-selector": "扩展选择器模式",
  };
  return `展示模式: ${displayModeLabels[displayMode.value]}`;
});

const displayModeIconLabel = computed(() => {
  const displayModeLabels: Record<string, string> = {
    bubble: "气泡模式",
    split: "分屏模式",
    auto: "自动模式",
    extension: "扩展模式",
    "extension-selector": "扩展选择器模式",
  };
  const modes = ["bubble", "split", "auto"];
  const currentIndex = modes.indexOf(displayMode.value as "bubble" | "split" | "auto");
  const nextMode = modes[(currentIndex + 1) % modes.length] as keyof typeof displayModeLabels;
  return `切换展示模式 - 下一个: ${displayModeLabels[nextMode]}`;
});

const splitPositionIconTitle = computed(() => {
  const positionLabels = {
    left: "左侧",
    right: "右侧",
  };
  return `分栏位置: ${positionLabels[splitPosition.value]}`;
});

const splitPositionIconLabel = computed(() => {
  const nextPosition = splitPosition.value === "right" ? "左侧" : "右侧";
  return `切换分栏位置 - 下一个: ${nextPosition}`;
});
</script>

<template>
  <div class="aipanel-chat-header">
    <div class="aipanel-chat-header-left">
      <button
        class="aipanel-header-btn session-toggle"
        :class="{ active: !sessionListCollapsed }"
        type="button"
        :title="sessionListTitle"
        :aria-label="sessionListTitle"
        :aria-expanded="!sessionListCollapsed"
        @click="handleToggleSessionList"
      >
        <slot name="session-toggle-icon">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke-linecap="round"
            />
          </svg>
        </slot>
      </button>

      <button
        class="aipanel-header-btn select-btn"
        :class="{ active: selectMode }"
        type="button"
        title="选择页面元素 (Ctrl+P)"
        aria-label="选择页面元素"
        :aria-pressed="selectMode"
        :disabled="!selectEnabled"
        @click="handleToggleSelectMode"
      >
        <slot name="select-icon">
          <svg
            viewBox="0 0 1024 1024"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M512 896a384 384 0 1 0 0-768 384 384 0 0 0 0 768m0 64a448 448 0 1 1 0-896 448 448 0 0 1 0 896"
            />
            <path
              fill="currentColor"
              d="M512 96a32 32 0 0 1 32 32v192a32 32 0 0 1-64 0V128a32 32 0 0 1 32-32m0 576a32 32 0 0 1 32 32v192a32 32 0 1 1-64 0V704a32 32 0 0 1 32-32M96 512a32 32 0 0 1 32-32h192a32 32 0 0 1 0 64H128a32 32 0 0 1-32-32m576 0a32 32 0 0 1 32-32h192a32 32 0 1 1 0 64H704a32 32 0 0 1-32-32"
            />
          </svg>
        </slot>
      </button>

      <button
        class="aipanel-header-btn theme-btn"
        type="button"
        :title="themeIconTitle"
        :aria-label="themeIconLabel"
        @click="handleToggleTheme"
      >
        <slot name="theme-icon">
          <svg
            v-if="theme === 'light'"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="5"
            />
            <line
              x1="12"
              y1="1"
              x2="12"
              y2="3"
            />
            <line
              x1="12"
              y1="21"
              x2="12"
              y2="23"
            />
            <line
              x1="4.22"
              y1="4.22"
              x2="5.64"
              y2="5.64"
            />
            <line
              x1="18.36"
              y1="18.36"
              x2="19.78"
              y2="19.78"
            />
            <line
              x1="1"
              y1="12"
              x2="3"
              y2="12"
            />
            <line
              x1="21"
              y1="12"
              x2="23"
              y2="12"
            />
            <line
              x1="4.22"
              y1="19.78"
              x2="5.64"
              y2="18.36"
            />
            <line
              x1="18.36"
              y1="5.64"
              x2="19.78"
              y2="4.22"
            />
          </svg>
          <svg
            v-else-if="theme === 'dark'"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <rect
              x="2"
              y="3"
              width="20"
              height="14"
              rx="2"
              ry="2"
            />
            <line
              x1="8"
              y1="21"
              x2="16"
              y2="21"
            />
            <line
              x1="12"
              y1="17"
              x2="12"
              y2="21"
            />
            <circle
              cx="12"
              cy="10"
              r="3"
            />
            <path d="M7 7l2 2M17 7l-2 2M7 13l2-2M17 13l-2-2" />
          </svg>
        </slot>
      </button>

      <button
        v-if="displayMode !== 'extension'"
        class="aipanel-header-btn display-mode-btn"
        type="button"
        :title="displayModeIconTitle"
        :aria-label="displayModeIconLabel"
        @click="handleToggleDisplayMode"
      >
        <slot name="display-mode-icon">
          <svg
            v-if="displayMode === 'bubble'"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
            />
            <path
              d="M8 14s1.5 2 4 2 4-2 4-2"
              stroke-linecap="round"
            />
            <line
              x1="9"
              y1="9"
              x2="9.01"
              y2="9"
              stroke-linecap="round"
            />
            <line
              x1="15"
              y1="9"
              x2="15.01"
              y2="9"
              stroke-linecap="round"
            />
          </svg>
          <svg
            v-else-if="displayMode === 'split'"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="2"
            />
            <line
              x1="12"
              y1="3"
              x2="12"
              y2="21"
            />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="8"
              height="8"
              rx="1"
            />
            <rect
              x="15"
              y="3"
              width="6"
              height="8"
              rx="1"
            />
            <rect
              x="3"
              y="15"
              width="8"
              height="6"
              rx="1"
            />
            <circle
              cx="18"
              cy="18"
              r="3"
            />
          </svg>
        </slot>
      </button>
    </div>

    <span class="aipanel-chat-header-title">{{ title }}</span>

    <div class="aipanel-chat-header-actions">
      <button
        v-if="reviewPanelEnabled"
        class="aipanel-header-btn review-panel"
        :class="{ active: reviewPanelVisible }"
        type="button"
        :title="reviewPanelVisible ? '收起审查面板' : '展开审查面板'"
        :aria-label="reviewPanelVisible ? '收起审查面板' : '展开审查面板'"
        :aria-pressed="reviewPanelVisible"
        @click="handleToggleReviewPanel"
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      </button>
      <button
        v-if="displayMode === 'extension'"
        class="aipanel-header-btn refresh-btn"
        type="button"
        title="刷新面板"
        aria-label="刷新面板"
        @click="handleRefresh"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <polyline points="23,4 23,10 17,10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>
      <button
        v-if="displayMode === 'extension'"
        class="aipanel-header-btn new-session-btn"
        type="button"
        title="新建会话"
        aria-label="新建会话"
        @click="handleCreateSession"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 0.599609C3.91309 0.599609 0.599609 3.91309 0.599609 8C0.599609 9.13376 0.855461 10.2098 1.3125 11.1719L1.5918 11.7588L2.76562 11.2012L2.48633 10.6143C2.11034 9.82278 1.90039 8.93675 1.90039 8C1.90039 4.63106 4.63106 1.90039 8 1.90039C11.3689 1.90039 14.0996 4.63106 14.0996 8C14.0996 11.3689 11.3689 14.0996 8 14.0996C7.31041 14.0996 6.80528 14.0514 6.35742 13.9277C5.91623 13.8059 5.49768 13.6021 4.99707 13.2529C4.26492 12.7422 3.21611 12.5616 2.35156 13.1074L2.33789 13.1162L2.32422 13.126L1.58789 13.6436L2.01953 14.9297L3.0459 14.207C3.36351 14.0065 3.83838 14.0294 4.25293 14.3184C4.84547 14.7317 5.39743 15.011 6.01172 15.1807C6.61947 15.3485 7.25549 15.4004 8 15.4004C12.0869 15.4004 15.4004 12.0869 15.4004 8C15.4004 3.91309 12.0869 0.599609 8 0.599609ZM7.34473 4.93945V7.34961H4.93945V8.65039H7.34473V11.0605H8.64551V8.65039H11.0605V7.34961H8.64551V4.93945H7.34473Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        v-if="isSplitMode && displayMode !== 'extension'"
        class="aipanel-header-btn split-position-btn"
        type="button"
        :title="splitPositionIconTitle"
        :aria-label="splitPositionIconLabel"
        @click="handleToggleSplitPosition"
      >
        <slot name="split-position-icon">
          <svg
            v-if="splitPosition === 'right'"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="2"
            />
            <line
              x1="15"
              y1="3"
              x2="15"
              y2="21"
            />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="2"
            />
            <line
              x1="9"
              y1="3"
              x2="9"
              y2="21"
            />
          </svg>
        </slot>
      </button>
      <button
        v-if="!isSplitMode"
        class="aipanel-header-btn prompt-dock"
        type="button"
        :title="promptDockVisible ? '隐藏对话框' : '显示对话框'"
        :aria-label="promptDockVisible ? '隐藏对话框' : '显示对话框'"
        :aria-pressed="promptDockVisible"
        @click="handleTogglePromptDock"
      >
        <slot name="prompt-dock-icon">
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </slot>
      </button>
      <button
        v-if="!isSplitMode"
        class="aipanel-header-btn minimize"
        type="button"
        :title="minimized ? '展开' : '最小化'"
        :aria-label="minimized ? '展开面板' : '最小化面板'"
        :aria-pressed="minimized"
        @click="handleToggleMinimize"
      >
        <slot name="minimize-icon">
          <svg
            v-if="minimized"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
          </svg>
        </slot>
      </button>
      <button
        v-if="!isSplitMode"
        class="aipanel-header-btn close"
        type="button"
        title="关闭"
        aria-label="关闭面板"
        @click="handleClose"
      >
        <slot name="close-icon">
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </slot>
      </button>
    </div>
  </div>
</template>

<style>
.aipanel-chat-header {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 40px;
  background: var(--ap-bg-secondary);
  border-bottom: 1px solid var(--ap-border-primary);
  z-index: 5;
}

.aipanel-chat-header-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.aipanel-chat-header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ap-text-primary);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.aipanel-chat-header-actions {
  display: flex;
  gap: 4px;
}

.aipanel-header-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--ap-text-placeholder);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.aipanel-header-btn:hover {
  background: var(--ap-bg-tertiary);
  color: var(--ap-text-primary);
}

.aipanel-header-btn.close:hover {
  background: var(--ap-danger);
  color: white;
}

.aipanel-header-btn.select-btn.active,
.aipanel-header-btn.session-toggle.active,
.aipanel-header-btn.review-panel.active {
  background: var(--ap-primary);
  color: white;
}
</style>
