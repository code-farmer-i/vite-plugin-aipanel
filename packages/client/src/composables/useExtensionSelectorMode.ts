import { onMounted, onUnmounted } from "vue";
import type { AIPanelSelectedElement } from "@aipanel/core";
import { WIDGET_MSG } from "@aipanel/core";

interface UseExtensionSelectorModeOptions {
  onSelectModeChange: (val: boolean) => void;
}

/**
 * extension-selector 模式：封装 window.postMessage 消息监听，
 * 包含选择指令接收、选择结果回传
 */
export function useExtensionSelectorMode(options: UseExtensionSelectorModeOptions) {
  const { onSelectModeChange } = options;

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
    window.postMessage(
      {
        type: WIDGET_MSG.ELEMENT_SELECTED,
        filePath: element.filePath,
        line: element.line,
        column: element.column,
        innerText: element.innerText,
        description: element.description,
      },
      "*",
    );
  }

  /** 通知 Side Panel 选择模式变化 */
  function notifySelectModeChange(val: boolean) {
    window.postMessage(
      {
        type: val ? WIDGET_MSG.SELECTOR_START : WIDGET_MSG.SELECTOR_STOP,
      },
      "*",
    );
  }

  return { notifySelectionResult, notifySelectModeChange };
}
