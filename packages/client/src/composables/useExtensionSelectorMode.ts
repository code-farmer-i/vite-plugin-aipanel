import { onMounted, onUnmounted } from "vue";
import type { AIPanelSelectedElement } from "@aipanel/core";
import { WIDGET_MSG } from "@aipanel/core";

interface UseExtensionSelectorModeOptions {
  /** 本页面所属服务实例；随回传消息携带，供 Side Panel 多实例按服务隔离 */
  serviceInstanceId?: string;
  onSelectModeChange: (val: boolean) => void;
}

/**
 * extension-selector 模式：封装 window.postMessage 消息监听，
 * 包含选择指令接收、选择结果回传
 */
export function useExtensionSelectorMode(options: UseExtensionSelectorModeOptions) {
  const { serviceInstanceId = "", onSelectModeChange } = options;

  /**
   * 页面 → Side Panel 回传统一出口：附加 serviceInstanceId。
   * Side Panel 为每个项目保活一个 App 实例，缺少实例标识会导致消息被所有实例处理（跨项目串扰）。
   */
  function postToHost(payload: Record<string, unknown>) {
    window.postMessage(serviceInstanceId ? { ...payload, serviceInstanceId } : payload, "*");
  }

  const handleMessage = (event: MessageEvent) => {
    const type = event.data?.type;
    if (type === WIDGET_MSG.SELECTOR_START) {
      onSelectModeChange(true);
    } else if (type === WIDGET_MSG.SELECTOR_STOP) {
      onSelectModeChange(false);
    }
  };

  onMounted(() => {
    window.addEventListener("message", handleMessage);
  });

  onUnmounted(() => {
    window.removeEventListener("message", handleMessage);
  });

  /** 回传选中结果到目标页面 */
  function notifySelectionResult(element: AIPanelSelectedElement) {
    postToHost({
      type: WIDGET_MSG.ELEMENT_SELECTED,
      filePath: element.filePath,
      line: element.line,
      column: element.column,
      innerText: element.innerText,
      description: element.description,
    });
  }

  /** 通知 Side Panel 选择模式变化 */
  function notifySelectModeChange(val: boolean) {
    postToHost({
      type: val ? WIDGET_MSG.SELECTOR_START : WIDGET_MSG.SELECTOR_STOP,
    });
  }

  return { notifySelectionResult, notifySelectModeChange };
}
