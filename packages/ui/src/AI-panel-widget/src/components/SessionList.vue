<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useAIPanelWidgetContext } from "../context";

const {
  sessionListCollapsed: collapsed,
  sessionItems: sessions,
  loadingSessionList,
  showSessionListSkeleton,
  handleCreateSession,
  handleSelectSession,
  handleDeleteSession,
  sessionKey,
  sessionStates,
} = useAIPanelWidgetContext();

const isAnimating = ref(false);
let animTimer: ReturnType<typeof setTimeout> | null = null;

watch(collapsed, () => {
  isAnimating.value = true;
  if (animTimer) clearTimeout(animTimer);
  animTimer = setTimeout(() => {
    isAnimating.value = false;
  }, 200);
});

const showSkeleton = computed(() => {
  if (isAnimating.value) return true;
  if (showSessionListSkeleton.value) return true;
  // 列表数据刷新中（删除/新建/首次加载等，loadingSessionList=true）复用骨架屏，
  // 不再用旧的居中小转圈遮罩，保证各阶段 loading 视觉一致。
  if (loadingSessionList.value) return true;
  return false;
});

/** 会话行交互状态：单一来源 AIPanelSessionThinkingState；优先级 pending > thinking > running > completed > idle */
type SessionRowStatus = "pending" | "thinking" | "running" | "completed" | "idle";

/** 官方 StateDot ongoing 矩阵：3×3 外圈 8 个 2px 格（中心空）。坐标为官方 MATRIX_CELLS 原序；
 *   delay 取官方 (index - 8) * 125ms 的负延迟，等价第 0 格相位 0、逐格 +125ms 顺时针追逐。 */
const ONGOING_CELLS: ReadonlyArray<{ x: number; y: number; delay: string }> = [
  { x: 0, y: 0, delay: "-1000ms" },
  { x: 4, y: 0, delay: "-875ms" },
  { x: 8, y: 0, delay: "-750ms" },
  { x: 8, y: 4, delay: "-625ms" },
  { x: 8, y: 8, delay: "-500ms" },
  { x: 4, y: 8, delay: "-375ms" },
  { x: 0, y: 8, delay: "-250ms" },
  { x: 0, y: 4, delay: "-125ms" },
];

/** pending 类型的可读标签（title 提示） */
const PENDING_LABELS: Record<string, string> = {
  approval: "等待审批",
  "plan-review": "等待计划确认",
  question: "等待回复",
};

/** running 状态的说明：自身在跑 或 子代理在跑 */
function runningLabel(sessionId: string): string {
  const n = sessionStates?.value?.[sessionId]?.subagentsRunning ?? 0;
  return n > 0 ? "子代理运行中 (" + n + ")" : "运行中";
}

function sessionRowStatus(sessionId: string): SessionRowStatus {
  const state = sessionStates?.value?.[sessionId];
  if (!state) return "idle";
  if (state.hasPending) return "pending";
  // 有子代理在跑：父会话即使自身 idle 也视为进行中（官方 subagent-running 语义）
  const subagentsRunning = (state.subagentsRunning ?? 0) > 0;
  if (subagentsRunning) return "running";
  // 思考中（thinking 事件权威：step/assistant 输出阶段）优先于纯运行；
  // 纯运行（agent/status running 整段保持，无思考事件时）显示转圈。
  if (state.thinking) return "thinking";
  const running = state.statusType === "running" || state.statusType === "streaming";
  if (running) return "running";
  if (state.completed) return "completed";
  return "idle";
}

function pendingLabel(sessionId: string): string {
  const kind = sessionStates?.value?.[sessionId]?.pendingKind;
  return (kind && PENDING_LABELS[kind]) || "等待用户";
}

// 活跃态（思考中/运行中/子代理在跑）统一用转圈 loading 指示
function isSessionActive(sessionId: string): boolean {
  const status = sessionRowStatus(sessionId);
  return status === "thinking" || status === "running";
}

// 判断指定 session 是否有待用户交互（审批/提问/计划评审）
function isSessionPending(sessionId: string): boolean {
  return sessionRowStatus(sessionId) === "pending";
}

// 判断指定 session 是否刚运行完成（仅非当前会话显示提醒）
function isSessionCompleted(sessionId: string): boolean {
  return sessionRowStatus(sessionId) === "completed";
}
</script>

