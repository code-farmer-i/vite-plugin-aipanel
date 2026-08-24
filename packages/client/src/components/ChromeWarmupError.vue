<script setup lang="ts">
import { ChromeMcpWarmupErrorType } from "@aipanel/core";

defineProps<{
  retrying: boolean;
  errorType?: string;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  retry: [];
}>();

const handleRetry = () => {
  emit("retry");
};
</script>

<template>
  <div class="aipanel-chrome-warmup-failed">
    <div class="aipanel-chrome-warmup-failed-icon">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        width="48"
        height="48"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
    </div>

    <template v-if="errorType === ChromeMcpWarmupErrorType.CHROME_NOT_CONNECTED">
      <div class="aipanel-chrome-warmup-failed-title">Chrome DevTools MCP 连接失败</div>
      <div class="aipanel-chrome-warmup-failed-text">
        <p>请按以下步骤开启 Chrome 远程调试：</p>
        <div class="aipanel-chrome-warmup-steps">
          <div>
            在 Chrome 地址栏输入
            <code class="aipanel-chrome-warmup-code">chrome://inspect/#remote-debugging</code>
          </div>
          <div>勾选 'Allow remote debugging for this browser instance' 选项</div>
          <div>重新启动浏览器</div>
          <div>完成后点击下方按钮重试</div>
        </div>
        <p
          v-if="errorMessage"
          class="aipanel-chrome-warmup-error-detail"
        >{{ errorMessage }}</p>
      </div>
    </template>

    <template v-else>
      <div class="aipanel-chrome-warmup-failed-title">Chrome DevTools MCP 连接失败</div>
      <div class="aipanel-chrome-warmup-failed-text">
        <p
          v-if="errorMessage"
          class="aipanel-chrome-warmup-error-detail"
        >{{ errorMessage }}</p>
        <p v-else>连接失败，请重试</p>
      </div>
    </template>

    <div class="aipanel-chrome-warmup-failed-actions">
      <button
        class="aipanel-chrome-warmup-failed-btn primary"
        :disabled="retrying"
        @click="handleRetry"
      >
        {{ retrying ? '连接中...' : '重试连接' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.aipanel-chrome-warmup-error-detail {
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--ap-bg-tertiary);
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  color: var(--ap-text-secondary);
  word-break: break-word;
}

.aipanel-chrome-warmup-failed-actions {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.aipanel-chrome-warmup-failed-btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.aipanel-chrome-warmup-failed-btn.primary {
  background: var(--ap-primary);
  color: white;
}

.aipanel-chrome-warmup-failed-btn.primary:hover:not(:disabled) {
  background: var(--ap-primary-hover);
}

.aipanel-chrome-warmup-failed-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
