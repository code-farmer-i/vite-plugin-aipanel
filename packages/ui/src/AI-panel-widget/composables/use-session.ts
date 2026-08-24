import { computed, type Ref } from "vue";
import type { AIPanelWidgetSession, AIPanelWidgetSessionItem } from "../src/types";

function formatSessionMeta(session: AIPanelWidgetSession): string {
  if (session.meta) {
    return session.meta;
  }

  if (!session.updatedAt) {
    return "";
  }

  const date = new Date(session.updatedAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export interface UseSessionOptions {
  sessions: Ref<AIPanelWidgetSession[]>;
  currentSessionId: Ref<string | number | null>;
  onCreateSession: () => void;
  onSelectSession: (session: AIPanelWidgetSession) => void;
  onDeleteSession: (session: AIPanelWidgetSession) => void;
  showConfirmDialog: (message: string) => Promise<boolean>;
}

export function useSession(options: UseSessionOptions) {
  const sessionItems = computed<AIPanelWidgetSessionItem[]>(() =>
    (options.sessions.value || []).map((session: AIPanelWidgetSession) => ({
      key: session.id,
      id: session.id,
      title: session.title || "新会话",
      meta: formatSessionMeta(session),
      active: session.id === options.currentSessionId.value,
      session,
    })),
  );

  function handleCreateSession(): void {
    options.onCreateSession();
  }

  function handleSelectSession(item: AIPanelWidgetSessionItem): void {
    options.onSelectSession(item.session);
  }

  async function handleDeleteSession(item: AIPanelWidgetSessionItem): Promise<void> {
    const confirmed = await options.showConfirmDialog(`确定要删除会话 "${item.title}" 吗？`);
    if (confirmed) {
      options.onDeleteSession(item.session);
    }
  }

  return {
    sessionItems,
    handleCreateSession,
    handleDeleteSession,
    handleSelectSession,
  };
}
