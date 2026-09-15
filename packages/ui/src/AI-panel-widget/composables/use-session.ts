import { computed, type Ref } from "vue";
import type { AIPanelWidgetSession, AIPanelWidgetSessionItem } from "../src/types";

/**
 * 相对时间标签，对齐官方会话列表行内 timeLabel：刚刚/N分钟/N小时/N天/N个月/N年。
 * 分桶阈值与 @deepseek-ai/dsh-client-ui-primitives 的 relativeTime 一致。
 */
function formatRelativeTime(ts: number | string | Date): string {
  const time = new Date(ts).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Math.max(0, Date.now() - time);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)}分钟`;
  if (diff < day) return `${Math.floor(diff / hour)}小时`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}天`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}个月`;
  return `${Math.floor(diff / (365 * day))}年`;
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
