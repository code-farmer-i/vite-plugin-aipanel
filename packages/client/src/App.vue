<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { AIPanelWidget } from "@aipanel/ui";
import type {
  AIPanelWidgetTheme,
  AIPanelSelectedElement,
} from "@aipanel/core";
import type { WidgetOptions } from "@aipanel/core";
import { WIDGET_MSG, WARMUP_API_PATH, START_API_PATH, ensureNodeId } from "@aipanel/core";
import { createLogger } from "@aipanel/core/client";

import { useHotkey } from "./composables/useHotkey";
import { useServerSSE } from "./composables/useServerSSE";
import { useSessionEvents } from "./composables/useSessionEvents";
import { useSessionsAndCapabilities } from "./composables/useSessionsAndCapabilities";
import { useTheme } from "./composables/useTheme";
import { useSelectedElements } from "./composables/useSelectedElements";
import { useServiceStatus } from "./composables/useServiceStatus";
import { usePageContext } from "./composables/usePageContext";
import { useExtensionContext } from "./composables/useExtensionContext";
import { useExtensionMode } from "./composables/useExtensionMode";
import { useExtensionSelectorMode } from "./composables/useExtensionSelectorMode";
import LoadingContent from "./components/LoadingContent.vue";
import ChromeWarmupError from "./components/ChromeWarmupError.vue";
import { EXT_MSG } from "@aipanel/core";

const props = defineProps<{
  config: Partial<WidgetOptions>;
}>();

const open = ref(false);
const selectMode = ref(false);
const sessionListCollapsed = ref(true);
const loading = ref(false);
const widgetRef = ref<InstanceType<typeof AIPanelWidget> | null>(null);
const retryingWarmup = ref(false);

const {
  theme: initialTheme = "auto",
  open: autoOpen = false,
  hotkey = "ctrl+k",
  proxyPort = 6097,
  displayMode = "bubble",
  splitMode,
  vitePort = "",
  serviceInstanceId = "",
  myWindowId,
} = props.config;

const aipanelLog = createLogger("AIPanel");
const log = createLogger("App");

const widgetTheme = initialTheme as AIPanelWidgetTheme;
const splitPanelWidth = ref(splitMode?.width ?? 500);

const isExtensionMode = displayMode === "extension";
const isExtensionSelectorMode = displayMode === "extension-selector";

// 构建绝对 URL，用于绕过全局 monkey-patch（多实例场景下每个实例有独立的 vitePort）
const viteBaseUrl = computed(() => vitePort ? `http://127.0.0.1:${vitePort}` : "");

// 构建请求 URL（扩展模式下用绝对 URL，否则用相对路径走 monkey-patch）
const apiPath = (path: string) => viteBaseUrl.value ? `${viteBaseUrl.value}${path}` : path;

// 扩展模式 composable 返回值（在 composable 调用后填充）
const ext = {
  onSelectModeChange: null as ((val: boolean) => void) | null,
  broadcastTheme: null as ((theme: AIPanelWidgetTheme) => void) | null,
  notifySelectionResult: null as ((element: AIPanelSelectedElement) => void) | null,
  notifySelectModeChange: null as ((val: boolean) => void) | null,
};

const showNotification = (
  msg: string,
  options?: { duration?: number; mode?: "widget" | "page"; },
) => {
  // 扩展模式下通知渲染在实例内部，避免多实例间可见
  widgetRef.value?.showNotification?.(msg, {
    ...options,
    mode: isExtensionMode ? "widget" : options?.mode,
  });
};

const {
  serviceStatus,
  currentTask,
  chromeMcpFailed,
  chromeMcpErrorType,
  chromeMcpErrorMessage,
  loadingText,
  updateStatusFromTask,
  setStarting,
} = useServiceStatus();

const { selectedElements, addElement, removeElement, clearElements } = useSelectedElements(serviceInstanceId);

const { theme, sendThemeToIframe } = useTheme(widgetTheme, widgetRef);

const {
  sessions,
  loadingSessionList,
  currentSessionId,
  iframeSrc,
  iframeLoading,
  isDeepLink,
  reviewPanelEnabled,
  loadSessions,
  createSession,
  deleteSession,
  selectSession,
  updateSessionInfo,
} = useSessionsAndCapabilities({
  showNotification,
  viteBaseUrl: viteBaseUrl.value,
  onFocusSession: (sessionId) => {
    widgetRef.value?.sendMessageToIframe(WIDGET_MSG.FOCUS_SESSION, { sessionId });
  },
});

