<script setup lang="ts">
import { ref, computed, useSlots } from "vue";
import Frame from "./Frame.vue";
import Header from "./Header.vue";
import SessionList from "./SessionList.vue";
import SelectedNodes from "./SelectedNodes.vue";
import ResizeHandle from "./ResizeHandle.vue";

defineOptions({
  name: "ChatPanel",
});

const props = withDefaults(
  defineProps<{
    mode?: "bubble" | "split";
    open?: boolean;
    minimized?: boolean;
    positionStyle?: Record<string, string>;
    animationOrigin?: { x: string; y: string; };
    panelWidth?: number;
    resizable?: boolean;
    minWidth?: number;
    maxWidth?: number;
    noTransition?: boolean;
    dragging?: boolean;
    thinking?: boolean;
    resolvedTheme?: "light" | "dark";
    splitPosition?: "left" | "right";
    extension?: boolean;
  }>(),
  {
    mode: "bubble",
    open: false,
    minimized: false,
    positionStyle: () => ({}),
    animationOrigin: () => ({ x: "20px", y: "20px" }),
    panelWidth: 500,
    resizable: true,
    minWidth: 400,
    maxWidth: 800,
    noTransition: false,
    dragging: false,
    thinking: false,
    resolvedTheme: "light",
    splitPosition: "right",
    extension: false,
  }
);

const emit = defineEmits<{
  (e: "resize", width: number): void;
  (e: "resize-start"): void;
  (e: "resize-end"): void;
  (e: "toggle"): void;
}>();

const slots = useSlots();

const frameRef = ref<InstanceType<typeof Frame> | null>(null);

const sendMessageToIframe = (type: string, data?: Record<string, unknown>) => {
  frameRef.value?.sendMessageToIframe(type, data);
};

defineExpose({
  sendMessageToIframe,
  frameRef,
});

const handleResizeStart = () => {
  emit("resize-start");
};

const handleResize = (width: number) => {
  emit("resize", width);
};

const handleResizeEnd = () => {
  emit("resize-end");
};

const handleToggle = () => {
  emit("toggle");
};

const panelStyle = computed(() => {
  if (props.extension) {
    return {};
  }
  if (props.mode === "split") {
    return {
      width: `${props.panelWidth}px`,
    };
  }
  return props.positionStyle;
});

const panelClasses = computed(() => [
  "opencode-chat",
  {
    open: props.open,
    minimized: props.minimized,
    dragging: props.dragging,
    "no-transition": props.noTransition,
    "split-mode": props.mode === "split",
    "split-left": props.mode === "split" && props.splitPosition === "left" && !props.extension,
    "split-right": props.mode === "split" && props.splitPosition === "right" && !props.extension,
    "extension-mode": props.extension,
  },
]);
</script>

<template>
  <div
    :class="panelClasses"
    :style="panelStyle"
  >
    <ResizeHandle
      v-if="mode === 'split' && resizable && open"
      :width="panelWidth"
      :min-width="minWidth"
      :max-width="maxWidth"
      :position="splitPosition"
      @resize="handleResize"
      @resize-start="handleResizeStart"
      @resize-end="handleResizeEnd"
    />

    <button
      v-if="mode === 'split' && resizable"
      type="button"
      :class="['opencode-split-toggle-btn', { open: props.open, thinking: props.thinking, 'opencode-theme-dark': resolvedTheme === 'dark', 'split-left': splitPosition === 'left' }]"
      :aria-expanded="open"
      aria-label="切换面板"
      @click="handleToggle"
    >
      <span class="opencode-split-toggle-icon">
        <svg
          v-if="open && splitPosition === 'right'"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M9 18l6-6-6-6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          v-if="!open && splitPosition === 'right'"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M15 18l-6-6 6-6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          v-if="open && splitPosition === 'left'"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M15 18l-6-6 6-6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          v-if="!open && splitPosition === 'left'"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M9 18l6-6-6-6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </button>

    <Header>
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
    </Header>

    <div class="opencode-chat-content">
      <SessionList>
        <template #empty>
          <slot name="sessions-empty">
            <div class="opencode-session-empty">暂无会话</div>
          </slot>
        </template>
      </SessionList>

      <Frame ref="frameRef">
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
      </Frame>

      <SelectedNodes />
    </div>
  </div>
</template>

<style>
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
  display: flex;
  flex-direction: column;
  z-index: 99999;
}

.opencode-chat:not(.split-mode) {
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
  transform: translate3d(v-bind("animationOrigin.x"), v-bind("animationOrigin.y"), 0) scale(0.95);
}

.opencode-chat.split-mode {
  position: fixed;
  top: 0;
  bottom: 0;
  height: 100vh;
  max-height: 100vh;
  border-radius: 0;
  box-shadow: var(--oc-shadow-lg);
  overflow: visible;
  opacity: 1;
  visibility: visible;
  transition: transform 0.3s ease;
}

.opencode-chat.split-mode.split-right {
  right: 0;
  border-left: 1px solid var(--oc-border-primary);
  transform: translateX(100%);
}

.opencode-chat.split-mode.split-left {
  left: 0;
  border-right: 1px solid var(--oc-border-primary);
  transform: translateX(-100%);
}

