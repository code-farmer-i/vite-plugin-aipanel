import type {
  PageContext,
  SessionInfo,
  ServiceStartupTask,
  ModelInfo,
} from "@vite-plugin-opencode-assistant/shared";
import type http from "http";

export interface EndpointContext {
  get webUrl(): string | null;
  get sseClients(): Set<http.ServerResponse>;
  get pageContext(): PageContext;
  set pageContext(ctx: PageContext);
  get isServiceStarted(): boolean;
  get currentTask(): { task: ServiceStartupTask; data?: Record<string, unknown> } | null;
  get actualProxyPort(): number;
  get actualWebPort(): number;
  getSessions: () => Promise<SessionInfo[]>;
  createSession: () => Promise<SessionInfo>;
  deleteSession: (id: string) => Promise<void>;
  resolveWidgetPath: () => string;
  resolveWidgetStylePath: () => string;
  getAvailableModels: () => Promise<ModelInfo[]>;
  retryWarmupChromeMcp: (selectedModel?: { providerID: string; modelID: string }) => Promise<{
    success: boolean;
    errorType?: string;
    errorMessage?: string;
  }>;
}
