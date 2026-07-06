<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { OpenCodeWidget } from "@vite-plugin-opencode-assistant/components";
import type {
  OpenCodeWidgetTheme,
  OpenCodeSelectedElement,
  ModelInfo,
} from "@vite-plugin-opencode-assistant/shared";
import type { WidgetOptions } from "@vite-plugin-opencode-assistant/shared";

import { useHotkey } from "./composables/useHotkey";
import { useServerSSE } from "./composables/useServerSSE";
import { useOpencodeSessionSSE } from "./composables/useOpencodeSessionSSE";
import { useSessions } from "./composables/useSessions";
import { useTheme } from "./composables/useTheme";
import { useSelectedElements } from "./composables/useSelectedElements";
import { useServiceStatus } from "./composables/useServiceStatus";
import { useContext } from "./composables/useContext";
import LoadingContent from "./components/LoadingContent.vue";
import ChromeWarmupError from "./components/ChromeWarmupError.vue";

const props = defineProps<{
  config: Partial<WidgetOptions>;
}>();

const open = ref(false);
const selectMode = ref(false);
const sessionListCollapsed = ref(true);
const loading = ref(false);
const widgetRef = ref<InstanceType<typeof OpenCodeWidget> | null>(null);
const retryingWarmup = ref(false);
const availableModels = ref<ModelInfo[]>([]);

const {
  theme: initialTheme = "auto",
  open: autoOpen = false,
  hotkey = "ctrl+k",
  proxyPort = 4098,
  proxyHost = "localhost",
  displayMode = "bubble",
  splitMode,
} = props.config;

const widgetTheme = initialTheme as OpenCodeWidgetTheme;
const splitPanelWidth = ref(splitMode?.width ?? 500);

// 构建 proxy base URL
const proxyBaseUrl = computed(() => {
  return `http://${proxyHost}:${proxyPort}`;
});

const showNotification = (
  msg: string,
  options?: { duration?: number; mode?: "widget" | "page"; },
) => {
  widgetRef.value?.showNotification?.(msg, options);
};

const {
  serviceStatus,
  chromeMcpFailed,
  chromeMcpErrorType,
  chromeMcpErrorMessage,
  loadingText,
  updateStatusFromTask,
  setStarting,
} = useServiceStatus();

const { selectedElements, removeElement, clearElements } = useSelectedElements();

const { theme, sendThemeToIframe } = useTheme(widgetTheme, widgetRef);

const {
  sessions,
  loadingSessionList,
  currentSessionId,
  iframeSrc,
  iframeLoading,
  loadSessions,
  createSession,
  deleteSession,
  selectSession,
  updateSessionInfo,
} = useSessions({ showNotification });

const { updateContext } = useContext(serviceStatus, selectedElements);

// Server SSE: 监听 Vite server 事件 (服务启动状态)
const serverSSE = useServerSSE({
  onStatusSync: (data) => {
    if (data.isStarted !== undefined && data.isStarted && serviceStatus.value === "idle") {
      setStarting();
    }
    if (data.task) {
      updateStatusFromTask(data.task, data.errorType, data.errorMessage);
    }
  },
  onTaskUpdate: (data) => {
    updateStatusFromTask(data.task, data.errorType, data.errorMessage);
  },
  onClearElements: () => clearElements(),
  onConnected: () => updateContext(true),
});

// OpenCode Session SSE: 监听 OpenCode session thinking 状态和标题更新
const opencodeSSE = useOpencodeSessionSSE({
  proxyBaseUrl: proxyBaseUrl.value,
  currentSessionId,
  onConnected: () => {
    console.log("[OpenCode] Session SSE connected");
  },
  onSessionUpdate: (session) => {
    // 当 OpenCode 自动生成标题后，更新本地 session 列表
    updateSessionInfo(session);
  },
});

// 只要有一个会话处于 thinking 状态就设为 true
const thinking = opencodeSSE.hasAnyThinking;
const sessionStates = opencodeSSE.sessionStates;

