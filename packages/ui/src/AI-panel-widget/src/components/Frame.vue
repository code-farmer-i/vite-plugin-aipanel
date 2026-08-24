<script setup lang="ts">
import { ref } from "vue";
import { useAIPanelWidgetContext } from "../context";

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
} = useAIPanelWidgetContext();

function sendMessageToIframe(type: string, data?: Record<string, unknown>) {
  if (!iframeRef.value?.contentWindow) return;
  iframeRef.value.contentWindow.postMessage({ type, ...data }, "*");
}

defineExpose({
  sendMessageToIframe,
});
</script>

<template>
  <div class="aipanel-iframe-container">
    <div
      class="aipanel-empty-state-overlay"
      :class="{ visible: showEmptyState }"
    >
      <slot name="empty-state">
        <div class="aipanel-empty-state-icon">
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
        <div class="aipanel-empty-state-text">{{ emptyStateText }}</div>
        <button
          class="aipanel-empty-state-btn"
          type="button"
          @click="handleEmptyAction"
        >
          {{ emptyStateActionText }}
        </button>
      </slot>
    </div>

    <div
      class="aipanel-loading-overlay"
      :class="{ visible: frameLoading }"
    >
      <slot name="loading">
        <div class="aipanel-loading-spinner" />
        <div class="aipanel-loading-text">加载中...</div>
      </slot>
    </div>

    <div
      class="aipanel-error-overlay"
      :class="{ visible: showError }"
    >
      <slot name="error" />
    </div>

    <slot name="content">
      <iframe
        ref="iframeRef"
        class="aipanel-iframe"
        :class="{ loaded: !frameLoading }"
        :src="iframeSrc"
        allow="clipboard-write; clipboard-read"
        referrerpolicy="origin"
        @load="handleFrameLoaded"
      />
    </slot>
  </div>
</template>

<style>
.aipanel-iframe-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.aipanel-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--ap-overlay-bg);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  display: flex;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

.aipanel-loading-overlay.visible {
  opacity: 1;
  visibility: visible;
}

.aipanel-loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--ap-border-primary);
  border-top-color: var(--ap-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.aipanel-loading-text {
  margin-top: 12px;
  font-size: 14px;
  color: var(--ap-text-placeholder);
}

.aipanel-error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 15;
  display: flex;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

.aipanel-error-overlay.visible {
  opacity: 1;
  visibility: visible;
}

.aipanel-empty-state-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--ap-bg-secondary);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 5;
  display: flex;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

.aipanel-empty-state-overlay.visible {
  opacity: 1;
  visibility: visible;
}

.aipanel-empty-state-icon {
  color: var(--ap-text-placeholder);
  margin-bottom: 16px;
}

.aipanel-empty-state-text {
  color: var(--ap-text-primary);
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 24px;
}

.aipanel-empty-state-btn {
  padding: 10px 24px;
  border-radius: 8px;
  border: none;
  background: var(--ap-primary);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: var(--ap-shadow-primary);
}

.aipanel-empty-state-btn:hover {
  background: var(--ap-primary-hover);
  transform: translateY(-1px);
  box-shadow: var(--ap-shadow-primary-hover);
}

.aipanel-empty-state-btn:active {
  transform: translateY(0);
}

.aipanel-iframe {
  width: 100%;
  height: 100%;
  border: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.aipanel-iframe.loaded {
  opacity: 1;
}
</style>
