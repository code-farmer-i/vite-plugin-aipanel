<script setup lang="ts">
import { ref, onMounted, watch } from "vue";

import type { AIPanelSelectedElement, DisplayMode, SplitModeOptions } from "../src/types";

const open = ref(false);
const loading = ref(true);
const selectMode = ref(false);
const theme = ref<"light" | "dark" | "auto">("auto");
const currentSessionId = ref<string | null>(null);
const sessionListCollapsed = ref(true);
const sessions = ref<{ id: string; title: string; updatedAt: number; }[]>([]);
const selectedElements = ref<AIPanelSelectedElement[]>([]);
const thinking = ref(false);
const displayMode = ref<DisplayMode>("bubble");
const splitPanelWidth = ref(500);
const splitMode = ref<SplitModeOptions>({
  width: 500,
  minWidth: 400,
  maxWidth: 800,
  resizable: true,
  shrinkPage: true,
  defaultOpen: true,
});

onMounted(() => {
  setTimeout(() => {
    sessions.value = [
      { id: "1", title: "如何使用 Vue 3 的 Composition API？", updatedAt: Date.now() },
      { id: "2", title: "解释一下这段代码的含义", updatedAt: Date.now() - 86400000 },
      { id: "3", title: "优化这段代码的性能", updatedAt: Date.now() - 172800000 },
    ];
    currentSessionId.value = "1";

    selectedElements.value = [
      {
        description: "span.text",
        filePath: "/Users/test/basic.vue",
        line: 4,
        column: 14,
        innerText: "ref(false)",
      },
    ];

    loading.value = false;
  }, 1500);
});

const handleUpdateOpen = (val: boolean) => {
  open.value = val;
};

const handleToggleSelectMode = (val: boolean) => {
  selectMode.value = val;
};

const handleSelectSession = (session: { id: string; }) => {
  loading.value = true;
  setTimeout(() => {
    currentSessionId.value = session.id;
    loading.value = false;
  }, 500);
};

const handleDeleteSession = (session: { id: string; }) => {
  loading.value = true;
  setTimeout(() => {
    sessions.value = sessions.value.filter((s) => s.id !== session.id);
    if (currentSessionId.value === session.id && sessions.value.length > 0) {
      currentSessionId.value = sessions.value[0].id;
    }
    loading.value = false;
  }, 500);
};

const handleCreateSession = () => {
  loading.value = true;
  setTimeout(() => {
    const id = Date.now().toString();
    sessions.value.unshift({
      id,
      title: "新会话",
      updatedAt: Date.now(),
    });
    currentSessionId.value = id;
    loading.value = false;
  }, 500);
};

const handleClickSelectedNode = (element: AIPanelSelectedElement) => {
  const exists = selectedElements.value.find(
    (e) =>
      e.filePath === element.filePath && e.line === element.line && e.column === element.column,
  );
  if (!exists) {
    selectedElements.value.push(element);
  }
};

const handleRemoveSelectedNode = (payload: {
  element: AIPanelSelectedElement;
  index: number;
  source: "bubble" | "panel";
}) => {
  selectedElements.value = selectedElements.value.filter(
    (e) =>
      !(
        e.filePath === payload.element.filePath &&
        e.line === payload.element.line &&
        e.column === payload.element.column
      ),
  );
};

const handleClearSelectedNodes = () => {
  selectedElements.value = [];
};

const handleEmptyAction = () => {
  handleCreateSession();
};

const handleToggleThinking = () => {
  thinking.value = !thinking.value;
};

const handleToggleDisplayMode = () => {
  const modes: DisplayMode[] = ["bubble", "split", "auto"];
  const currentIndex = modes.indexOf(displayMode.value);
  displayMode.value = modes[(currentIndex + 1) % modes.length];
};

const handleSplitPanelWidthChange = (val: number) => {
  splitPanelWidth.value = val;
};

watch(theme, (newVal) => {
  console.log("主题切换为:", newVal);
});

watch(displayMode, (newVal) => {
  console.log("展示模式切换为:", newVal);
});
</script>