const showSessionListSkeleton = computed(() => serviceStatus.value === "starting");
const computedLoading = computed(() => {
  return serviceStatus.value === "starting" || iframeLoading.value;
});

// 区分服务启动 loading 和 iframe 加载的文本
const displayLoadingText = computed(() => {
  if (serviceStatus.value === "starting") {
    return loadingText.value;
  }
  return "加载会话...";
});

const retryWarmup = async (selectedModel?: { providerID: string; modelID: string; }) => {
  retryingWarmup.value = true;

  try {
    const res = await fetch("/__opencode_warmup__", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: selectedModel ? JSON.stringify(selectedModel) : "",
    });
    const data = await res.json();
    if (data.success) {
      chromeMcpFailed.value = false;
      chromeMcpErrorType.value = undefined;
      chromeMcpErrorMessage.value = undefined;
      serviceStatus.value = "ready";
      showNotification("Chrome DevTools MCP 连接成功");
    } else {
      chromeMcpErrorType.value = data.errorType;
      chromeMcpErrorMessage.value = data.error;
      if (data.errorType === "AI_TIMEOUT") {
        showNotification("AI 响应超时，请检查 OpenCode AI 模型配置");
      } else if (data.errorType === "AI_RESPONSE_ERROR") {
        showNotification("AI 响应错误，请检查 OpenCode AI 模型配置");
      } else if (data.errorType === "CHROME_NOT_CONNECTED") {
        showNotification("Chrome 远程调试未开启，请按照提示操作");
      } else {
        showNotification(data.error || "重试失败，请确认 Chrome 远程调试已开启");
      }
    }
  } catch (e) {
    console.error("[OpenCode] Retry warmup failed:", e);
    showNotification("重试失败，请稍后再试");
  } finally {
    retryingWarmup.value = false;
  }
};

const fetchAvailableModels = async () => {
  try {
    const res = await fetch("/__opencode_warmup__", { method: "GET" });
    const data = await res.json();
    if (data.success && data.models) {
      availableModels.value = data.models;
    }
  } catch (e) {
    console.error("[OpenCode] Failed to fetch available models:", e);
    availableModels.value = [];
  }
};

