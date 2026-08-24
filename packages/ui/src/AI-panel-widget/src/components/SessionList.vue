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

// 判断指定 session 是否正在思考
function isSessionThinking(sessionId: string): boolean {
  if (!sessionStates?.value || !sessionId) return false;
  return sessionStates.value[sessionId]?.thinking ?? false;
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
          :class="{ active: item.active, thinking: isSessionThinking(item.id) }"
          role="option"
          :aria-selected="item.active"
          @click="handleSelectSession(item)"
        >
          <div class="aipanel-session-header">
            <div class="aipanel-session-title">
              <span
                v-if="isSessionThinking(item.id)"
                class="aipanel-thinking-loading"
              />
              {{ item.title }}
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
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Thinking loading icon - 黑白灰配色 */
.aipanel-thinking-loading {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  border: 2px solid var(--ap-border-secondary);
  border-top-color: var(--ap-text-secondary);
  border-radius: 50%;
  animation: thinking-spin 0.8s linear infinite;
  vertical-align: middle;
}

/* 激活状态下 loading 颜色 */
.aipanel-session-item.active .aipanel-thinking-loading {
  border-color: rgba(255, 255, 255, 0.3);
  border-top-color: rgba(255, 255, 255, 0.9);
}

@keyframes thinking-spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
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
