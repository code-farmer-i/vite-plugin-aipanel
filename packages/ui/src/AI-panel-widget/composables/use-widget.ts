import { computed, ref, onMounted, onUnmounted, type Ref } from "vue";
import type { AIPanelWidgetTheme } from "../src/types";

export interface UseWidgetOptions {
  theme: Ref<string>;
  open: Ref<boolean>;
  selectMode: Ref<boolean>;
  iframeSrc: Ref<string>;
  sessionListCollapsed: Ref<boolean>;
  onToggle: (nextOpen: boolean) => void;
  onToggleSelectMode?: (mode: boolean) => void;
  onClose: () => void;
  onToggleSessionList: (collapsed: boolean) => void;
  onEmptyAction: () => void;
  onToggleTheme?: (theme: AIPanelWidgetTheme) => void;
}

const THEME_CYCLE: AIPanelWidgetTheme[] = ["auto", "light", "dark"];

export function useWidget(options: UseWidgetOptions) {
  const systemTheme = ref<"light" | "dark">("light");

  function getSystemTheme(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  let mediaQuery: MediaQueryList | null = null;
  let handleChange: ((e: MediaQueryListEvent) => void) | null = null;

  onMounted(() => {
    if (typeof window === "undefined") return;
    systemTheme.value = getSystemTheme();
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    handleChange = (e: MediaQueryListEvent) => {
      systemTheme.value = e.matches ? "dark" : "light";
    };
    mediaQuery.addEventListener("change", handleChange);
  });

  onUnmounted(() => {
    if (mediaQuery && handleChange) {
      mediaQuery.removeEventListener("change", handleChange);
    }
  });

  const resolvedTheme = computed(() => {
    if (options.theme.value === "auto") {
      return systemTheme.value;
    }
    return options.theme.value as "light" | "dark";
  });

  const containerClasses = computed(() => [
    "aipanel-widget",
    `aipanel-theme-${resolvedTheme.value}`,
  ]);

  const buttonActive = computed(() => !!(options.open.value || options.selectMode.value));

  const iframeSource = computed(() => options.iframeSrc.value || "about:blank");

  const sessionListTitle = computed(() =>
    options.sessionListCollapsed.value ? "展开会话列表" : "折叠会话列表",
  );

  function handleToggle(): void {
    if (options.selectMode.value) {
      options.onToggleSelectMode?.(false);
      return;
    }
    const nextOpen = !options.open.value;
    options.onToggle(nextOpen);
  }

  function handleClose(): void {
    options.onClose();
  }

  function handleToggleSessionList(): void {
    options.onToggleSessionList(!options.sessionListCollapsed.value);
  }

  function handleEmptyAction(): void {
    options.onEmptyAction();
  }

  function handleToggleTheme(): void {
    const currentIndex = THEME_CYCLE.indexOf(options.theme.value as AIPanelWidgetTheme);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
    const nextTheme = THEME_CYCLE[nextIndex];
    options.onToggleTheme?.(nextTheme);
  }

  return {
    buttonActive,
    containerClasses,
    iframeSource,
    sessionListTitle,
    resolvedTheme,
    handleClose,
    handleEmptyAction,
    handleToggle,
    handleToggleSessionList,
    handleToggleTheme,
  };
}
