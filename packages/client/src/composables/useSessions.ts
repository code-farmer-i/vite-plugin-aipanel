import { ref, computed, type Ref } from "vue";
import { SESSIONS_API_PATH } from "@vite-plugin-opencode-assistant/shared";
import type { OpenCodeWidgetSession, SessionInfo } from "@vite-plugin-opencode-assistant/shared";

export interface UseSessionsOptions {
  showNotification: (msg: string) => void;
  /** Session 更新回调 (从 SSE 事件接收) */
  onSessionUpdate?: Ref<((session: { id: string; title?: string; time?: { updated?: number } }) => void) | undefined>;
}

export function useSessions(options: UseSessionsOptions) {
  const { showNotification } = options;
  const sessions = ref<OpenCodeWidgetSession[]>([]);
  const loadingSessionList = ref<boolean | undefined>(undefined);
  const currentSessionId = ref<string | null>(null);
  const iframeLoading = ref(false);

  const iframeSrc = computed(() => {
    return currentSessionId.value
      ? sessions.value.find((s) => s.id === currentSessionId.value)?.url || ""
      : "";
  });

  const loadSessions = async () => {
    loadingSessionList.value = true;
    try {
      const response = await fetch(SESSIONS_API_PATH);
      const data: SessionInfo[] = await response.json();
      sessions.value = data
        .filter((s) => {
          if (s.title === "__chrome_mcp_warmup__") return false;
          if (s.parentID) return false;
          if (s.time?.archived) return false;
          return true;
        })
        .map((s) => ({
          ...s,
          updatedAt: s.time?.updated || Date.now(),
        }));

      if (!sessions.value.length) {
        createSession();
      }
      currentSessionId.value = sessions.value[0]?.id || null;
    } catch (e) {
      console.error("[OpenCode] Failed to load sessions:", e);
    } finally {
      loadingSessionList.value = false;
    }
  };

  /**
   * 更新指定 session 的标题和时间
   * 从 SSE session.updated 事件触发
   */
  const updateSessionInfo = (sessionUpdate: { id: string; title?: string; time?: { updated?: number } }) => {
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
      const response = await fetch(SESSIONS_API_PATH, { method: "POST" });
      const newSession = await response.json();
      sessions.value.unshift({
        id: newSession.id,
        title: "新会话",
        updatedAt: Date.now(),
        url: newSession.url,
      });
      currentSessionId.value = newSession.id;
      iframeLoading.value = true;
      loadSessions();
    } catch {
      showNotification("创建会话失败");
    }
  };

  const deleteSession = async (session: OpenCodeWidgetSession) => {
    try {
      await fetch(`${SESSIONS_API_PATH}?id=${session.id}`, { method: "DELETE" });
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

  const selectSession = (session: OpenCodeWidgetSession) => {
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
