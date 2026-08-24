<script setup lang="ts">
import { ref, onUnmounted } from "vue";

defineOptions({
  name: "ResizeHandle",
});

const props = withDefaults(
  defineProps<{
    width?: number;
    minWidth?: number;
    maxWidth?: number;
    position?: "left" | "right";
  }>(),
  {
    width: 500,
    minWidth: 400,
    maxWidth: 800,
    position: "right",
  }
);

const emit = defineEmits<{
  (e: "resize", width: number): void;
  (e: "resize-start"): void;
  (e: "resize-end"): void;
}>();

const isResizing = ref(false);
const startX = ref(0);
const startWidth = ref(0);

const handleMouseDown = (e: MouseEvent) => {
  e.preventDefault();
  isResizing.value = true;
  startX.value = e.clientX;
  startWidth.value = props.width;
  emit("resize-start");

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
};

const handleMouseMove = (e: MouseEvent) => {
  if (!isResizing.value) return;

  let deltaX: number;
  if (props.position === "right") {
    deltaX = startX.value - e.clientX;
  } else {
    deltaX = e.clientX - startX.value;
  }

  const newWidth = Math.max(props.minWidth, Math.min(props.maxWidth, startWidth.value + deltaX));

  emit("resize", newWidth);
};

const handleMouseUp = () => {
  isResizing.value = false;
  emit("resize-end");

  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);
};

const handleDoubleClick = () => {
  emit("resize", 500);
};

onUnmounted(() => {
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);
});
</script>

<template>
  <div
    class="aipanel-resize-handle"
    :class="{ resizing: isResizing, 'handle-left': position === 'left' }"
    @mousedown="handleMouseDown"
    @dblclick="handleDoubleClick"
  />
</template>

<style>
.aipanel-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  background: transparent;
  z-index: 10;
  transition: background 0.2s ease;
}

.aipanel-resize-handle.handle-left {
  left: auto;
  right: 0;
}

.aipanel-resize-handle:hover {
  background: var(--ap-primary-bg);
}

.aipanel-resize-handle.resizing {
  background: var(--ap-primary-bg);
}

.aipanel-resize-handle::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 40px;
  background: var(--ap-border-secondary);
  border-radius: 1px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.aipanel-resize-handle.handle-left::after {
  left: auto;
  right: 2px;
}

.aipanel-resize-handle:hover::after,
.aipanel-resize-handle.resizing::after {
  opacity: 1;
}
</style>