<template>
  <div
    class="aipanel-session-list"
    :class="{ collapsed }"
  >
    <!-- Header -->
    <div
      v-if="!showSkeleton"
      class="aipanel-session-list-header"
    >
      <span
        id="aipanel-session-list-title"
        class="aipanel-session-list-title"
        >会话列表</span
      >
      <button
        class="aipanel-new-session-btn"
        type="button"
        title="新建会话"
        aria-label="新建会话"
        @click="handleCreateSession"
      >
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
    </div>

    <!-- Header Skeleton -->
    <div
      v-else
      class="aipanel-session-header-skeleton visible"
    >
      <div class="aipanel-skeleton-header-title" />
      <div class="aipanel-skeleton-header-btn" />
    </div>

    <!-- Content Skeleton -->
    <div
      v-if="showSkeleton"
      class="aipanel-session-skeleton visible"
    >
      <div
        v-for="i in 5"
        :key="`skeleton-${i}`"
        class="aipanel-skeleton-item"
      >
        <div class="aipanel-skeleton-title" />
        <div class="aipanel-skeleton-meta" />
      </div>
    </div>

    <!-- Content -->
    <div
      v-else
      class="aipanel-session-list-content"
      role="listbox"
      aria-labelledby="aipanel-session-list-title"
    >
      <template v-if="sessions.length > 0">
        <div
          v-for="item in sessions"
          :key="item[sessionKey]"
          class="aipanel-session-item"
          :class="{ active: item.active, thinking: isSessionActive(item.id) }"
          role="option"
          :aria-selected="item.active"
          @click="handleSelectSession(item)"
        >
          <!-- 状态指示：pending=琥珀点 > 活跃(thinking/running/子代理)=转圈 > completed=绿点 > idle -->
          <span
            v-if="isSessionPending(item.id)"
            class="aipanel-session-state aipanel-session-state-pending"
            :title="pendingLabel(item.id)"
          />
          <svg
            v-else-if="isSessionActive(item.id)"
            class="aipanel-session-state aipanel-session-state-ongoing"
            :title="runningLabel(item.id)"
            viewBox="0 0 10 10"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <rect
              v-for="c in ONGOING_CELLS"
              :key="c.x + '-' + c.y"
              :x="c.x"
              :y="c.y"
              width="2"
              height="2"
              :style="{ animationDelay: c.delay }"
              class="aipanel-session-ongoing-cell"
            />
          </svg>
          <span
            v-else-if="isSessionCompleted(item.id)"
            class="aipanel-session-state aipanel-session-state-completed"
            title="已完成"
          />

          <span class="aipanel-session-title-text">{{ item.title }}</span>

          <span
            v-if="item.meta"
            class="aipanel-session-meta"
            >{{ item.meta }}</span
          >

          <button
            class="aipanel-session-delete-btn"
            type="button"
            :aria-label="`删除会话: ${item.title}`"
            @click.stop="handleDeleteSession(item)"
          >
            ×
          </button>
        </div>
      </template>

      <!-- Empty State -->
      <template v-else>
        <slot name="empty" />
      </template>
    </div>
  </div>
</template>

<style>
.aipanel-session-list {
  width: 236px;
  background: var(--ap-bg-secondary);
  border-right: 1px solid var(--ap-border-faint);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.2s ease;
}

.aipanel-session-list.collapsed {
  width: 0;
  overflow: hidden;
}

.aipanel-session-list.collapsed .aipanel-session-list-header,
.aipanel-session-list.collapsed .aipanel-session-list-content {
  display: none;
}

/* Header：小字号分组标签 + 圆形新建按钮 */
.aipanel-session-list-header {
  padding: 10px 8px 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--ap-bg-secondary);
  border-bottom: 1px solid var(--ap-border-faint);
}

.aipanel-session-list-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 18px;
  color: var(--ap-text-tertiary);
}

.aipanel-new-session-btn {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  /* 对齐 DS newSession：elevated-fill + border-l3 发丝边 */
  border: 1px solid var(--ap-border-secondary);
  background: var(--ap-elevated-fill);
  color: var(--ap-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.aipanel-new-session-btn svg {
  display: block;
}

.aipanel-new-session-btn:hover {
  background: var(--ap-elevated-hover);
  color: var(--ap-text-primary);
}

/* 按下态对齐 DS ghost:active = interactive-bg-active */
.aipanel-new-session-btn:active {
  background: var(--ap-press-bg);
}

.aipanel-new-session-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ap-accent-bg);
}

