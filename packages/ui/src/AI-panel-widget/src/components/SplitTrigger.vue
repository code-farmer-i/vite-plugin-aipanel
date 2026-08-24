<script setup lang="ts">
import { computed } from "vue";

defineOptions({
  name: "SplitTrigger",
});

const props = withDefaults(
  defineProps<{
    open?: boolean;
    thinking?: boolean;
    resolvedTheme?: "light" | "dark";
    panelWidth?: number;
  }>(),
  {
    open: false,
    thinking: false,
    resolvedTheme: "light",
    panelWidth: 500,
  }
);

const emit = defineEmits<{
  (e: "toggle"): void;
}>();

const buttonClasses = computed(() => [
  "aipanel-split-trigger",
  {
    open: props.open,
    thinking: props.thinking,
    "aipanel-theme-dark": props.resolvedTheme === "dark",
  },
]);

const buttonStyle = computed(() => {
  if (props.open) {
    return {
      right: `${props.panelWidth}px`,
    };
  }
  return {};
});

const handleClick = () => {
  emit("toggle");
};
</script>

<template>
  <button
    :class="buttonClasses"
    :style="buttonStyle"
    type="button"
    :aria-expanded="open"
    aria-label="打开 AI 助手"
    @click="handleClick"
  >
    <span class="aipanel-split-trigger-icon">
      <svg
        v-if="open"
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
        v-else
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
    </span>
    <span
      v-if="thinking"
      class="aipanel-split-thinking-indicator"
    />
  </button>
</template>

<style>
.aipanel-split-trigger {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 48px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: -2px 0 8px rgba(59, 130, 246, 0.25);
  transition: right 0.3s ease, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, box-shadow 0.25s ease;
  z-index: 99998;
}

.aipanel-split-trigger:hover {
  width: 24px;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  box-shadow: -3px 0 12px rgba(59, 130, 246, 0.35);
}

.aipanel-split-trigger.open {
  width: 20px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border-radius: 8px 0 0 8px;
  box-shadow: -2px 0 8px rgba(59, 130, 246, 0.25);
}

.aipanel-split-trigger.open:hover {
  width: 24px;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  box-shadow: -3px 0 12px rgba(59, 130, 246, 0.35);
}

.aipanel-split-trigger-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s ease;
}

.aipanel-split-trigger:hover .aipanel-split-trigger-icon {
  transform: scale(1.1);
}

.aipanel-split-thinking-indicator {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 5px;
  height: 5px;
  background: var(--ap-success);
  border-radius: 50%;
  animation: aipanel-thinking-pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 4px rgba(16, 185, 129, 0.5);
}

@keyframes aipanel-thinking-pulse {

  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }

  50% {
    opacity: 0.6;
    transform: scale(1.3);
  }
}
</style>