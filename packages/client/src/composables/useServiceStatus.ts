import { ref, computed } from "vue";
import type { ServiceStartupTask, ServiceStatus } from "@vite-plugin-opencode-assistant/shared";
import { SERVICE_STARTUP_TASKS } from "@vite-plugin-opencode-assistant/shared";

export function useServiceStatus() {
  const currentTask = ref<ServiceStartupTask | "">("");
  const serviceStatus = ref<ServiceStatus>("idle");
  const chromeMcpFailed = ref(false);
  const chromeMcpErrorType = ref<string | undefined>(undefined);
  const chromeMcpErrorMessage = ref<string | undefined>(undefined);

  const loadingText = computed(() => {
    if (!currentTask.value) return "加载中...";
    return SERVICE_STARTUP_TASKS[currentTask.value] || "加载中...";
  });

  const updateStatusFromTask = (
    task: ServiceStartupTask | "",
    errorType?: string,
    errorMessage?: string,
  ) => {
    currentTask.value = task;

    if (task === "ready") {
      serviceStatus.value = "ready";
      chromeMcpFailed.value = false;
      chromeMcpErrorType.value = undefined;
      chromeMcpErrorMessage.value = undefined;
    } else if (task === "chrome_mcp_failed") {
      serviceStatus.value = "partial";
      chromeMcpFailed.value = true;
      chromeMcpErrorType.value = errorType;
      chromeMcpErrorMessage.value = errorMessage;
    } else if (
      task === "session_creation_failed" ||
      task === "opencode_not_installed" ||
      task === "web_start_timeout"
    ) {
      serviceStatus.value = "failed";
    } else if (serviceStatus.value === "idle" && task) {
      serviceStatus.value = "starting";
    }
  };

  const setStarting = () => {
    serviceStatus.value = "starting";
  };

  return {
    currentTask,
    serviceStatus,
    chromeMcpFailed,
    chromeMcpErrorType,
    chromeMcpErrorMessage,
    loadingText,
    updateStatusFromTask,
    setStarting,
  };
}