const ensureServicesStarted = async () => {
  if (serviceStatus.value !== "idle") return true;
  try {
    const res = await fetch("/__opencode_start__");
    const data = await res.json();
    if (data.success) {
      setStarting();
      serverSSE.connect();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
};

useHotkey(hotkey, (e) => {
  e.preventDefault();
  handleToggle(!open.value);
});

const toggleSelectMode = () => {
  const win = window as typeof window & { __VUE_INSPECTOR__?: unknown; };
  if (win.__VUE_INSPECTOR__) {
    handleSelectModeChange(!selectMode.value);
  } else {
    showNotification("Vue Inspector 未加载，无法使用元素选择功能");
  }
};

useHotkey("ctrl+p", (e) => {
  e.preventDefault();
  toggleSelectMode();
});

// 监听服务状态变化，启动相应的 SSE 连接
watch(serviceStatus, (status, oldStatus) => {
  if (status !== "idle" && oldStatus === "idle") {
    serverSSE.connect();
    opencodeSSE.connect();
  }
  if (status === "ready" && oldStatus !== "ready") {
    loadSessions();
  }
});

// 当 Chrome MCP 预热失败时，获取可用模型列表
watch(chromeMcpFailed, (failed) => {
  if (failed) {
    fetchAvailableModels();
  }
});

onMounted(() => {
  if (serviceStatus.value === "ready") {
    loadSessions();
    serverSSE.connect();
    opencodeSSE.connect();
    updateContext(true);
  } else if (serviceStatus.value === "idle") {
    // sidepanel / tab 切换重连场景：主动加载会话并连接 SSE
    loadSessions();
    serverSSE.connect();
  }
  if (autoOpen && serviceStatus.value === "ready") {
    setTimeout(() => {
      open.value = true;
    }, 1000);
  }

  // 监听 iframe 消息（主题同步和键盘事件）
  const handleIframeMessage = (event: MessageEvent) => {
    if (event.data?.type === "OPENCODE_READY") {
      sendThemeToIframe();
    }
    if (event.data?.type === "OPENCODE_KEYDOWN") {
      if (event.data.key === "Escape" && selectMode.value) {
        handleSelectModeChange(false);
      }
      if (event.data.ctrlKey && event.data.key.toLowerCase() === "p") {
        toggleSelectMode();
      }
    }
  };
  window.addEventListener("message", handleIframeMessage);
});

const handleToggle = async (val: boolean) => {
  if (serviceStatus.value === "idle" && val) {
    loading.value = true;
    const started = await ensureServicesStarted();
    loading.value = false;
    if (!started) {
      showNotification("服务启动失败");
      return;
    }
  }
  open.value = val;
  if (val) updateContext();
  if (val) {
    iframeLoading.value = false;
  }
};

const handleSelectNode = (element: OpenCodeSelectedElement) => {
  const elementWithContext = {
    ...element,
    previewPageUrl: window.location.href,
    previewPageTitle: document.title,
  };
  widgetRef.value?.sendMessageToIframe("OPENCODE_INSERT_FILE_PART", {
    element: elementWithContext,
  });

  showNotification(`节点已添加到对话框`, { mode: "page" });
};

const handleClearSelected = () => {
  clearElements();
  updateContext(true);
  showNotification("已清除所有选中元素");
};

const handleSelectModeChange = (val: boolean) => {
  selectMode.value = val;
  widgetRef.value?.sendMessageToIframe("OPENCODE_SELECT_MODE_CHANGE", {
    selectMode: val,
  });
  const isSplit = widgetRef.value?.isSplitMode;
  if (val && !isSplit && open.value) {
    open.value = false;
  }
  if (!val && !open.value) {
    open.value = true;
  }
};

const handleSessionListCollapsedChange = (val: boolean) => {
  sessionListCollapsed.value = val;
};

const handleThemeChange = (val: OpenCodeWidgetTheme) => {
  theme.value = val;
};

const handleSplitPanelWidthChange = (val: number) => {
  splitPanelWidth.value = val;
};

const handleRemoveSelectedNode = ({ index }: { index: number; }) => {
  removeElement(index);
  updateContext(true);
};

const handleFrameLoaded = () => {
  iframeLoading.value = false;
};
</script>

<template>
  <OpenCodeWidget
    ref="widgetRef"
    :theme="theme"
    :open="open"
    :select-mode="selectMode"
    :session-list-collapsed="sessionListCollapsed"
    :frame-loading="computedLoading"
    :loading-session-list="loadingSessionList"
    :show-session-list-skeleton="showSessionListSkeleton"
    :show-error="chromeMcpFailed"
    :iframe-src="iframeSrc"
    :current-session-id="currentSessionId"
    :sessions="sessions"
    :session-states="sessionStates"
    session-key="id"
    :hotkey-label="hotkey"
    :thinking="thinking"
    :display-mode="displayMode"
    :split-mode="splitMode"
    :split-panel-width="splitPanelWidth"
    @update:open="handleToggle"
    @update:select-mode="handleSelectModeChange"
    @update:session-list-collapsed="handleSessionListCollapsedChange"
    @update:theme="handleThemeChange"
    @update:split-panel-width="handleSplitPanelWidthChange"
    @toggle-theme="handleThemeChange"
    @create-session="createSession"
    @delete-session="deleteSession"
    @select-session="selectSession"
    @click-selected-node="handleSelectNode"
    @clear-selected-nodes="handleClearSelected"
    @remove-selected-node="handleRemoveSelectedNode"
    @empty-action="createSession"
    @frame-loaded="handleFrameLoaded"
  >
    <template #loading>
      <LoadingContent :loading-text="displayLoadingText" />
    </template>
    <template #error>
      <ChromeWarmupError
        v-if="chromeMcpFailed"
        :retrying="retryingWarmup"
        :error-type="chromeMcpErrorType"
        :error-message="chromeMcpErrorMessage"
        :models="availableModels"
        @retry="retryWarmup"
      />
    </template>
  </OpenCodeWidget>
</template>
