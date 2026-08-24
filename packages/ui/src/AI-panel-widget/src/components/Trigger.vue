<script setup lang="ts">
import { ref, watch } from "vue";
import { useAIPanelWidgetContext } from "../context";
import FloatingBubble from "./FloatingBubble/FloatingBubble.vue";
import type { FloatingBubbleOffset } from "./FloatingBubble/types";
import AIPanelLogo from "./AIPanelLogo.vue";

const {
  buttonActive: active,
  open,
  hotkeyLabel,
  thinking,
  resolvedTheme,
  handleToggle,
  bubbleOffset,
  handleBubbleOffsetChange,
} = useAIPanelWidgetContext();

const offset = ref<FloatingBubbleOffset | undefined>(bubbleOffset.value);

const emit = defineEmits<{
  (e: "drag-start"): void;
  (e: "drag-end"): void;
}>();

const handleOffsetChange = (value: FloatingBubbleOffset | undefined) => {
  offset.value = value;
  handleBubbleOffsetChange(value);
};

watch(bubbleOffset, (newOffset) => {
  offset.value = newOffset;
});

defineExpose({
  offset,
});
</script>

<template>
  <FloatingBubble
    ref="bubbleRef"
    v-model:offset="offset"
    axis="xy"
    magnetic="x"
    :gap="24"
    @click="handleToggle"
    @offset-change="handleOffsetChange"
    @drag-start="emit('drag-start')"
    @drag-end="emit('drag-end')"
  >
    <button
      class="aipanel-button"
      :class="{ active, thinking, 'aipanel-theme-dark': resolvedTheme === 'dark' }"
      type="button"
      :aria-expanded="open"
      aria-label="打开 AI 助手"
      :title="`AI 助手 (${hotkeyLabel})`"
    >
      <slot>
        <AIPanelLogo :size="42" />
      </slot>
    </button>
  </FloatingBubble>
</template>

<style>
.aipanel-button {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #fff;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  position: relative;
}

.aipanel-button svg {
  transform: rotate(180deg) scale(1.1);
  transition: transform 0.3s ease;
  width: 100%;
  height: 100%;
  display: block;
}

.aipanel-button:hover svg {
  transform: rotate(180deg) scale(1.1);
}

.aipanel-button:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
}

.aipanel-button.thinking {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  animation: thinking-glow 2s ease-in-out infinite, thinking-pulse 2s ease-in-out infinite;
  box-shadow:
    0 0 20px rgba(102, 126, 234, 0.6),
    0 0 40px rgba(118, 75, 162, 0.4),
    0 0 60px rgba(102, 126, 234, 0.2);
}

.aipanel-button.thinking svg path {
  fill: #fff;
}

.aipanel-button.thinking::before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b9cf5 0%, #9d6bc7 100%);
  z-index: -1;
}

.aipanel-button.thinking::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  background: conic-gradient(from 180deg,
      transparent,
      rgba(102, 126, 234, 0.3),
      transparent,
      rgba(118, 75, 162, 0.3),
      transparent);
  z-index: -2;
  animation: thinking-rotate 2s linear infinite reverse;
  filter: blur(8px);
}

@keyframes thinking-glow {

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

@keyframes thinking-rotate {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes thinking-pulse {

  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(0.92);
  }
}

.aipanel-button.aipanel-theme-dark {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.aipanel-button.aipanel-theme-dark::before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b9cf5 0%, #9d6bc7 100%);
  z-index: -1;
}

.aipanel-button.aipanel-theme-dark:hover {
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
}

.aipanel-button.aipanel-theme-dark svg path {
  fill: #fff;
}
</style>
