import { computed, type Ref } from "vue";
import type { AIPanelWidgetSession, AIPanelWidgetSessionItem } from "../src/types";

/** 相对时间标签（对齐官方行内 timeLabel 语义：刚刚/N分钟前/N小时前/N天前） */
function formatRelativeTime(ts: number | string | Date): string {
  const time = new Date(ts).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  if (diff < 0) return "刚刚";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  const date = new Date(time);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatSessionMeta(session: AIPanelWidgetSession): string {
  if (session.meta) {
    return session.meta;
  }

  if (!session.updatedAt) {
    return "";
  }

  return formatRelativeTime(session.updatedAt);
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
