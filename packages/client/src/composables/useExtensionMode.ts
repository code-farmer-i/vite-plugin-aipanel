import { onMounted, onUnmounted, type Ref } from "vue";
import type { OpenCodeSelectedElement, OpenCodeWidgetTheme } from "@vite-plugin-opencode-assistant/shared";
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
  serviceInstanceId?: string;
  theme?: OpenCodeWidgetTheme;
}

interface UseExtensionModeOptions {
  selectMode: Ref<boolean>;
  serviceInstanceId: string;
  onElementSelected: (
    element: OpenCodeSelectedElement,
    pageUrl?: string,
    pageTitle?: string,
  ) => void;
  onThemeChange?: (theme: OpenCodeWidgetTheme) => void;
}

/**
 * 扩展模式：封装 chrome.runtime.onMessage 消息监听，
 * 按 serviceInstanceId 隔离多 Vite 服务消息，包含元素选择结果处理、选择模式状态同步、主题同步
 */
export function useExtensionMode(options: UseExtensionModeOptions) {
  const { selectMode, serviceInstanceId, onElementSelected, onThemeChange } = options;

  const handleMessage = (msg: ExtensionMessage) => {
    // 按 serviceInstanceId 过滤，仅处理来自当前服务实例的消息
    if (msg.serviceInstanceId && msg.serviceInstanceId !== serviceInstanceId) return;

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
      case EXT_MSG.THEME_CHANGE:
        if (msg.theme && onThemeChange) {
          onThemeChange(msg.theme);
        }
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

  /** 广播主题变更（同步到所有实例） */
  function broadcastTheme(theme: OpenCodeWidgetTheme) {
    chrome.runtime.sendMessage({ type: EXT_MSG.THEME_CHANGE, theme }).catch(() => {});
  }

  return { onSelectModeChange, broadcastTheme };
}
