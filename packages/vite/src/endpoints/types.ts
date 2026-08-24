import type {
  ChatSession,
  PageContext,
  ProviderCapabilities,
  ServiceStartupTask,
} from "@aipanel/core";
import type http from "http";

export interface EndpointContext {
  get webUrl(): string | null;
  get sseClients(): Set<http.ServerResponse>;
  /** 获取当前活跃 Tab 的上下文（扩展模式）或默认上下文（非扩展模式） */
  getPageContext(): PageContext;
  /** 写入某个 Tab 的上下文 */
  setPageContext(tabId: string, ctx: PageContext): void;
  /** 设置当前活跃 Tab ID */
  setActiveTabId(tabId: string): void;
  /** 清除选中元素（活跃 Tab） */
  clearSelectedElements(): void;
  get isServiceStarted(): boolean;
  get currentTask(): { task: ServiceStartupTask; data?: Record<string, unknown> } | null;
  get actualProxyPort(): number;
  get actualWebPort(): number;
  get serviceInstanceId(): string;
  getSessions: () => Promise<ChatSession[]>;
  createSession: () => Promise<ChatSession>;
  deleteSession: (id: string) => Promise<void>;
  /** 获取当前 Provider 能力描述（客户端自适应行为依据） */
  getCapabilities: () => ProviderCapabilities;
  resolveWidgetPath: () => string;
  resolveWidgetStylePath: () => string;
  retryWarmupChromeMcp: () => Promise<{
    success: boolean;
    errorType?: string;
    errorMessage?: string;
  }>;
}
