import type {
  ChatSession,
  PageContext,
  ProviderCapabilities,
  ProviderEvent,
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
  /** 获取会话列表；activeSessionId（当前选中会话）由客户端传入，供 Provider 对齐 UI 可见性规则 */
  getSessions: (activeSessionId?: string) => Promise<ChatSession[]>;
  createSession: () => Promise<ChatSession>;
  deleteSession: (id: string) => Promise<void>;
  /** 获取当前 Provider 能力描述（客户端自适应行为依据） */
  getCapabilities: () => ProviderCapabilities;
  /** 宿主事件推送令牌（Host 插件回推 ProviderEvent 时鉴权用；未启动时 null） */
  get eventsToken(): string | null;
  /** 广播一条 ProviderEvent 给所有 SSE 客户端（SESSION_EVENT 载荷；Host 插件回推与 Provider 订阅共用） */
  pushProviderEvent: (event: ProviderEvent) => void;
  resolveWidgetPath: () => string;
  resolveWidgetStylePath: () => string;
  retryWarmupChromeMcp: () => Promise<{
    success: boolean;
    errorType?: string;
    errorMessage?: string;
  }>;
}
