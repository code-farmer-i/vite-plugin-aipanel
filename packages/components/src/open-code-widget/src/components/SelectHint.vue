<script setup lang="ts">
import { useOpenCodeWidgetContext } from "../context";

const { selectMode: visible, selectShortcutLabel: shortcutLabel } = useOpenCodeWidgetContext();
</script>

<template>
  <div
    class="opencode-select-mode-hint"
    :class="{ visible }"
  >
    <span class="opencode-hint-main">
      <span
        class="opencode-hint-icon"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle
            cx="12"
            cy="12"
            r="8"
          />
          <circle
            cx="12"
            cy="12"
            r="2.5"
            fill="currentColor"
          />
          <line
            x1="12"
            y1="2"
            x2="12"
            y2="5"
          />
          <line
            x1="12"
            y1="19"
            x2="12"
            y2="22"
          />
          <line
            x1="2"
            y1="12"
            x2="5"
            y2="12"
          />
          <line
            x1="19"
            y1="12"
            x2="22"
            y2="12"
          />
        </svg>
      </span>
      <span class="opencode-hint-text">选择模式已开启 · 点击元素进行选择</span>
    </span>
    <span class="opencode-hint-shortcut">{{ shortcutLabel }}</span>
  </div>
</template>

<style>
.opencode-select-mode-hint {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%) translateY(-16px);
  max-width: calc(100% - 24px);
  width: max-content;
  padding: 8px 14px;
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
  border-radius: 18px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  box-shadow:
    0 6px 20px rgba(239, 68, 68, 0.5),
    0 0 0 3px rgba(239, 68, 68, 0.3);
  z-index: 9999999;
  display: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  column-gap: 10px;
  row-gap: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-sizing: border-box;
}

.opencode-select-mode-hint.visible {
  display: inline-flex;
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  animation:
    hintSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    pulseHint 2s ease-in-out 0.3s infinite;
}

.opencode-hint-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.opencode-hint-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  flex-shrink: 0;
}

.opencode-hint-icon svg {
  display: block;
}

.opencode-hint-text {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.2px;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.opencode-hint-shortcut {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

@keyframes hintSlideIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-16px);
  }

  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@keyframes pulseHint {

  0%,
  100% {
    box-shadow:
      0 6px 20px rgba(239, 68, 68, 0.5),
      0 0 0 3px rgba(239, 68, 68, 0.3);
  }

  50% {
    box-shadow:
      0 6px 20px rgba(239, 68, 68, 0.6),
      0 0 0 6px rgba(239, 68, 68, 0.4);
  }
}
</style>
