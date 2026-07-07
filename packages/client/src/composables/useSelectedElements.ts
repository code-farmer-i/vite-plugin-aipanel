import { ref, watch } from "vue";
import type { OpenCodeSelectedElement } from "@vite-plugin-opencode-assistant/shared";

export function useSelectedElements() {
  const selectedElements = ref<OpenCodeSelectedElement[]>([]);

  try {
    const stored = sessionStorage.getItem("__opencode_selected_elements__");
    if (stored) {
      selectedElements.value = JSON.parse(stored);
    }
  } catch {
    // ignore
  }

  watch(
    selectedElements,
    (val) => {
      sessionStorage.setItem("__opencode_selected_elements__", JSON.stringify(val));
    },
    { deep: true },
  );

  const addElement = (element: OpenCodeSelectedElement) => {
    const exists = selectedElements.value.some(
      (el) => el.filePath === element.filePath && el.line === element.line,
    );
    if (!exists) {
      selectedElements.value.push(element);
      return true;
    }
    return false;
  };

  const removeElement = (index: number) => {
    selectedElements.value.splice(index, 1);
  };

  const clearElements = () => {
    selectedElements.value = [];
  };

  return {
    selectedElements,
    addElement,
    removeElement,
    clearElements,
  };
}
