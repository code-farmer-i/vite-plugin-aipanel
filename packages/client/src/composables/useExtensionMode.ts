import { onMounted, onUnmounted, type Ref } from "vue";
import type { AIPanelSelectedElement, AIPanelWidgetTheme } from "@aipanel/core";
import { WIDGET_MSG, EXT_MSG } from "@aipanel/core";

interface ExtensionMessage {
  type: string;
  filePath?: string;
  line?: number;
  column?: number;
  innerText?: string;
  description?: string;
  pageUrl?: string;
  serviceInstanceId?: string;
  theme?: AIPanelWidgetTheme;
}

interface UseExtensionModeOptions {
  selectMode: Ref<boolean>;
  serviceInstanceId: string;
  onElementSelected: (
    element: AIPanelSelectedElement,
    pageUrl?: string,
  ) => void;
  onThemeChange?: (theme: AIPanelWidgetTheme) => void;
}

/**
 * 扩展模式：封装 chrome.runtime.onMessage 消息监听，
 * 按 serviceInstanceId 隔离多 Vite 服务消息，包含元素选择结果处理、选择模式状态同步、主题同步
 */
export function useExtensionMode(options: UseExtensionModeOptions) {
  const { selectMode, serviceInstanceId, onElementSelected, onThemeChange } = options;

  const handleMessage = (msg: ExtensionMessage) => {
    // 选择类消息必须精确匹配 serviceInstanceId：Side Panel 为每个项目保活一个实例，
    // 放行缺失标识的消息会让所有项目都插入同一节点。主题为全局广播，不携带实例标识。
    if (msg.type === EXT_MSG.THEME_CHANGE) {
      if (msg.serviceInstanceId && msg.serviceInstanceId !== serviceInstanceId) return;
    } else if (msg.serviceInstanceId !== serviceInstanceId) {
      return;
    }

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
  function broadcastTheme(theme: AIPanelWidgetTheme) {
    chrome.runtime.sendMessage({ type: EXT_MSG.THEME_CHANGE, theme }).catch(() => {});
  }

  /**
   * 请求目标页定位节点（跳回其页面并呼吸高亮）。
   * 优先发给 URL 匹配的 Tab（用户可能已切走），否则发给当前活跃 Tab；
   * 该消息经 content script 转成窗口消息，由页面里的选择器挂件执行定位。
   */
  async function locateNode(element: AIPanelSelectedElement) {
    const pageUrl = element.previewPageUrl;
    try {
      const tabs = await chrome.tabs.query({});
      const target = pageUrl
        ? tabs.find((tab) => tab.url && tab.url.split("#")[0] === pageUrl.split("#")[0])
        : undefined;
      const fallback = target ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (fallback?.id) {
        await chrome.tabs.sendMessage(fallback.id, { type: EXT_MSG.LOCATE_NODE, element });
      }
    } catch {
      // chrome API 仅在扩展上下文可用
    }
  }

  return { onSelectModeChange, broadcastTheme, locateNode };
}
