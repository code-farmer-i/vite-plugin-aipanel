<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import type {
  FloatingBubbleAxis,
  FloatingBubbleMagnetic,
  FloatingBubbleOffset,
  FloatingBubbleGap,
  FloatingBubbleEmits,
} from "./types";

defineOptions({
  name: "FloatingBubble",
});

const props = withDefaults(
  defineProps<{
    offset?: FloatingBubbleOffset;
    axis?: FloatingBubbleAxis;
    magnetic?: FloatingBubbleMagnetic;
    gap?: number | FloatingBubbleGap;
    teleport?: string | Element;
  }>(),
  {
    offset: undefined,
    axis: "xy", // Vant default is y, but we use xy for free dragging
    magnetic: undefined,
    gap: 24,
    teleport: "body",
  }
);

const emit = defineEmits<FloatingBubbleEmits>();

const rootRef = ref<HTMLElement | null>(null);

const state = ref({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
});

const isObject = (val: unknown): val is FloatingBubbleGap =>
  val !== null && typeof val === "object";

const gapX = computed(() =>
  isObject(props.gap) ? props.gap.x : (props.gap as number)
);
const gapY = computed(() =>
  isObject(props.gap) ? props.gap.y : (props.gap as number)
);

const windowWidth = ref(typeof window !== "undefined" ? window.innerWidth : 0);
const windowHeight = ref(typeof window !== "undefined" ? window.innerHeight : 0);

const boundary = computed(() => ({
  top: gapY.value,
  right: windowWidth.value - state.value.width - gapX.value,
  bottom: windowHeight.value - state.value.height - gapY.value,
  left: gapX.value,
}));

const closest = (arr: number[], target: number) => {
  return arr.reduce((pre, cur) =>
    Math.abs(pre - target) < Math.abs(cur - target) ? pre : cur
  );
};

const applyMagnetic = () => {
  if (props.magnetic === "x") {
    // 如果已有吸边偏好，保持该方向
    if (magneticSide.value === 'left') {
      state.value.x = boundary.value.left;
    } else if (magneticSide.value === 'right') {
      state.value.x = boundary.value.right;
    } else {
      // 首次吸边，选择最近的边
      const nextX = closest(
        [boundary.value.left, boundary.value.right],
        state.value.x
      );
      state.value.x = nextX;
      magneticSide.value = nextX === boundary.value.left ? 'left' : 'right';
    }
  }
  if (props.magnetic === "y") {
    const nextY = closest(
      [boundary.value.top, boundary.value.bottom],
      state.value.y
    );
    state.value.y = nextY;
  }
};

const dragging = ref(false);
const initialized = ref(false);

// 记录气泡当前吸在哪一边，resize 时保持这个偏好
const magneticSide = ref<'left' | 'right' | null>(null);

const rootStyle = computed(() => {
  const style: Record<string, string | number> = {};

  const x = `${state.value.x}px`;
  const y = `${state.value.y}px`;
  style.transform = `translate3d(${x}, ${y}, 0)`;

  if (dragging.value || !initialized.value) {
    style.transition = "none";
  } else {
    style.transition = "transform 0.3s ease";
  }

  return style;
});

const updateState = () => {
  if (!rootRef.value || typeof window === "undefined") return;

  const rect = rootRef.value.getBoundingClientRect();
  const { offset } = props;

  let x = offset ? offset.x : windowWidth.value - rect.width - gapX.value;
  let y = offset ? offset.y : windowHeight.value - rect.height - gapY.value;

  const maxX = windowWidth.value - rect.width - gapX.value;
  const maxY = windowHeight.value - rect.height - gapY.value;

  if (x < gapX.value) x = gapX.value;
  if (x > maxX) x = maxX;
  if (y < gapY.value) y = gapY.value;
  if (y > maxY) y = maxY;

  const oldX = state.value.x;
  const oldY = state.value.y;

  state.value = {
    x,
    y,
    width: rect.width,
    height: rect.height,
  };

  if (!dragging.value) {
    // resize 时如果有吸边偏好，保持该方向
    if (props.magnetic === "x" && magneticSide.value) {
      if (magneticSide.value === 'left') {
        state.value.x = boundary.value.left;
      } else {
        state.value.x = boundary.value.right;
      }
    } else {
      applyMagnetic();
    }

    if (state.value.x !== oldX || state.value.y !== oldY) {
      const offset = { x: state.value.x, y: state.value.y };
      emit("update:offset", offset);
      emit("offset-change", offset);
    }
  }
};

// Inline useTouch implementation to match Vant's useTouch exactly
const touch = {
  startX: ref(0),
  startY: ref(0),
  deltaX: ref(0),
  deltaY: ref(0),
  offsetX: ref(0),
  offsetY: ref(0),
  isTap: ref(true),

  start(e: TouchEvent | MouseEvent) {
    this.startX.value = "touches" in e ? e.touches[0].clientX : e.clientX;
    this.startY.value = "touches" in e ? e.touches[0].clientY : e.clientY;
    this.deltaX.value = 0;
    this.deltaY.value = 0;
    this.offsetX.value = 0;
    this.offsetY.value = 0;
    this.isTap.value = true;
  },

  move(e: TouchEvent | MouseEvent) {
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    this.deltaX.value = clientX - this.startX.value;
    this.deltaY.value = clientY - this.startY.value;
    this.offsetX.value = Math.abs(this.deltaX.value);
    this.offsetY.value = Math.abs(this.deltaY.value);

    const TAP_OFFSET = 5;
    if (this.isTap.value && (this.offsetX.value > TAP_OFFSET || this.offsetY.value > TAP_OFFSET)) {
      this.isTap.value = false;
    }
  }
};

