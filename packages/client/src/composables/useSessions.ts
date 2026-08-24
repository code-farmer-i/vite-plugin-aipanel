import { ref, computed, type Ref } from "vue";
import { SESSIONS_API_PATH, createLogger } from "@aipanel/core";
import type { ChatSession, AIPanelWidgetSession } from "@aipanel/core";

const log = createLogger("AIPanel");

export interface UseSessionsOptions {
  showNotification: (msg: string) => void;
  /** Vite 服务 base URL (如 http://127.0.0.1:5099) */
  viteBaseUrl?: string;
  /** Session 更新回调 (从 SSE 事件接收) */
  onSessionUpdate?: Ref<
    ((session: { id: string; title?: string; time?: { updated?: number } }) => void) | undefined
  >;
}

/** 归一化会话 → 挂件会话 */
function toWidgetSession(s: ChatSession): AIPanelWidgetSession {
  return {
    id: s.id,
    title: s.title,
    updatedAt: s.updatedAt || Date.now(),
    url: s.url,
  };
}

export function useSessions(options: UseSessionsOptions) {
  const { showNotification, viteBaseUrl = "" } = options;
  const basePath = (path: string) => (viteBaseUrl ? `${viteBaseUrl}${path}` : path);
  const sessions = ref<AIPanelWidgetSession[]>([]);
  const loadingSessionList = ref<boolean | undefined>(undefined);
  const currentSessionId = ref<string | null>(null);
  const iframeLoading = ref(true);

  const iframeSrc = computed(() => {
    return currentSessionId.value
      ? sessions.value.find((s) => s.id === currentSessionId.value)?.url || ""
      : "";
  });

  const loadSessions = async () => {
    loadingSessionList.value = true;
    iframeLoading.value = true;
    try {
      const response = await fetch(basePath(SESSIONS_API_PATH));
      const data: ChatSession[] = await response.json();
      sessions.value = data.map(toWidgetSession);

      if (!sessions.value.length) {
        createSession();
      }
      currentSessionId.value = sessions.value[0]?.id || null;
    } catch (e) {
      log.error("Failed to load sessions:", { error: e });
    } finally {
      loadingSessionList.value = false;
    }
  };

  /**
   * 更新指定 session 的标题和时间
   * 从 SSE session.updated 事件触发
   */
  const updateSessionInfo = (sessionUpdate: {
    id: string;
    title?: string;
    time?: { updated?: number };
  }) => {
    const index = sessions.value.findIndex((s) => s.id === sessionUpdate.id);
    if (index === -1) return;

    const session = sessions.value[index];
    if (sessionUpdate.title && sessionUpdate.title !== session.title) {
      sessions.value[index] = {
        ...session,
        title: sessionUpdate.title,
        updatedAt: sessionUpdate.time?.updated || Date.now(),
      };
    }
  };

  const createSession = async () => {
    try {
      const response = await fetch(basePath(SESSIONS_API_PATH), { method: "POST" });
      const newSession: ChatSession = await response.json();
      sessions.value.unshift(toWidgetSession(newSession));
      currentSessionId.value = newSession.id;
      iframeLoading.value = true;
    } catch {
      showNotification("创建会话失败");
    }
  };

  const deleteSession = async (session: AIPanelWidgetSession) => {
    try {
      await fetch(basePath(`${SESSIONS_API_PATH}?id=${session.id}`), { method: "DELETE" });
      await loadSessions();
      showNotification("会话已删除");
      if (currentSessionId.value === session.id) {
        if (sessions.value.length > 0) {
          const nextSession = sessions.value[0];
          currentSessionId.value = nextSession.id;
          iframeLoading.value = true;
        } else {
          currentSessionId.value = null;
        }
      }
    } catch {
      showNotification("删除会话失败");
    }
  };

  const selectSession = (session: AIPanelWidgetSession) => {
    if (currentSessionId.value === session.id) return;
    currentSessionId.value = session.id;
    iframeLoading.value = true;
  };

  return {
    sessions,
    loadingSessionList,
    currentSessionId,
    iframeSrc,
    iframeLoading,
    loadSessions,
    createSession,
    deleteSession,
    selectSession,
    updateSessionInfo,
  };
}
