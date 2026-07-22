import { ref, computed, watch, onMounted, onUnmounted, type Ref } from "vue";
import type { DisplayMode, SplitModeOptions } from "@vite-plugin-opencode-assistant/shared";

export interface UseSplitModeOptions {
  displayMode: Ref<DisplayMode>;
  splitMode: Ref<SplitModeOptions | undefined>;
  open: Ref<boolean>;
  splitPosition?: Ref<"left" | "right">;
  onOpenChange?: (open: boolean) => void;
  onWidthChange?: (width: number) => void;
  onPositionChange?: (position: "left" | "right") => void;
}

const AUTO_MODE_THRESHOLD = 1440;

export function useSplitMode(options: UseSplitModeOptions) {
  const windowWidth = ref(typeof window !== "undefined" ? window.innerWidth : 0);

  const localSplitPosition = ref(options.splitPosition?.value ?? "right");

  const isExtensionMode = computed(() => options.displayMode.value === "extension");

  // extension / extension-selector 模式均不应修改 body class
  const shouldSkipBodyModification = computed(
    () => isExtensionMode.value || options.displayMode.value === "extension-selector",
  );

  const splitConfig = computed(() => {
    const config = options.splitMode.value || {};
    const isExt = isExtensionMode.value;
    return {
      width: config.width ?? 500,
      minWidth: config.minWidth ?? 400,
      maxWidth: config.maxWidth ?? 800,
      resizable: isExt ? false : (config.resizable ?? true),
      shrinkPage: isExt ? false : (config.shrinkPage ?? true),
      defaultOpen: isExt ? true : (config.defaultOpen ?? true),
      position: config.position ?? localSplitPosition.value,
    };
  });

  const panelWidth = ref(splitConfig.value.width);

  const effectiveMode = computed((): "bubble" | "split" => {
    if (isExtensionMode.value) return "split";
    if (options.displayMode.value === "bubble") {
      return "bubble";
    }
    if (options.displayMode.value === "split") {
      return "split";
    }
    return windowWidth.value >= AUTO_MODE_THRESHOLD ? "split" : "bubble";
  });

  const isSplitMode = computed(() => effectiveMode.value === "split");

  const splitPosition = computed(() => splitConfig.value.position);

  const handleResize = (width: number) => {
    panelWidth.value = width;
    options.onWidthChange?.(width);
  };

  const handleToggle = () => {
    const nextOpen = !options.open.value;
    options.onOpenChange?.(nextOpen);
  };

  const handleTogglePosition = () => {
    const nextPosition = localSplitPosition.value === "right" ? "left" : "right";
    localSplitPosition.value = nextPosition;
    options.onPositionChange?.(nextPosition);
  };

  const handleWindowResize = () => {
    if (typeof window !== "undefined") {
      windowWidth.value = window.innerWidth;
    }
  };

  const updateBodyClass = () => {
    if (typeof document === "undefined") return;
    // extension / extension-selector 模式下清理 split 遗留的 body class 后直接返回
    if (shouldSkipBodyModification.value) {
      document.body.classList.remove("has-opencode-split");
      document.body.classList.remove("has-opencode-split-left");
      document.body.classList.remove("has-opencode-split-right");
      document.body.style.removeProperty("--opencode-split-width");
      return;
    }

    const shouldShrink = isSplitMode.value && options.open.value && splitConfig.value.shrinkPage;

    if (shouldShrink) {
      document.body.classList.add("has-opencode-split");
      document.body.style.setProperty("--opencode-split-width", `${panelWidth.value}px`);
      if (splitPosition.value === "left") {
        document.body.classList.add("has-opencode-split-left");
        document.body.classList.remove("has-opencode-split-right");
      } else {
        document.body.classList.add("has-opencode-split-right");
        document.body.classList.remove("has-opencode-split-left");
      }
    } else {
      document.body.classList.remove("has-opencode-split");
      document.body.classList.remove("has-opencode-split-left");
      document.body.classList.remove("has-opencode-split-right");
      document.body.style.removeProperty("--opencode-split-width");
    }
  };

  watch([isSplitMode, options.open, panelWidth, splitPosition], updateBodyClass, {
    immediate: true,
  });

  watch(splitConfig, (config) => {
    if (panelWidth.value < config.minWidth) {
      panelWidth.value = config.minWidth;
    }
    if (panelWidth.value > config.maxWidth) {
      panelWidth.value = config.maxWidth;
    }
  });

  watch(
    () => options.splitPosition?.value,
    (val) => {
      if (val && val !== localSplitPosition.value) {
        localSplitPosition.value = val;
      }
    },
  );

  onMounted(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleWindowResize);
      if (
        !isExtensionMode.value &&
        isSplitMode.value &&
        splitConfig.value.defaultOpen &&
        !options.open.value
      ) {
        options.onOpenChange?.(true);
      }
    }
  });

  onUnmounted(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", handleWindowResize);
      // extension 模式下跳过 body class 清理
      if (!isExtensionMode.value) {
        document.body.classList.remove("has-opencode-split");
        document.body.classList.remove("has-opencode-split-left");
        document.body.classList.remove("has-opencode-split-right");
        document.body.style.removeProperty("--opencode-split-width");
      }
    }
  });

  return {
    effectiveMode,
    isSplitMode,
    isExtensionMode,
    panelWidth,
    splitConfig,
    splitPosition,
    handleResize,
    handleToggle,
    handleTogglePosition,
  };
}
