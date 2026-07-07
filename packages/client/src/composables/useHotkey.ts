import { onMounted, onUnmounted } from "vue";

interface HotkeyConfig {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseHotkey(hotkeyStr: string): HotkeyConfig {
  if (!hotkeyStr) return { ctrl: true, shift: false, alt: false, key: "k" };

  const parts = hotkeyStr.toLowerCase().split("+");
  const key = parts.pop();

  return {
    ctrl: parts.includes("ctrl") || parts.includes("meta"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key: key || "k",
  };
}

export function matchHotkey(e: KeyboardEvent, hotkeyConfig: HotkeyConfig): boolean {
  const ctrlMatch = hotkeyConfig.ctrl ? e.ctrlKey || e.metaKey : !(e.ctrlKey || e.metaKey);
  const shiftMatch = hotkeyConfig.shift ? e.shiftKey : !e.shiftKey;
  const altMatch = hotkeyConfig.alt ? e.altKey : !e.altKey;
  const keyMatch = e.key.toLowerCase() === hotkeyConfig.key.toLowerCase();

  return ctrlMatch && shiftMatch && altMatch && keyMatch;
}

export function useHotkey(hotkeyStr: string, callback: (event: KeyboardEvent) => void) {
  const hotkeyConfig = parseHotkey(hotkeyStr);

  const handleKeydown = (e: KeyboardEvent) => {
    if (matchHotkey(e, hotkeyConfig)) {
      callback(e);
    }
  };

  onMounted(() => {
    document.addEventListener("keydown", handleKeydown);
  });

  onUnmounted(() => {
    document.removeEventListener("keydown", handleKeydown);
  });

  return {
    hotkeyConfig,
  };
}
