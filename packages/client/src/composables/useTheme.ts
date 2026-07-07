import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import type { OpenCodeWidgetTheme } from "@vite-plugin-opencode-assistant/shared";
import { WIDGET_MSG } from "@vite-plugin-opencode-assistant/shared";

interface WidgetRef {
  sendMessageToIframe: (type: string, data?: Record<string, unknown>) => void;
}

export function useTheme(
  initialTheme: OpenCodeWidgetTheme,
  widgetRef: { value: WidgetRef | null },
) {
  const theme = ref<OpenCodeWidgetTheme>(initialTheme);

  const resolvedTheme = computed(() => {
    if (theme.value === "auto") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme.value;
  });

  const sendThemeToIframe = () => {
    widgetRef.value?.sendMessageToIframe(WIDGET_MSG.SET_THEME, {
      theme: resolvedTheme.value,
    });
  };

  let mediaQuery: MediaQueryList | null = null;

  const handleSystemThemeChange = () => {
    if (theme.value === "auto") {
      sendThemeToIframe();
    }
  };

  onMounted(() => {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", handleSystemThemeChange);

    watch(resolvedTheme, () => {
      sendThemeToIframe();
    });
  });

  onUnmounted(() => {
    if (mediaQuery) {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    }
  });

  return {
    theme,
    resolvedTheme,
    sendThemeToIframe,
  };
}
