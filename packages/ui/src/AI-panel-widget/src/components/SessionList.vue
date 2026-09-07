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
      <span id="aipanel-session-list-title">会话列表</span>
      <button
        class="aipanel-new-session-btn"
        type="button"
        title="新建会话"
        aria-label="新建会话"
        @click="handleCreateSession"
      >
        +
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
      <div
        v-if="loadingSessionList"
        class="aipanel-session-list-loading-overlay"
      >
        <div class="aipanel-loading-spinner small" />
      </div>

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
          <div class="aipanel-session-header">
            <div class="aipanel-session-title">
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
            </div>
            <button
              class="aipanel-session-delete-btn"
              type="button"
              :aria-label="`删除会话: ${item.title}`"
              @click.stop="handleDeleteSession(item)"
            >
              ×
            </button>
          </div>
          <div class="aipanel-session-meta">{{ item.meta }}</div>
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
  width: 240px;
  background: var(--ap-bg-secondary);
  border-right: 1px solid var(--ap-border-primary);
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

.aipanel-session-list-header {
  padding: 16px;
  border-bottom: 1px solid var(--ap-border-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 14px;
  color: var(--ap-text-primary);
}

.aipanel-new-session-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: var(--ap-primary);
  color: white;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.aipanel-new-session-btn:hover {
  background: var(--ap-primary-hover);
  transform: scale(1.05);
}

.aipanel-session-list-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  position: relative;
}

.aipanel-session-list-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--ap-overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 8px;
}

.aipanel-loading-spinner.small {
  width: 24px;
  height: 24px;
  border-width: 2px;
}

.aipanel-session-item {
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s;
  margin-bottom: 4px;
  color: var(--ap-text-primary);
}

.aipanel-session-item:hover {
  background: var(--ap-bg-tertiary);
}

.aipanel-session-item.active {
  background: var(--ap-primary);
  color: white;
  transition: none;
}

.aipanel-session-title {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
}

/* 标题文本独占省略容器：状态点（含 glow）不参与裁切，避免左侧被遮挡 */
.aipanel-session-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.aipanel-session-meta {
  font-size: 12px;
  opacity: 0.6;
}

.aipanel-session-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.aipanel-session-delete-btn {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--ap-text-placeholder);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  opacity: 0;
  flex-shrink: 0;
}

.aipanel-session-item:hover .aipanel-session-delete-btn {
  opacity: 1;
}

.aipanel-session-delete-btn:hover {
  background: var(--ap-danger);
  color: white;
}

.aipanel-session-item.active .aipanel-session-delete-btn {
  color: rgba(255, 255, 255, 0.7);
}

.aipanel-session-item.active .aipanel-session-delete-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.aipanel-session-header-skeleton {
  padding: 16px;
  border-bottom: 1px solid var(--ap-border-primary);
  display: none;
  justify-content: space-between;
  align-items: center;
}

.aipanel-session-header-skeleton.visible {
  display: flex;
}

.aipanel-skeleton-header-title {
  height: 18px;
  width: 80px;
  background: var(--ap-skeleton-gradient);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 4px;
}

.aipanel-skeleton-header-btn {
  width: 28px;
  height: 28px;
  background: var(--ap-skeleton-gradient);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 6px;
}

.aipanel-session-skeleton {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: none;
}

.aipanel-session-skeleton.visible {
  display: block;
}

.aipanel-skeleton-item {
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 4px;
  background: var(--ap-skeleton-bg);
}

.aipanel-skeleton-title {
  height: 16px;
  background: var(--ap-skeleton-gradient);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 4px;
  margin-bottom: 8px;
  width: 70%;
}

.aipanel-skeleton-meta {
  height: 12px;
  background: var(--ap-skeleton-gradient);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 4px;
  width: 50%;
}

.aipanel-session-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--ap-text-placeholder);
  font-size: 13px;
}

/* 状态指示共用尺寸：pending/completed 为圆点（span），ongoing 为矩阵（svg，官方 StateDot） */
.aipanel-session-state {
  position: relative;
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  margin-right: 6px;
}

/* 圆点（span）：官方 .dot —— :before 0.1 光晕，:after inset 20% 实心核（等效 10px 中 6px 点） */
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

/* ongoing 矩阵（svg）：官方 StateDot 3×3 追逐（2px 格，10px 画布），DeepSeek 蓝 */
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

/* 指示器始终用主题语义色，不随 active 行改色 */
.aipanel-session-item.active .aipanel-session-state-pending {
  color: var(--ap-state-pending);
}

.aipanel-session-item.active .aipanel-session-state-completed {
  color: var(--ap-state-completed);
}

/* active（当前会话，主色底）行的 ongoing 矩阵提亮保证对比度 */
.aipanel-session-item.active .aipanel-session-state-ongoing {
  color: rgba(255, 255, 255, 0.95);
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
