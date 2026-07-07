<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ChromeMcpWarmupErrorType, type ModelInfo } from "@vite-plugin-opencode-assistant/shared";

const props = defineProps<{
  retrying: boolean;
  errorType?: string;
  errorMessage?: string;
  models?: ModelInfo[];
}>();

const emit = defineEmits<{
  retry: [selectedModel?: { providerID: string; modelID: string; }];
}>();

const selectedModelValue = ref<string>("");

watch(
  () => props.models,
  (models) => {
    if (models && models.length > 0 && !selectedModelValue.value) {
      selectedModelValue.value = `${models[0].providerID}:${models[0].modelID}`;
    }
  },
  { immediate: true }
);

const shouldShowModelSelector = computed(() => {
  return (
    props.errorType === ChromeMcpWarmupErrorType.AI_TIMEOUT ||
    props.errorType === ChromeMcpWarmupErrorType.AI_RESPONSE_ERROR ||
    props.errorType === ChromeMcpWarmupErrorType.UNKNOWN
  );
});

const hasModels = computed(() => props.models && props.models.length > 0);

const groupedModels = computed(() => {
  if (!props.models) return {};
  const groups: Record<string, ModelInfo[]> = {};
  for (const model of props.models) {
    if (!groups[model.providerID]) {
      groups[model.providerID] = [];
    }
    groups[model.providerID].push(model);
  }
  return groups;
});

const selectedModel = computed(() => {
  if (!selectedModelValue.value || !props.models) return props.models?.[0] || null;
  const [providerID, modelID] = selectedModelValue.value.split(":");
  return props.models.find((m) => m.providerID === providerID && m.modelID === modelID) || null;
});

const getProviderDisplayName = (providerID: string) => {
  const knownProviders: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    xai: "xAI",
    opencode: "OpenCode",
    opencode_go: "OpenCode Go",
  };
  return knownProviders[providerID] || providerID;
};

const getModelKey = (model: ModelInfo) => `${model.providerID}:${model.modelID}`;

const handleRetry = () => {
  if (shouldShowModelSelector.value && hasModels.value && selectedModel.value) {
    emit("retry", {
      providerID: selectedModel.value.providerID,
      modelID: selectedModel.value.modelID,
    });
  } else {
    emit("retry");
  }
};
</script>

