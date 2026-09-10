import { ref, computed } from "vue";
import type { ServiceStartupTask, ServiceStatus } from "@aipanel/core";
import { SERVICE_STARTUP_TASKS } from "@aipanel/core";
import { createLogger } from "@aipanel/core/client";

export function useServiceStatus() {
  const currentTask = ref<ServiceStartupTask | "">("");
  const serviceStatus = ref<ServiceStatus>("idle");
  const chromeMcpFailed = ref(false);
  const chromeMcpErrorType = ref<string | undefined>(undefined);
  const chromeMcpErrorMessage = ref<string | undefined>(undefined);
  /** 服务启动失败（非 Chrome MCP 部分失败）的原因，供错误层展示 */
  const failureErrorType = ref<string | undefined>(undefined);
  const failureErrorMessage = ref<string | undefined>(undefined);
  const log = createLogger("useServiceStatus");

  const loadingText = computed(() => {
    if (!currentTask.value) return "加载中...";
    return SERVICE_STARTUP_TASKS[currentTask.value] || "加载中...";
  });

  const updateStatusFromTask = (
    task: ServiceStartupTask | "",
    errorType?: string,
    errorMessage?: string,
  ) => {
    const prevStatus = serviceStatus.value;
    currentTask.value = task;

    if (task === "ready") {
      serviceStatus.value = "ready";
      chromeMcpFailed.value = false;
      chromeMcpErrorType.value = undefined;
      chromeMcpErrorMessage.value = undefined;
      failureErrorType.value = undefined;
      failureErrorMessage.value = undefined;
    } else if (task === "chrome_mcp_failed") {
      serviceStatus.value = "partial";
      chromeMcpFailed.value = true;
      chromeMcpErrorType.value = errorType;
      chromeMcpErrorMessage.value = errorMessage;
    } else if (
      task === "session_creation_failed" ||
      task === "provider_not_installed" ||
      task === "web_start_timeout" ||
      task === "proxy_start_failed"
    ) {
      serviceStatus.value = "failed";
      failureErrorType.value = errorType;
      failureErrorMessage.value = errorMessage;
    } else if (serviceStatus.value === "idle" && task) {
      serviceStatus.value = "starting";
    }
    log.debug(
      `updateStatusFromTask: task="${task}" status: ${prevStatus} -> ${serviceStatus.value}`,
    );
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
    failureErrorType,
    failureErrorMessage,
    loadingText,
    updateStatusFromTask,
    setStarting,
  };
}