let prevX = 0;
let prevY = 0;

const onTouchStart = (e: TouchEvent | MouseEvent) => {
  touch.start(e);
  dragging.value = true;
  prevX = state.value.x;
  prevY = state.value.y;

  document.body.classList.add('floating-bubble-dragging');

  if (!("touches" in e)) {
    window.addEventListener("mousemove", onTouchMove, { passive: false });
    window.addEventListener("mouseup", onTouchEnd);
  }
};

const onTouchMove = (e: TouchEvent | MouseEvent) => {
  if (e.cancelable) {
    e.preventDefault();
  }

  const wasTap = touch.isTap.value;
  touch.move(e);

  if (wasTap && !touch.isTap.value) {
    emit("drag-start");
  }

  if (props.axis === "lock") return;

  if (!touch.isTap.value) {
    if (props.axis === "x" || props.axis === "xy") {
      let nextX = prevX + touch.deltaX.value;
      if (nextX < boundary.value.left) nextX = boundary.value.left;
      if (nextX > boundary.value.right) nextX = boundary.value.right;
      state.value.x = nextX;
    }

    if (props.axis === "y" || props.axis === "xy") {
      let nextY = prevY + touch.deltaY.value;
      if (nextY < boundary.value.top) nextY = boundary.value.top;
      if (nextY > boundary.value.bottom) nextY = boundary.value.bottom;
      state.value.y = nextY;
    }

    const offset = { x: state.value.x, y: state.value.y };
    emit("update:offset", offset);
  }
};

const onTouchEnd = (e?: TouchEvent | MouseEvent) => {
  dragging.value = false;

  document.body.classList.remove('floating-bubble-dragging');

  if (e && !("touches" in e) && e.type === "mouseup") {
    window.removeEventListener("mousemove", onTouchMove);
    window.removeEventListener("mouseup", onTouchEnd);
  }

  requestAnimationFrame(() => {
    // 拖拽结束时，根据当前位置决定吸边方向偏好
    if (props.magnetic === "x" && !touch.isTap.value) {
      const centerX = state.value.x + state.value.width / 2;
      const windowCenterX = windowWidth.value / 2;
      magneticSide.value = centerX < windowCenterX ? 'left' : 'right';
    }

    applyMagnetic();

    if (!touch.isTap.value) {
      emit("drag-end");
      const offset = { x: state.value.x, y: state.value.y };
      emit("update:offset", offset);
      if (prevX !== offset.x || prevY !== offset.y) {
        emit("offset-change", offset);
      }
    }
  });
};

const onClick = (e: MouseEvent) => {
  if (touch.isTap.value) {
    emit("click", e);
  } else {
    e.stopPropagation();
  }
};

const handleResize = () => {
  if (typeof window !== "undefined") {
    windowWidth.value = window.innerWidth;
    windowHeight.value = window.innerHeight;
    // Removed direct updateState() here, handled by watch
  }
};

onMounted(() => {
  updateState();
  requestAnimationFrame(() => {
    initialized.value = true;
  });

  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleResize);
  }

  if (rootRef.value) {
    rootRef.value.addEventListener("touchmove", onTouchMove as EventListener, {
      passive: false,
    });
  }
});

onUnmounted(() => {
  document.body.classList.remove('floating-bubble-dragging');
  
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("mousemove", onTouchMove as EventListener);
    window.removeEventListener("mouseup", onTouchEnd as EventListener);
  }
  if (rootRef.value) {
    rootRef.value.removeEventListener("touchmove", onTouchMove as EventListener);
  }
});

watch(
  [windowWidth, windowHeight, gapX, gapY],
  updateState,
);

watch(
  () => props.offset,
  (newOffset) => {
    // offset prop 变化时（如状态恢复），重置磁性吸附偏好，
    // 让位置由外部传入的 offset 决定，而非之前拖拽形成的偏好
    if (newOffset) {
      magneticSide.value = null;
    }
    updateState();
  },
  { deep: true }
);

defineExpose({
  offset: computed(() => ({ x: state.value.x, y: state.value.y })),
});
</script>

<template>
  <Teleport :to="teleport">
    <div
      ref="rootRef"
      class="floating-bubble"
      :style="rootStyle"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
      @mousedown="onTouchStart"
      @click.capture="onClick"
    >
      <slot></slot>
    </div>
  </Teleport>
</template>

<style>
.floating-bubble {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 999999;
  cursor: grab;
  user-select: none;
  touch-action: none;
  will-change: transform;
}

.floating-bubble:active {
  cursor: grabbing;
}

body.floating-bubble-dragging * {
  pointer-events: none !important;
}

body.floating-bubble-dragging .floating-bubble,
body.floating-bubble-dragging .floating-bubble * {
  pointer-events: auto !important;
}
</style>
