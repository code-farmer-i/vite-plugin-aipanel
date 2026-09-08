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
    animationOrigin?: { x: string; y: string };
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
    /** Provider 接管会话侧栏时隐藏原生 SessionList */
    providerSidebar?: boolean;
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
    providerSidebar: false,
  },
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
  "aipanel-chat",
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
      :class="[
        'aipanel-split-toggle-btn',
        {
          open: props.open,
          thinking: props.thinking,
          'aipanel-theme-dark': resolvedTheme === 'dark',
          'split-left': splitPosition === 'left',
        },
      ]"
      :aria-expanded="open"
      aria-label="切换面板"
      @click="handleToggle"
    >
      <span class="aipanel-split-toggle-icon">
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

    <div class="aipanel-chat-content">
      <SessionList v-if="!providerSidebar">
        <template #empty>
          <slot name="sessions-empty">
            <div class="aipanel-session-empty">暂无会话</div>
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
  display: flex;
  flex-direction: column;
  z-index: 99999;
}

.aipanel-chat:not(.split-mode) {
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
  transform: translate3d(v-bind("animationOrigin.x"), v-bind("animationOrigin.y"), 0) scale(0.95);
}

.aipanel-chat.split-mode {
  position: fixed;
  top: 0;
  bottom: 0;
  height: 100vh;
  max-height: 100vh;
  border-radius: 0;
  box-shadow: var(--ap-shadow-lg);
  overflow: visible;
  opacity: 1;
  visibility: visible;
  transition: transform 0.3s ease;
}

.aipanel-chat.split-mode.split-right {
  right: 0;
  border-left: 1px solid var(--ap-border-faint);
  transform: translateX(100%);
}

.aipanel-chat.split-mode.split-left {
  left: 0;
  border-right: 1px solid var(--ap-border-faint);
  transform: translateX(-100%);
}

.aipanel-chat.split-mode .aipanel-chat-content {
  overflow: hidden;
  flex: 1;
}

.aipanel-chat.split-mode.open {
  transform: translateX(0);
}

.aipanel-chat.split-mode.dragging {
  transition: none;
}

.aipanel-chat.dragging .aipanel-iframe {
  pointer-events: none;
}

/* === Extension 模式 === */
.aipanel-chat.extension-mode {
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

.aipanel-chat:not(.split-mode) {
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
}

.aipanel-chat:not(.split-mode).open {
  opacity: 1;
  visibility: visible;
  transform: translate3d(0, 0, 0) scale(1);
}

.aipanel-chat.no-transition,
.aipanel-chat.no-transition.open {
  transition: none !important;
}

.aipanel-chat.minimized:not(.split-mode) {
  width: 320px;
  height: 320px;
}

.aipanel-chat.minimized:not(.split-mode) .aipanel-iframe-container {
  margin-top: -146px;
}

.aipanel-chat-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.aipanel-session-empty {
  padding: 24px;
  text-align: center;
  color: var(--ap-text-placeholder);
  font-size: 14px;
}

.aipanel-split-toggle-btn {
  position: absolute;
  left: -21px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 48px;
  background: var(--ap-bg-main);
  border: 1px solid var(--ap-border-faint);
  border-right: none;
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ap-accent);
  box-shadow: var(--ap-shadow-sm);
  transition: all 0.3s ease;
  z-index: 5;
  transform-origin: right center;
}

.aipanel-split-toggle-btn.split-left {
  left: auto;
  right: -21px;
  border-radius: 0 8px 8px 0;
  border-right: 1px solid var(--ap-border-faint);
  border-left: none;
  transform-origin: left center;
}

.aipanel-split-toggle-btn:hover {
  transform: translateY(-50%) scale(1.1);
  color: var(--ap-accent-hover);
  box-shadow: var(--ap-shadow-md);
}

.aipanel-split-toggle-btn.split-left:hover {
  transform: translateY(-50%) scale(1.1);
}

/* thinking：对齐 DeepSeek —— deepseek 蓝底 + 蓝光晕（官方 ongoing=deepseek-450 系） */
.aipanel-split-toggle-btn.thinking {
  background: var(--ap-accent);
  color: #fff;
  animation: split-thinking-pulse 2s ease-in-out infinite;
  box-shadow:
    0 0 12px var(--ap-thinking-glow-strong),
    0 0 28px var(--ap-thinking-glow);
}

.aipanel-split-toggle-btn.thinking:hover {
  box-shadow:
    0 0 16px var(--ap-thinking-glow-strong),
    0 0 36px var(--ap-thinking-glow);
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

.aipanel-split-toggle-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s ease;
}

.aipanel-split-toggle-btn:hover .aipanel-split-toggle-icon {
  transform: scale(1.1);
}
</style>
