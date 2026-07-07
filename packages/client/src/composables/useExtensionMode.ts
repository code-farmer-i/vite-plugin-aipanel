import { onMounted, onUnmounted, type Ref } from "vue";
import type { OpenCodeSelectedElement } from "@vite-plugin-opencode-assistant/shared";
import { WIDGET_MSG, EXT_MSG } from "@vite-plugin-opencode-assistant/shared";

interface ExtensionMessage {
  type: string;
  filePath?: string;
  line?: number;
  column?: number;
  innerText?: string;
  description?: string;
  pageUrl?: string;
  pageTitle?: string;
}

interface UseExtensionModeOptions {
  selectMode: Ref<boolean>;
  onElementSelected: (
    element: OpenCodeSelectedElement,
    pageUrl?: string,
    pageTitle?: string,
  ) => void;
}

/**
 * 扩展模式：封装 chrome.runtime.onMessage 消息监听，
 * 包含元素选择结果处理、选择模式状态同步、向目标 Tab 发送选择指令
 */
export function useExtensionMode(options: UseExtensionModeOptions) {
  const { selectMode, onElementSelected } = options;

  const handleMessage = (msg: ExtensionMessage) => {
    switch (msg.type) {
      case WIDGET_MSG.ELEMENT_SELECTED:
        onElementSelected(
          {
            filePath: msg.filePath ?? null,
            line: msg.line ?? null,
            column: msg.column ?? null,
            innerText: msg.innerText ?? "",
            description: msg.description,
          },
          msg.pageUrl,
          msg.pageTitle,
        );
        break;
      case WIDGET_MSG.SELECTION_CANCELLED:
        selectMode.value = false;
        break;
      case WIDGET_MSG.SELECTOR_START:
        selectMode.value = true;
        break;
      case WIDGET_MSG.SELECTOR_STOP:
        selectMode.value = false;
        break;
    }
  };

  onMounted(() => {
    chrome.runtime.onMessage.addListener(handleMessage);
  });

  onUnmounted(() => {
    chrome.runtime.onMessage.removeListener(handleMessage);
  });

  /** 向目标页面（active tab）发送选择指令 */
  async function sendToActiveTab(msg: Record<string, unknown>) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        await chrome.tabs.sendMessage(tabs[0].id, msg);
      }
    } catch {
      // chrome API 仅在扩展上下文可用
    }
  }

  /** 切换选择模式时通知目标 Tab */
  function onSelectModeChange(val: boolean) {
    sendToActiveTab({ type: val ? EXT_MSG.SELECTION_START : EXT_MSG.SELECTION_STOP });
  }

  return { onSelectModeChange };
}