.opencode-chat.split-mode .opencode-chat-content {
  overflow: hidden;
  flex: 1;
}

.opencode-chat.split-mode.open {
  transform: translateX(0);
}

.opencode-chat.split-mode.dragging {
  transition: none;
}

.opencode-chat.dragging .opencode-iframe {
  pointer-events: none;
}

/* === Extension 模式 === */
.opencode-chat.extension-mode {
  position: static;
  width: 100%;
  height: 100%;
  bottom: auto;
  left: auto;
  right: auto;
  border-radius: 0;
  border-left: none;
  border-right: none;
  max-height: none;
  box-shadow: none;
  transform: none;
  opacity: 1;
  visibility: visible;
}

.opencode-chat:not(.split-mode) {
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
}

.opencode-chat:not(.split-mode).open {
  opacity: 1;
  visibility: visible;
  transform: translate3d(0, 0, 0) scale(1);
}

.opencode-chat.no-transition,
.opencode-chat.no-transition.open {
  transition: none !important;
}

.opencode-chat.minimized:not(.split-mode) {
  width: 320px;
  height: 320px;
}

.opencode-chat.minimized:not(.split-mode) .opencode-iframe-container {
  margin-top: -146px;
}

.opencode-chat-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.opencode-session-empty {
  padding: 24px;
  text-align: center;
  color: var(--oc-text-placeholder);
  font-size: 14px;
}

.opencode-split-toggle-btn {
  position: absolute;
  left: -21px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 48px;
  background: #fff;
  border: none;
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  transition: all 0.3s ease;
  z-index: 5;
  transform-origin: right center;
}

.opencode-split-toggle-btn.split-left {
  left: auto;
  right: -21px;
  border-radius: 0 8px 8px 0;
  transform-origin: left center;
}

.opencode-split-toggle-btn:hover {
  transform: translateY(-50%) scale(1.1);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
}

.opencode-split-toggle-btn.split-left:hover {
  transform: translateY(-50%) scale(1.1);
}

.opencode-split-toggle-btn.opencode-theme-dark {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.opencode-split-toggle-btn.opencode-theme-dark::before {
  content: "";
  position: absolute;
  left: -2px;
  top: -2px;
  right: 0;
  bottom: -2px;
  border-radius: 8px 0 0 8px;
  background: linear-gradient(135deg, #8b9cf5 0%, #9d6bc7 100%);
  z-index: -1;
}

.opencode-split-toggle-btn.opencode-theme-dark.split-left::before {
  left: 0;
  right: -2px;
  border-radius: 0 8px 8px 0;
}

.opencode-split-toggle-btn.opencode-theme-dark:hover {
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
}

.opencode-split-toggle-btn.thinking {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  animation: split-thinking-glow 2s ease-in-out infinite, split-thinking-pulse 2s ease-in-out infinite;
  box-shadow:
    0 0 20px rgba(102, 126, 234, 0.6),
    0 0 40px rgba(118, 75, 162, 0.4),
    0 0 60px rgba(102, 126, 234, 0.2);
}

.opencode-split-toggle-btn.thinking::before {
  content: "";
  position: absolute;
  left: -2px;
  top: -2px;
  right: 0;
  bottom: -2px;
  border-radius: 8px 0 0 8px;
  background: linear-gradient(135deg, #8b9cf5 0%, #9d6bc7 100%);
  z-index: -1;
}

.opencode-split-toggle-btn.thinking.split-left::before {
  left: 0;
  right: -2px;
  border-radius: 0 8px 8px 0;
}

.opencode-split-toggle-btn.thinking::after {
  content: "";
  position: absolute;
  left: -3px;
  top: -3px;
  right: -1px;
  bottom: -3px;
  border-radius: 8px 0 0 8px;
  background: conic-gradient(from 180deg,
      transparent,
      rgba(102, 126, 234, 0.3),
      transparent,
      rgba(118, 75, 162, 0.3),
      transparent);
  z-index: -2;
  animation: split-thinking-rotate 2s linear infinite reverse;
  filter: blur(8px);
}

.opencode-split-toggle-btn.thinking.split-left::after {
  left: -1px;
  right: -3px;
  border-radius: 0 8px 8px 0;
}

@keyframes split-thinking-glow {

  0%,
  100% {
    box-shadow:
      0 0 20px rgba(102, 126, 234, 0.6),
      0 0 40px rgba(118, 75, 162, 0.4),
      0 0 60px rgba(102, 126, 234, 0.2);
  }

  50% {
    box-shadow:
      0 0 30px rgba(102, 126, 234, 0.8),
      0 0 60px rgba(118, 75, 162, 0.6),
      0 0 90px rgba(102, 126, 234, 0.3);
  }
}

@keyframes split-thinking-rotate {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes split-thinking-pulse {

  0%,
  100% {
    transform: translateY(-50%) scale(1);
  }

  50% {
    transform: translateY(-50%) scale(0.92);
  }
}

.opencode-split-toggle-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s ease;
}

.opencode-split-toggle-btn:hover .opencode-split-toggle-icon {
  transform: scale(1.1);
}
</style>