<template>
  <div
    class="demo-container"
    :class="[theme === 'dark' ? 'demo-dark' : '']"
  >
    <div class="controls">
      <div class="control-group">
        <h4>基本操作</h4>
        <button @click="open = !open">
          切换挂件 (当前: {{ open ? "打开" : "关闭" }})
        </button>
        <button @click="selectMode = !selectMode">
          切换选择模式 (当前: {{ selectMode ? "开启" : "关闭" }})
        </button>
        <button @click="theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light'">
          切换主题 (当前: {{ theme }})
        </button>
        <button @click="loading = !loading">
          切换加载状态 (当前: {{ loading ? "加载中" : "空闲" }})
        </button>
        <button @click="handleToggleThinking">
          切换思考状态 (当前: {{ thinking ? "思考中" : "空闲" }})
        </button>
      </div>

      <div class="control-group">
        <h4>展示模式</h4>
        <button @click="handleToggleDisplayMode">
          切换展示模式 (当前: {{ displayMode }})
        </button>
        <button @click="splitPanelWidth = splitPanelWidth - 50">
          减小面板宽度 (当前: {{ splitPanelWidth }}px)
        </button>
        <button @click="splitPanelWidth = splitPanelWidth + 50">
          增大面板宽度 (当前: {{ splitPanelWidth }}px)
        </button>
      </div>

      <div class="control-group">
        <h4>会话管理</h4>
        <button @click="sessionListCollapsed = !sessionListCollapsed">
          切换会话列表 (当前: {{ sessionListCollapsed ? "折叠" : "展开" }})
        </button>
        <button @click="handleCreateSession">创建新会话</button>
        <button @click="handleClearSelectedNodes">清空已选节点</button>
      </div>

      <div class="control-group">
        <h4>状态演示</h4>
        <button @click="sessions = []">显示空状态</button>
        <button @click="sessions = [{ id: '1', title: '测试会话', updatedAt: Date.now() }]">
          恢复会话
        </button>
      </div>
    </div>

    <div class="widget-wrapper">
      <aipanel-widget
        :open="open"
        :loading="loading"
        :theme="theme"
        :select-mode="selectMode"
        :session-list-collapsed="sessionListCollapsed"
        :sessions="sessions"
        :current-session-id="currentSessionId"
        :selected-elements="selectedElements"
        :show-empty-state="sessions.length === 0"
        :thinking="thinking"
        :display-mode="displayMode"
        :split-mode="splitMode"
        :split-panel-width="splitPanelWidth"
        title="Trae AI"
        iframe-src="about:blank"
        @update:open="handleUpdateOpen"
        @toggle-select-mode="handleToggleSelectMode"
        @select-session="handleSelectSession"
        @delete-session="handleDeleteSession"
        @create-session="handleCreateSession"
        @click-selected-node="handleClickSelectedNode"
        @remove-selected-node="handleRemoveSelectedNode"
        @clear-selected-nodes="handleClearSelectedNodes"
        @empty-action="handleEmptyAction"
        @update:split-panel-width="handleSplitPanelWidthChange"
      />
    </div>

    <div class="demo-info">
      <h3>场景演示说明</h3>
      <ul>
        <li><strong>基本操作:</strong> 测试挂件的打开/关闭、选择模式、主题切换、加载状态</li>
        <li><strong>展示模式:</strong> 切换气泡模式(bubble)、分屏模式(split)、自动模式(auto)</li>
        <li><strong>会话管理:</strong> 测试会话列表的折叠/展开、创建新会话、清空已选节点</li>
        <li><strong>状态演示:</strong> 测试空状态和正常状态的切换</li>
        <li><strong>拖拽功能:</strong> 气泡按钮支持自由拖拽，松手后自动磁吸到屏幕边缘</li>
        <li><strong>分屏模式:</strong> 面板固定在右侧，支持拖拽调整宽度，主页面自动收缩</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.demo-container {
  height: 600px;
  position: relative;
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s;
}

.demo-dark {
  background: #141414;
  border-color: #333;
}

.demo-dark button {
  background: #2a2a2a;
  border-color: #444;
  color: #e0e0e0;
}

.demo-dark button:hover {
  background: #333;
  border-color: #1890ff;
  color: #1890ff;
}

.demo-dark .control-group h4 {
  color: #e0e0e0;
}

.controls {
  padding: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}

.control-group {
  flex: 1;
  min-width: 200px;
}

.control-group h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.control-group button {
  margin-right: 8px;
  margin-bottom: 8px;
}

button {
  padding: 8px 12px;
  cursor: pointer;
  background: #fff;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  font-size: 13px;
  transition: all 0.2s;
}

button:hover {
  background: #f0f0f0;
  border-color: #1890ff;
  color: #1890ff;
}

.demo-info {
  padding: 16px;
  border-top: 1px solid #e0e0e0;
  margin-top: 16px;
}

.demo-info h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
}

.demo-info ul {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: #666;
}

.demo-info li {
  margin-bottom: 6px;
}

.widget-wrapper {
  position: absolute;
  width: 100%;
  height: 100%;
}
</style>
