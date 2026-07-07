<script setup lang="ts">
import { ref } from "vue";

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
  <div class="opencode-no-service">
    <div class="opencode-no-service-icon">
      <svg
        viewBox="0 0 1024 1024"
        xmlns="http://www.w3.org/2000/svg"
        width="64"
        height="64"
      >
        <defs>
          <linearGradient
            id="ns-g"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop
              offset="0%"
              style="stop-color: #667eea"
            />
            <stop
              offset="100%"
              style="stop-color: #764ba2"
            />
          </linearGradient>
        </defs>
        <path
          d="M512 981.33H85.34c-15.85 0-30.38-8.77-37.77-22.81a42.624 42.624 0 0 1 2.6-44.02L135 791.08C75.25 710.5 42.67 612.6 42.67 512 42.67 253.21 253.21 42.67 512 42.67S981.34 253.21 981.34 512 770.8 981.33 512 981.33zM166.44 896H512c211.73 0 384-172.27 384-384S723.73 128 512 128 128 300.27 128 512c0 91.29 32.83 179.9 92.46 249.46 12.58 14.69 13.73 36 2.77 51.94L166.44 896z"
          fill="url(#ns-g)"
        />
        <path
          d="M384 448m-64 0a64 64 0 1 0 128 0 64 64 0 1 0 -128 0Z"
          fill="url(#ns-g)"
        />
        <path
          d="M640 448m-64 0a64 64 0 1 0 128 0 64 64 0 1 0 -128 0Z"
          fill="url(#ns-g)"
        />
      </svg>
    </div>
    <h2 class="opencode-no-service-title">OpenCode Assistant</h2>
    <p class="opencode-no-service-desc">当前页面未检测到 OpenCode 助手服务</p>
    <div class="opencode-no-service-card">
      <p>请打开使用 <code>vite-plugin-opencode-assistant</code> 的 localhost 页面</p>
      <p class="opencode-no-service-hint">例如：<code>http://localhost:5173</code></p>
    </div>
    <button
      class="opencode-no-service-refresh"
      :class="{ 'opencode-no-service-refresh--loading': checking }"
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
        :class="{ 'opencode-spin': checking }"
      >
        <polyline points="23,4 23,10 17,10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      {{ checking ? '检测中...' : '重新检测' }}
    </button>
    <p
      v-if="resultMsg"
      class="opencode-no-service-result"
    >{{ resultMsg }}</p>
  </div>
</template>

<style scoped>
.opencode-no-service {
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
  .opencode-no-service {
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

.opencode-no-service-icon {
  margin-bottom: 24px;
  opacity: 0.6;
  animation: opencode-ns-float 3s ease-in-out infinite;
}

@keyframes opencode-ns-float {

  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-6px);
  }
}

.opencode-no-service-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--ns-title);
  margin: 0 0 8px;
  letter-spacing: -0.01em;
}

.opencode-no-service-desc {
  font-size: 14px;
  color: var(--ns-sub);
  margin: 0 0 28px;
  line-height: 1.5;
}

.opencode-no-service-card {
  background: var(--ns-card-bg);
  border: 1px solid var(--ns-border);
  border-radius: 10px;
  padding: 18px 28px;
  box-shadow: var(--ns-card-shadow);
  max-width: 360px;
}

.opencode-no-service-card p {
  font-size: 13px;
  color: var(--ns-text);
  margin: 0 0 8px;
  line-height: 1.6;
}

.opencode-no-service-card p:last-child {
  margin-bottom: 0;
}

.opencode-no-service-card code {
  background: var(--ns-code-bg);
  color: var(--ns-code);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.opencode-no-service-hint {
  font-size: 13px;
  color: var(--ns-hint);
  margin: 0;
}

.opencode-no-service-refresh {
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

.opencode-no-service-refresh:hover {
  border-color: #667eea;
  color: #667eea;
  box-shadow: 0 1px 4px rgba(102, 126, 234, 0.15);
}

.opencode-no-service-refresh svg {
  flex-shrink: 0;
}

.opencode-no-service-refresh--loading {
  opacity: 0.7;
  cursor: not-allowed;
}

.opencode-no-service-result {
  margin-top: 12px;
  font-size: 12px;
  color: #f59e0b;
  animation: opencode-fade-in 0.3s ease;
}

@keyframes opencode-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.opencode-spin {
  animation: opencode-spin 0.8s linear infinite;
}

@keyframes opencode-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
