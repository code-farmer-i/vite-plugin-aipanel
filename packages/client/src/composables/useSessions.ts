import { ref, computed, nextTick, type Ref } from "vue";
import { SESSIONS_API_PATH, createLogger } from "@aipanel/core";
import type { ChatSession, AIPanelWidgetSession } from "@aipanel/core";

const log = createLogger("AIPanel");

export interface UseSessionsOptions {
  showNotification: (msg: string) => void;
  /** Vite 服务 base URL (如 http://127.0.0.1:5099) */
  viteBaseUrl?: string;
  /** 无深链能力时切换/创建/删除会话后的聚焦回调（App 层向 iframe 发送 FOCUS_SESSION 消息） */
  onFocusSession?: (sessionId: string) => void;
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
  const { showNotification, viteBaseUrl = "", onFocusSession } = options;
  const basePath = (path: string) => (viteBaseUrl ? `${viteBaseUrl}${path}` : path);
  const sessions = ref<AIPanelWidgetSession[]>([]);
  const loadingSessionList = ref<boolean | undefined>(undefined);
  const currentSessionId = ref<string | null>(null);
  const iframeLoading = ref(true);

  /** Provider 是否支持会话 URL 深链（默认 true，随会话列表响应校正；会话展示能力由本会话自身数据源驱动） */
  const deepLink = ref(true);

  /** 是否支持会话 URL 深链（默认 true） */
  const isDeepLink = () => deepLink.value;

  const iframeSrc = computed(() => {
    if (!isDeepLink()) {
      // 无深链能力：保持应用壳 URL（所有会话共用），切换会话不重载 iframe
      return sessions.value[0]?.url || "";
    }
    return currentSessionId.value
      ? sessions.value.find((s) => s.id === currentSessionId.value)?.url || ""
      : "";
  });

  /** 无深链能力时切换会话：通过消息聚焦，而非重载 iframe */
  const focusSession = (sessionId: string) => {
    // 无论深链与否都先展示加载蒙层；无深链场景下放行交由 iframe 的 SESSION_READY 确认
    iframeLoading.value = true;
    if (isDeepLink()) {
      // deepLink：iframe src 变化触发 @frame-loaded，待 READY 后关闭蒙层
    } else {
      onFocusSession?.(sessionId);
    }
  };

  const loadSessions = async () => {
    loadingSessionList.value = true;
    // 深链模式每次重载；无深链模式仅首次加载应用壳时需要重载
    if (isDeepLink() || sessions.value.length === 0) {
      iframeLoading.value = true;
    }
    try {
      const response = await fetch(basePath(SESSIONS_API_PATH));
      const data = (await response.json()) as {
        sessions: ChatSession[];
        capabilities?: { deepLink?: boolean };
      };
      // 先校正能力再赋值会话，保证 iframeSrc 计算时 deepLink 已就绪（能力随会话响应下发，无需独立 /capabilities 往返）
      deepLink.value = data.capabilities?.deepLink !== false;
      sessions.value = data.sessions.map(toWidgetSession);

      if (!sessions.value.length) {
        createSession();
      }
      currentSessionId.value = sessions.value[0]?.id || null;
      // 无 deepLink：iframe 加载应用壳后，dsh 需要从 localStorage 恢复会话/工作区选中态。
      // 首次加载必须主动把当前会话同步进 iframe，否则 dsh 不会激活对应工作区和会话。
      if (currentSessionId.value) {
        focusSession(currentSessionId.value);
      }
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
      // 先显示 loading 蒙层并等其渲染覆盖后，再切换当前会话/下发聚焦，避免 iframe 内容闪动
      iframeLoading.value = true;
      await nextTick();
      currentSessionId.value = newSession.id;
      focusSession(newSession.id);
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
          // 先显示 loading 蒙层再切换，避免 iframe 内容闪动
          iframeLoading.value = true;
          await nextTick();
          currentSessionId.value = nextSession.id;
          focusSession(nextSession.id);
        } else {
          iframeLoading.value = false;
          currentSessionId.value = null;
        }
      }
    } catch {
      showNotification("删除会话失败");
    }
  };

  const selectSession = async (session: AIPanelWidgetSession) => {
    if (currentSessionId.value === session.id) return;
    // 先显示 loading 蒙层并等其渲染覆盖后，再切换当前会话/下发聚焦，避免 iframe 内容闪动
    iframeLoading.value = true;
    await nextTick();
    currentSessionId.value = session.id;
    focusSession(session.id);
  };

  return {
    sessions,
    loadingSessionList,
    currentSessionId,
    deepLink,
    iframeSrc,
    iframeLoading,
    isDeepLink,
    loadSessions,
    createSession,
    deleteSession,
    selectSession,
    updateSessionInfo,
  };
}
