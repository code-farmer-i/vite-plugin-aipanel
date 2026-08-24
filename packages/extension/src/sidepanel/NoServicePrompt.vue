<script setup lang="ts">
import { ref } from "vue";
import { AIPanelLogo } from "@aipanel/ui";

const props = defineProps<{
  onRefresh: () => Promise<boolean>;
}>();

const checking = ref(false);
const resultMsg = ref("");

async function handleRefresh() {
  if (checking.value) return;
  checking.value = true;
  resultMsg.value = "";

  try {
    // 保证最小 loading 时长，让用户能感知
    const minDelay = new Promise((r) => setTimeout(r, 600));
    const [found] = await Promise.all([props.onRefresh(), minDelay]);
    if (!found) {
      resultMsg.value = "仍未检测到服务，请确认 localhost 页面已打开";
    }
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="aipanel-no-service">
    <div class="aipanel-no-service-icon">
      <AIPanelLogo :size="64" />
    </div>
    <h2 class="aipanel-no-service-title">AIPanel Assistant</h2>
    <p class="aipanel-no-service-desc">当前页面未检测到 AIPanel 助手服务</p>
    <div class="aipanel-no-service-card">
      <p>请打开使用 <code>vite-plugin-aipanel</code> 的 localhost 页面</p>
      <p class="aipanel-no-service-hint">例如：<code>http://localhost:5173</code></p>
    </div>
    <button
      class="aipanel-no-service-refresh"
      :class="{ 'aipanel-no-service-refresh--loading': checking }"
      :disabled="checking"
      @click="handleRefresh"
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        :class="{ 'aipanel-spin': checking }"
      >
        <polyline points="23,4 23,10 17,10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      {{ checking ? '检测中...' : '重新检测' }}
    </button>
    <p
      v-if="resultMsg"
      class="aipanel-no-service-result"
    >{{ resultMsg }}</p>
  </div>
</template>

<style scoped>
.aipanel-no-service {
  --ns-bg: #f8f9fa;
  --ns-card-bg: #fff;
  --ns-card-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.06);
  --ns-title: #1a1a1a;
  --ns-text: #4b5563;
  --ns-sub: #6b7280;
  --ns-hint: #9ca3af;
  --ns-code-bg: #e5e7eb;
  --ns-code: #3b82f6;
  --ns-border: #e5e7eb;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 32px 24px;
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--ns-bg);
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  .aipanel-no-service {
    --ns-bg: #1a1a1a;
    --ns-card-bg: #252525;
    --ns-card-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    --ns-title: #f3f4f6;
    --ns-text: #d1d5db;
    --ns-sub: #9ca3af;
    --ns-hint: #6b7280;
    --ns-code-bg: #333;
    --ns-code: #60a5fa;
    --ns-border: #333;
  }
}

.aipanel-no-service-icon {
  margin-bottom: 24px;
  opacity: 0.6;
  animation: aipanel-ns-float 3s ease-in-out infinite;
}

@keyframes aipanel-ns-float {

  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-6px);
  }
}

.aipanel-no-service-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--ns-title);
  margin: 0 0 8px;
  letter-spacing: -0.01em;
}

.aipanel-no-service-desc {
  font-size: 14px;
  color: var(--ns-sub);
  margin: 0 0 28px;
  line-height: 1.5;
}

.aipanel-no-service-card {
  background: var(--ns-card-bg);
  border: 1px solid var(--ns-border);
  border-radius: 10px;
  padding: 18px 28px;
  box-shadow: var(--ns-card-shadow);
  max-width: 360px;
}

.aipanel-no-service-card p {
  font-size: 13px;
  color: var(--ns-text);
  margin: 0 0 8px;
  line-height: 1.6;
}

.aipanel-no-service-card p:last-child {
  margin-bottom: 0;
}

.aipanel-no-service-card code {
  background: var(--ns-code-bg);
  color: var(--ns-code);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.aipanel-no-service-hint {
  font-size: 13px;
  color: var(--ns-hint);
  margin: 0;
}

.aipanel-no-service-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 24px;
  padding: 8px 20px;
  border: 1px solid var(--ns-border);
  border-radius: 8px;
  background: var(--ns-card-bg);
  color: var(--ns-text);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.aipanel-no-service-refresh:hover {
  border-color: #667eea;
  color: #667eea;
  box-shadow: 0 1px 4px rgba(102, 126, 234, 0.15);
}

.aipanel-no-service-refresh svg {
  flex-shrink: 0;
}

.aipanel-no-service-refresh--loading {
  opacity: 0.7;
  cursor: not-allowed;
}

.aipanel-no-service-result {
  margin-top: 12px;
  font-size: 12px;
  color: #f59e0b;
  animation: aipanel-fade-in 0.3s ease;
}

@keyframes aipanel-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.aipanel-spin {
  animation: aipanel-spin 0.8s linear infinite;
}

@keyframes aipanel-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
