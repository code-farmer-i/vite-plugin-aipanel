<script setup lang="ts">
import { ref } from "vue";
import { useOpenCodeWidgetContext } from "../context";

const iframeRef = ref<HTMLIFrameElement | null>(null);

const {
  frameLoading,
  showEmptyState,
  showError,
  iframeSource: iframeSrc,
  emptyStateText,
  emptyStateActionText,
  handleEmptyAction,
  handleFrameLoaded,
} = useOpenCodeWidgetContext();

function sendMessageToIframe(type: string, data?: Record<string, unknown>) {
  if (!iframeRef.value?.contentWindow) return;
  iframeRef.value.contentWindow.postMessage({ type, ...data }, "*");
}

defineExpose({
  sendMessageToIframe,
});
</script>

<template>
  <div class="opencode-iframe-container">
    <div
      class="opencode-empty-state-overlay"
      :class="{ visible: showEmptyState }"
    >
      <slot name="empty-state">
        <div class="opencode-empty-state-icon">
          <svg
            viewBox="0 0 24 24"
            width="48"
            height="48"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <div class="opencode-empty-state-text">{{ emptyStateText }}</div>
        <button
          class="opencode-empty-state-btn"
          type="button"
          @click="handleEmptyAction"
        >
          {{ emptyStateActionText }}
        </button>
      </slot>
    </div>

    <div
      class="opencode-loading-overlay"
      :class="{ visible: frameLoading }"
    >
      <slot name="loading">
        <div class="opencode-loading-spinner" />
        <div class="opencode-loading-text">加载中...</div>
      </slot>
    </div>

    <div
      class="opencode-error-overlay"
      :class="{ visible: showError }"
    >
      <slot name="error" />
    </div>

    <slot name="content">
      <iframe
        ref="iframeRef"
        class="opencode-iframe"
        :src="iframeSrc"
        allow="clipboard-write; clipboard-read"
        referrerpolicy="origin"
        @load="handleFrameLoaded"
      />
    </slot>
  </div>
</template>

<style>
.opencode-iframe-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.opencode-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--oc-overlay-bg);
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: opacity 0.3s ease;
}

.opencode-loading-overlay.visible {
  display: flex;
}

.opencode-loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--oc-border-primary);
  border-top-color: var(--oc-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.opencode-loading-text {
  margin-top: 12px;
  font-size: 14px;
  color: var(--oc-text-placeholder);
}

.opencode-error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 15;
  display: none;
}

.opencode-error-overlay.visible {
  display: flex;
}

.opencode-empty-state-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--oc-bg-secondary);
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 5;
  transition: opacity 0.3s ease;
}

.opencode-empty-state-overlay.visible {
  display: flex;
}

.opencode-empty-state-icon {
  color: var(--oc-text-placeholder);
  margin-bottom: 16px;
}

.opencode-empty-state-text {
  color: var(--oc-text-primary);
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 24px;
}

.opencode-empty-state-btn {
  padding: 10px 24px;
  border-radius: 8px;
  border: none;
  background: var(--oc-primary);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: var(--oc-shadow-primary);
}

.opencode-empty-state-btn:hover {
  background: var(--oc-primary-hover);
  transform: translateY(-1px);
  box-shadow: var(--oc-shadow-primary-hover);
}

.opencode-empty-state-btn:active {
  transform: translateY(0);
}

.opencode-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