.aipanel-session-list-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 会话行：单行（状态点 + 标题 + 右侧时间），hover 淡覆盖层 */
.aipanel-session-item {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--ap-text-primary);
  transition: background-color 0.15s ease;
}

/* 深色主题：标题用浅灰，不用纯白，避免扎眼（浅色仍用近黑） */
.aipanel-widget.aipanel-theme-dark .aipanel-session-item {
  color: var(--ap-text-secondary);
}

.aipanel-session-item:hover {
  background: var(--ap-hover-bg);
}

/* 点击/按下瞬间：interactive-bg-active（对齐 DS） */
.aipanel-session-item:active {
  background: var(--ap-press-bg);
}

/* 当前会话：对齐 DS sessionRow.selected = interactive-bg-hover（与 hover 同款淡覆盖层） */
.aipanel-session-item.active {
  background: var(--ap-hover-bg);
}

.aipanel-session-title-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
}

.aipanel-session-meta {
  flex: none;
  margin-left: auto;
  font-size: 12px;
  line-height: 20px;
  color: var(--ap-text-placeholder);
  white-space: nowrap;
  transition: opacity 0.15s ease;
}

.aipanel-session-item:hover .aipanel-session-meta {
  opacity: 0;
}

.aipanel-session-delete-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ap-text-placeholder);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease;
}

.aipanel-session-item:hover .aipanel-session-delete-btn {
  opacity: 1;
}

/* 对齐 DS .iconButton:hover：行删除 hover 变为 label-primary 主色，不用红 */
.aipanel-session-delete-btn:hover {
  background: transparent;
  color: var(--ap-text-primary);
}

/* 状态指示共用尺寸：pending/completed 为圆点（span），ongoing 为矩阵（svg，官方 StateDot） */
.aipanel-session-state {
  position: relative;
  flex: none;
  width: 10px;
  height: 10px;
  margin-right: -2px;
}

.aipanel-session-state-pending::before,
.aipanel-session-state-completed::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.1;
}

.aipanel-session-state-pending::after,
.aipanel-session-state-completed::after {
  content: "";
  position: absolute;
  inset: 20%;
  border-radius: 50%;
  background: currentColor;
}

.aipanel-session-state-pending {
  color: var(--ap-state-pending);
}

.aipanel-session-state-completed {
  color: var(--ap-state-completed);
}

.aipanel-session-state-ongoing {
  color: var(--ap-state-ongoing);
}

.aipanel-session-ongoing-cell {
  fill: currentColor;
  opacity: 0.15;
  animation: aipanel-ongoing-chase 1s infinite;
}

@keyframes aipanel-ongoing-chase {
  0%,
  12.4% {
    opacity: 1;
  }

  12.5%,
  24.9% {
    opacity: 0.6;
  }

  25%,
  37.4% {
    opacity: 0.35;
  }

  37.5%,
  100% {
    opacity: 0.15;
  }
}

.aipanel-session-item.active .aipanel-session-state-pending {
  color: var(--ap-state-pending);
}

.aipanel-session-item.active .aipanel-session-state-completed {
  color: var(--ap-state-completed);
}

/* 当前会话的 ongoing 矩阵沿用 deepseek 蓝（提示进行中） */
.aipanel-session-item.active .aipanel-session-state-ongoing {
  color: var(--ap-accent);
}

/* Header Skeleton */
.aipanel-session-header-skeleton {
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--ap-border-faint);
  display: none;
  align-items: center;
  gap: 8px;
}

.aipanel-session-header-skeleton.visible {
  display: flex;
}

.aipanel-skeleton-header-title {
  flex: 1;
  height: 12px;
  width: 48px;
  background: var(--ap-skeleton-gradient);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 4px;
}

.aipanel-skeleton-header-btn {
  width: 24px;
  height: 24px;
  background: var(--ap-skeleton-gradient);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 50%;
}

.aipanel-session-skeleton {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: none;
}

.aipanel-session-skeleton.visible {
  display: block;
}

.aipanel-skeleton-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 2px;
  background: var(--ap-skeleton-bg);
}

.aipanel-skeleton-title {
  flex: 1 1 auto;
  height: 13px;
  background: var(--ap-skeleton-gradient);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 4px;
}

.aipanel-skeleton-meta {
  flex: none;
  width: 32px;
  height: 12px;
  background: var(--ap-skeleton-gradient);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 4px;
}

.aipanel-session-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--ap-text-tertiary);
  font-size: 12px;
}

@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
}
</style>