const { updateContext } = isExtensionMode
  ? useExtensionContext(serviceStatus, selectedElements, viteBaseUrl.value, serviceInstanceId)
  : usePageContext(serviceStatus, selectedElements, viteBaseUrl.value);

// 消费 Provider 归一化会话事件（SESSION_EVENT，来自服务端 SSE）
const sessionEvents = useSessionEvents({
  currentSessionId,
  onSessionUpdate: (session) => {
    // 当 Provider 自动生成标题后，更新本地 session 列表
    updateSessionInfo(session);
  },
});

// Server SSE: 监听 Vite server 事件 (服务启动状态 + 会话事件)
const serverSSE = useServerSSE({
  viteBaseUrl: viteBaseUrl.value,
  onStatusSync: (data) => {
    log.debug(`SSE STATUS_SYNC: ${JSON.stringify(data)} currentStatus: ${serviceStatus.value}`);
    // SSE 重连后如果服务仍在启动中，重置为 starting 以显示蒙层
    if (justReconnected && data.task && data.task !== "ready" && data.task !== "chrome_mcp_failed" &&
      data.task !== "session_creation_failed" && data.task !== "provider_not_installed" &&
      data.task !== "web_start_timeout" && data.task !== "proxy_start_failed") {
      log.debug(`SSE 重连后服务仍在启动中(${data.task})，重置 status 为 starting`);
      currentTask.value = data.task;
      serviceStatus.value = "starting";
      justReconnected = false;
      return;
    }
    justReconnected = false;
    if (data.isStarted !== undefined && data.isStarted && serviceStatus.value === "idle") {
      setStarting();
    }
    if (data.task) {
      updateStatusFromTask(data.task, data.errorType, data.errorMessage);
    }
  },
  onTaskUpdate: (data) => {
    log.debug(`SSE TASK_UPDATE: ${JSON.stringify(data)} currentStatus: ${serviceStatus.value}`);
    updateStatusFromTask(data.task, data.errorType, data.errorMessage);
  },
  onSessionEvent: (event) => sessionEvents.handleEvent(event),
  onClearElements: () => clearElements(),
  onConnected: () => updateContext(true),
});

// SSE 断开/重连 → 服务上下线实时同步（localhost 无网络抖动）
let sseWasDown = false;
let justReconnected = false;
watch(serverSSE.isConnected, (connected, wasConnected) => {
  if (!connected && wasConnected && serviceInstanceId) {
    sseWasDown = true;
    log.debug(`SSE 断开，通知服务下线: ${serviceInstanceId}`);
    chrome.runtime.sendMessage({
      type: EXT_MSG.SERVICE_GONE,
      serviceInstanceId,
      windowId: myWindowId,
    }).catch(() => { });
  } else if (connected && !wasConnected && sseWasDown && serviceInstanceId) {
    sseWasDown = false;
    justReconnected = true;
    log.debug(`SSE 重连，通知服务上线: ${serviceInstanceId}`);
    chrome.runtime.sendMessage({
      type: EXT_MSG.SERVICE_APPEARED,
      proxyPort,
      vitePort,
      serviceInstanceId,
      windowId: myWindowId,
    }).catch(() => { });
  }
});

// 只要有一个会话处于 thinking 状态就设为 true
const thinking = sessionEvents.hasAnyThinking;
const sessionStates = sessionEvents.sessionStates;

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