<template>
  <div class="opencode-chrome-warmup-failed">
    <div class="opencode-chrome-warmup-failed-icon">
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
      <div class="opencode-chrome-warmup-failed-title">Chrome DevTools MCP 连接失败</div>
      <div class="opencode-chrome-warmup-failed-text">
        <p>请按以下步骤开启 Chrome 远程调试：</p>
        <div class="opencode-chrome-warmup-steps">
          <div>
            在 Chrome 地址栏输入
            <code class="opencode-chrome-warmup-code">chrome://inspect/#remote-debugging</code>
          </div>
          <div>勾选 'Allow remote debugging for this browser instance' 选项</div>
          <div>重新启动浏览器</div>
          <div>完成后点击下方按钮重试</div>
        </div>
      </div>
    </template>

    <template v-else-if="errorType === ChromeMcpWarmupErrorType.AI_TIMEOUT">
      <div class="opencode-chrome-warmup-failed-title">AI 响应超时</div>
      <div class="opencode-chrome-warmup-failed-text">
        <p>AI 模型响应超时，可能的原因：</p>
        <div class="opencode-chrome-warmup-steps">
          <div>当前选择的 AI 模型服务不可用或响应缓慢</div>
          <div>网络连接问题</div>
          <div>模型配置不正确</div>
        </div>
        <p
          v-if="hasModels"
          style="margin-top: 12px; font-weight: 500;"
        >可选择其他模型重试：</p>
      </div>
    </template>

    <template v-else-if="errorType === ChromeMcpWarmupErrorType.AI_RESPONSE_ERROR">
      <div class="opencode-chrome-warmup-failed-title">AI 响应错误</div>
      <div class="opencode-chrome-warmup-failed-text">
        <p>AI 模型返回了意外的响应：</p>
        <div class="opencode-chrome-warmup-error-details">
          {{ errorMessage || '未知错误' }}
        </div>
        <p
          v-if="hasModels"
          style="margin-top: 12px;"
        >可选择其他模型重试：</p>
      </div>
    </template>

    <template v-else>
      <div class="opencode-chrome-warmup-failed-title">Chrome DevTools MCP 连接失败</div>
      <div class="opencode-chrome-warmup-failed-text">
        <p v-if="errorMessage">{{ errorMessage }}</p>
        <p v-else>连接失败，请重试</p>
        <p
          v-if="hasModels"
          style="margin-top: 12px;"
        >可选择模型重试：</p>
      </div>
    </template>

    <div
      v-if="shouldShowModelSelector && hasModels"
      class="opencode-model-selector"
    >
      <div class="select-wrapper">
        <select
          v-model="selectedModelValue"
          class="native-select"
          :disabled="retrying"
        >
          <optgroup
            v-for="(providerModels, provider) in groupedModels"
            :key="provider"
            :label="getProviderDisplayName(provider)"
          >
            <option
              v-for="model in providerModels"
              :key="getModelKey(model)"
              :value="getModelKey(model)"
            >
              {{ model.name || model.modelID }}
            </option>
          </optgroup>
        </select>
        <span class="select-arrow">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M6 9l6 6 6-6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </div>

      <button
        class="retry-btn"
        :disabled="retrying"
        @click="handleRetry"
      >
        {{ retrying ? '连接中...' : '重试连接' }}
      </button>
    </div>

    <div
      v-else
      class="opencode-chrome-warmup-failed-actions"
    >
      <button
        class="opencode-chrome-warmup-failed-btn primary"
        :disabled="retrying"
        @click="handleRetry()"
      >
        {{ retrying ? '连接中...' : '重试连接' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.opencode-chrome-warmup-error-details {
  margin-top: 8px;
  padding: 12px;
  background: var(--oc-bg-tertiary);
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  color: var(--oc-text-secondary);
  max-height: 120px;
  overflow-y: auto;
  word-break: break-word;
}

.opencode-model-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
}

.select-wrapper {
  position: relative;
  width: 100%;
}

.native-select {
  width: 100%;
  padding: 10px 36px 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--oc-border-primary);
  background: var(--oc-bg-primary);
  color: var(--oc-text-primary);
  font-size: 14px;
  cursor: pointer;
  outline: none;
  appearance: none;
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.native-select:hover:not(:disabled) {
  border-color: var(--oc-border-hover);
  background: var(--oc-bg-secondary);
}

.native-select:focus {
  border-color: var(--oc-primary);
  box-shadow: 0 0 0 2px rgba(var(--oc-primary-rgb, 59, 130, 246), 0.2);
}

.native-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.native-select option {
  background: var(--oc-bg-primary);
  color: var(--oc-text-primary);
  padding: 8px;
}

.native-select optgroup {
  color: var(--oc-text-secondary);
  font-weight: 600;
  font-size: 12px;
}

.select-arrow {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--oc-text-secondary);
  display: flex;
  align-items: center;
}

.native-select:disabled+.select-arrow {
  opacity: 0.6;
}

.retry-btn {
  width: 100%;
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  background: var(--oc-primary);
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.retry-btn:hover:not(:disabled) {
  background: var(--oc-primary-hover);
}

.retry-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.opencode-chrome-warmup-failed-actions {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.opencode-chrome-warmup-failed-btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.opencode-chrome-warmup-failed-btn.primary {
  background: var(--oc-primary);
  color: white;
}

.opencode-chrome-warmup-failed-btn.primary:hover:not(:disabled) {
  background: var(--oc-primary-hover);
}

.opencode-chrome-warmup-failed-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>