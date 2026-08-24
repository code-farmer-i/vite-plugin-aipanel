<script setup lang="ts">
import { useAIPanelWidgetContext } from "../context";

const {
  bubbleVisible: visible,
  selectedElementItems: items,
  handleClickSelectedNode,
  handleRemoveSelectedNode,
} = useAIPanelWidgetContext();
</script>

<template>
  <div
    class="aipanel-selected-bubbles"
    :class="{ visible }"
    role="list"
    aria-label="已选元素列表"
  >
    <div
      v-if="items.length === 0"
      class="aipanel-bubble-empty"
    >暂无选中元素</div>

    <div
      v-for="(item, index) in items"
      v-else
      :key="item.key"
      class="aipanel-selected-bubble"
      role="listitem"
      @click="handleClickSelectedNode(item)"
    >
      <span class="aipanel-bubble-text">{{ item.description }}</span>
      <span
        v-if="item.bubbleFileText"
        class="aipanel-bubble-file"
      >
        {{ item.bubbleFileText }}
      </span>
      <button
        class="aipanel-bubble-remove"
        type="button"
        :aria-label="`移除元素: ${item.description}`"
        @click.stop="handleRemoveSelectedNode({ item, index, source: 'bubble' })"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style>
.aipanel-selected-bubbles {
  position: absolute;
  display: none;
  flex-direction: column;
  gap: 6px;
  max-width: 220px;
  max-height: 300px;
  overflow-y: auto;
}

.aipanel-selected-bubbles.visible {
  display: flex;
}

.aipanel-selected-bubble {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 24px 8px 10px;
  /* 增加右侧 padding 避免文字被关闭按钮覆盖 */
  background: var(--ap-bg-main);
  border: 1px solid var(--ap-border-primary);
  border-radius: 8px;
  font-size: 12px;
  box-shadow: var(--ap-shadow-sm);
  position: relative;
  cursor: pointer;
  transition: all 0.2s;
}

.aipanel-selected-bubble:hover {
  border-color: var(--ap-primary);
  box-shadow: var(--ap-shadow-primary);
}

.aipanel-bubble-text {
  color: var(--ap-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aipanel-bubble-file {
  color: var(--ap-text-placeholder);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aipanel-bubble-remove {
  position: absolute;
  top: 8px;
  /* 稍微下移，使其垂直居中更自然 */
  right: 6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--ap-text-placeholder);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: all 0.2s;
}

.aipanel-bubble-remove:hover {
  background: var(--ap-danger);
  color: white;
}

.aipanel-bubble-empty {
  padding: 8px 12px;
  background: var(--ap-bg-main);
  border: 1px dashed var(--ap-border-secondary);
  border-radius: 8px;
  color: var(--ap-text-placeholder);
  font-size: 12px;
  text-align: center;
}
</style>