const retryWarmup = async () => {
  retryingWarmup.value = true;

  try {
    const res = await fetch(apiPath(WARMUP_API_PATH), {
      method: "POST",
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
      showNotification(data.error || "重试失败，请确认 Chrome 远程调试已开启");
    }
  } catch (e) {
    aipanelLog.error("Retry warmup failed:", { error: e });
    showNotification("重试失败，请稍后再试");
  } finally {
    retryingWarmup.value = false;
  }
};

const ensureServicesStarted = async () => {
  if (serviceStatus.value !== "idle") return true;
  try {
    const res = await fetch(apiPath(START_API_PATH));
    const data = await res.json();
    // 防御性检查：fetch 期间 serviceStatus 可能已被其他流程改变（如 SSE），仅当仍为 idle 时才启动
    if (serviceStatus.value !== "idle") {
      log.debug(`[ensureServicesStarted] fetch 完成但 serviceStatus 已变为 ${serviceStatus.value}，跳过启动`);
      return true;
    }
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
  if (isExtensionMode) {
    handleSelectModeChange(!selectMode.value);
    return;
  }

  const win = window as typeof window & { __VUE_INSPECTOR__?: unknown; };
  if (win.__VUE_INSPECTOR__) {
    handleSelectModeChange(!selectMode.value);
  } else {
    showNotification("Vue Inspector 未加载，无法使用元素选择功能");
  }
};

// Ctrl+P 热键仅在非扩展模式下注册（扩展模式在 Side Panel 中运行）
if (!isExtensionMode) {
  useHotkey("ctrl+p", (e) => {
    e.preventDefault();
    toggleSelectMode();
  });
}

// 监听服务状态变化，启动相应的 SSE 连接
watch(serviceStatus, (status, oldStatus) => {
  if (status !== "idle" && oldStatus === "idle") {
    serverSSE.connect();
  }
  if (status === "ready" && oldStatus !== "ready") {
    log.debug("服务就绪，加载会话列表");
    loadSessions();
  }
});

// iframe 消息监听回调
const iframeLoadTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

const handleIframeMessage = (event: MessageEvent) => {
  // SESSION_READY：无 deepLink 能力 Provider（如 dsh）确认"目标会话已激活且渲染稳定"
  // 后才放行 loading。仅当上报 sessionId 与当前目标会话一致时生效，避免串会话误放行。
  if (event.data?.type === WIDGET_MSG.SESSION_READY) {
    const readySessionId = event.data.sessionId;
    sendThemeToIframe();
    // 已确认目标会话激活且稳定 → 放行 loading，且不再重复聚焦（否则 FOCUS_SESSION
    // → bridge reload → 再 SESSION_READY 会刷新死循环）
    if (readySessionId && readySessionId === currentSessionId.value) {
      if (iframeLoadTimeout.value) {
        clearTimeout(iframeLoadTimeout.value);
        iframeLoadTimeout.value = null;
      }
      iframeLoading.value = false;
      return;
    }
    // iframe 激活的是其它/无会话（如首次 FOCUS_SESSION 在 iframe 就绪前丢失）：
    // 补发聚焦目标会话，待其激活后收到匹配的 SESSION_READY 再放行。
    // 但仅当仍在等待目标会话（loading 未放行）时才补发：页面已渲染稳定后，dsh 内部
    // current 的短暂变动也会派发失配 ready，此时补发聚焦会触发 bridge reload 造成多余刷新。
    if (iframeLoading.value && currentSessionId.value) {
      widgetRef.value?.sendMessageToIframe(WIDGET_MSG.FOCUS_SESSION, {
        sessionId: currentSessionId.value,
      });
    }
    return;
  }
  if (event.data?.type === WIDGET_MSG.READY) {
    // deepLink（如 opencode）：应用就绪即代表稳定，可关闭蒙层；
    // 无 deepLink（如 dsh）：放行与补发聚焦均由 SESSION_READY 负责，这里只同步主题
    if (isDeepLink()) {
      if (iframeLoadTimeout.value) {
        clearTimeout(iframeLoadTimeout.value);
        iframeLoadTimeout.value = null;
      }
      iframeLoading.value = false;
      sendThemeToIframe();
      // 补发当前会话聚焦：首次 FOCUS_SESSION 可能在 iframe 就绪前发出而丢失（deepLink 场景）
      if (currentSessionId.value) {
        widgetRef.value?.sendMessageToIframe(WIDGET_MSG.FOCUS_SESSION, {
          sessionId: currentSessionId.value,
        });
      }
    }
  }
  if (event.data?.type === WIDGET_MSG.KEYDOWN) {
    if (event.data.key === "Escape" && selectMode.value) {
      handleSelectModeChange(false);
    }
    if (event.data.ctrlKey && event.data.key.toLowerCase() === "p") {
      toggleSelectMode();
    }
  }
};

// 关闭面板时退出选择元素模式（onUnmounted 在 Side Panel 关闭时不一定触发，
// 通过 visibilitychange + pagehide 事件确保清理）
const cleanupSelectMode = () => {
  if (selectMode.value) {
    ext.onSelectModeChange?.(false);
  }
};

onMounted(() => {
  log.debug(`onMounted, sid=${serviceInstanceId}, serviceStatus=${serviceStatus.value}, config: ${JSON.stringify(props.config)}`);
  if (serviceStatus.value === "ready") {
    log.debug("onMounted: ready 分支，直接加载会话");
    loadSessions();
    serverSSE.connect();
    updateContext(true);
  } else if (serviceStatus.value === "idle") {
    if (isExtensionMode) {
      log.debug("onMounted: idle 分支（扩展模式），先 setStarting 显示蒙层");
      // 扩展模式：服务可能正在启动中，先显示加载蒙层，等待 SSE 确认 ready 后再加载会话
      setStarting();
      serverSSE.connect();
    } else {
      log.debug("onMounted: idle 分支（非扩展模式），直接加载会话");
      loadSessions();
      serverSSE.connect();
    }
  }
  if (autoOpen && serviceStatus.value === "ready") {
    setTimeout(() => {
      open.value = true;
    }, 1000);
  }

  // 监听 iframe 消息（主题同步和键盘事件）
  window.addEventListener("message", handleIframeMessage);
  document.addEventListener("visibilitychange", cleanupSelectMode);
  window.addEventListener("pagehide", cleanupSelectMode);
});

onUnmounted(() => {
  if (iframeLoadTimeout.value) {
    clearTimeout(iframeLoadTimeout.value);
    iframeLoadTimeout.value = null;
  }
  window.removeEventListener("message", handleIframeMessage);
  document.removeEventListener("visibilitychange", cleanupSelectMode);
  window.removeEventListener("pagehide", cleanupSelectMode);
  cleanupSelectMode();
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
};

const handleSelectNode = async (element: AIPanelSelectedElement, pageUrl?: string) => {
  if (isExtensionSelectorMode) {

    ext.notifySelectionResult?.(element);
    showNotification("元素已选中", { mode: "page" });
    return;
  }

  // 同一节点（filePath+line）重复选中时复用已分配 id，保证会话标记与上下文注入一致
  const existing = selectedElements.value.find(
    (el) => el.filePath === element.filePath && el.line === element.line,
  );
  const id = existing?.id ?? ensureNodeId(element);

  const elementWithContext = {
    ...element,
    id,
    previewPageUrl: isExtensionMode && pageUrl ? pageUrl : window.location.href,
  };

  // 写入选中元素列表并同步到核心层 context 端点（携带 id），供 host 端按 @节点[id] 反查注入
  if (addElement(elementWithContext)) {
    updateContext(true);
  }

  widgetRef.value?.sendMessageToIframe(WIDGET_MSG.INSERT_FILE_PART, {
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
  if (selectMode.value === val) return;
  selectMode.value = val;

  if (isExtensionMode) {
    ext.onSelectModeChange?.(val);
  }

  widgetRef.value?.sendMessageToIframe(WIDGET_MSG.SELECT_MODE_CHANGE, {
    selectMode: val,
  });
  const isSplit = widgetRef.value?.isSplitMode;
  if (val && !isSplit && open.value) {
    open.value = false;
  }
  if (!val && !open.value) {
    open.value = true;
  }
  if (isExtensionSelectorMode) {
    ext.notifySelectModeChange?.(val);
  }
};

// 扩展模式 composable 调用（必须在 handler 函数定义之后）
if (isExtensionMode) {
  const result = useExtensionMode({
    selectMode,
    serviceInstanceId,
    onElementSelected: handleSelectNode,
    onThemeChange: (t) => {
      theme.value = t;
      sendThemeToIframe();
    },
  });
  ext.onSelectModeChange = result.onSelectModeChange;
  ext.broadcastTheme = result.broadcastTheme;
}
if (isExtensionSelectorMode) {
  const result = useExtensionSelectorMode({ onSelectModeChange: handleSelectModeChange });
  ext.notifySelectionResult = result.notifySelectionResult;
  ext.notifySelectModeChange = result.notifySelectModeChange;
}

const handleSessionListCollapsedChange = (val: boolean) => {
  sessionListCollapsed.value = val;
};

const handleThemeChange = (val: AIPanelWidgetTheme) => {
  theme.value = val;
  if (isExtensionMode) {
    ext.broadcastTheme?.(val);
  }
};

const handleSplitPanelWidthChange = (val: number) => {
  splitPanelWidth.value = val;
};

const handleRemoveSelectedNode = ({ index }: { index: number; }) => {
  removeElement(index);
  updateContext(true);
};

const handleFrameLoaded = () => {
  // deepLink：iframe HTML 加载完成但应用可能未初始化，待 READY 关闭蒙层；10s 兜底。
  // 无 deepLink：放行只认 SESSION_READY（确认目标会话已激活且稳定），此处仅做较长兜底防止卡死，
  // 不参与提前隐藏 loading。
  const hangMs = isDeepLink() ? 10000 : 30000;
  iframeLoadTimeout.value = setTimeout(() => {
    iframeLoading.value = false;
    iframeLoadTimeout.value = null;
  }, hangMs);
};
</script>

<template>
  <AIPanelWidget
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
    :review-panel-enabled="reviewPanelEnabled"
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
        @retry="retryWarmup"
      />
    </template>
  </AIPanelWidget>
</template>
