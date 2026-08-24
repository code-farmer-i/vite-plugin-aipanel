<script setup lang="ts">
import { useAIPanelWidgetContext } from "../context";

const {
  selectedElementItems: items,
  showClearAll,
  handleClickSelectedNode,
  handleRemoveSelectedNode,
  handleClearSelectedNodes,
} = useAIPanelWidgetContext();
</script>

<template>
  <div
    class="aipanel-right-toolbar"
    :class="{ collapsed: items.length === 0 }"
  >
    <div class="aipanel-selected-nodes-header">
      <div class="aipanel-selected-nodes-title">已选节点</div>
      <div class="aipanel-selected-nodes-desc">选中的节点会在对话时一起发送给助手</div>
    </div>

    <div
      class="aipanel-selected-nodes"
      role="list"
      aria-label="已选元素列表"
    >
      <div
        v-for="(item, index) in items"
        :key="item.key"
        class="aipanel-selected-node"
        role="listitem"
        @click="handleClickSelectedNode(item)"
      >
        <div class="aipanel-node-content">
          <span class="aipanel-node-text">{{ item.description }}</span>
          <span class="aipanel-node-file">{{ item.panelFileText }}</span>
        </div>
        <button
          class="aipanel-node-remove"
          type="button"
          :aria-label="`移除元素: ${item.description}`"
          @click.stop="handleRemoveSelectedNode({ item, index, source: 'panel' })"
        >
          ×
        </button>
      </div>
    </div>

    <button
      v-if="showClearAll && items.length > 0"
      class="aipanel-clear-all-btn"
      type="button"
      aria-label="清空所有已选节点"
      @click="handleClearSelectedNodes"
    >
      一键清空
    </button>
  </div>
</template>

<style>
.aipanel-right-toolbar {
  width: 140px;
  background: var(--ap-bg-secondary);
  border-left: 1px solid var(--ap-border-primary);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.2s ease;
  overflow: hidden;
}

.aipanel-right-toolbar.collapsed {
  width: 0;
  overflow: hidden;
}

.aipanel-right-toolbar.collapsed .aipanel-selected-nodes-header,
.aipanel-right-toolbar.collapsed .aipanel-selected-nodes,
.aipanel-right-toolbar.collapsed .aipanel-clear-all-btn {
  display: none;
}

.aipanel-selected-nodes-header {
  padding: 12px 8px 8px;
  border-bottom: 1px solid var(--ap-border-primary);
}

.aipanel-selected-nodes-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ap-text-primary);
  margin-bottom: 4px;
}

.aipanel-selected-nodes-desc {
  font-size: 11px;
  color: var(--ap-text-placeholder);
  line-height: 1.4;
}

.aipanel-selected-nodes {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 6px;
  overflow-y: auto;
  overflow-x: hidden;
}

.aipanel-selected-nodes:empty::before {
  content: "暂无选中元素";
  color: var(--ap-text-placeholder);
  font-size: 12px;
  text-align: center;
  padding: 20px 10px;
}

.aipanel-selected-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--ap-bg-main);
  border: 1px solid var(--ap-border-primary);
  border-radius: 6px;
  font-size: 12px;
  transition: all 0.2s;
}

.aipanel-selected-node:hover {
  border-color: var(--ap-primary);
  box-shadow: var(--ap-shadow-primary);
}

.aipanel-node-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.aipanel-node-text {
  color: var(--ap-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aipanel-node-file {
  color: var(--ap-text-placeholder);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aipanel-node-remove {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--ap-text-placeholder);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all 0.2s;
  flex-shrink: 0;
}

.aipanel-node-remove:hover {
  background: var(--ap-danger);
  color: white;
}

.aipanel-clear-all-btn {
  width: calc(100% - 16px);
  margin: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  border: none;
  background: var(--ap-danger);
  color: white;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: all 0.2s;
}

.aipanel-clear-all-btn:hover {
  background: var(--ap-danger-hover);
  transform: scale(1.02);
}
</style>
