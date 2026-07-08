import { ref, watch } from "vue";
import type { OpenCodeSelectedElement } from "@vite-plugin-opencode-assistant/shared";
import { SELECTED_ELEMENTS_KEY } from "@vite-plugin-opencode-assistant/shared";

export function useSelectedElements(serviceInstanceId = "") {
  const storageKey = serviceInstanceId
    ? `${SELECTED_ELEMENTS_KEY}_${serviceInstanceId}`
    : SELECTED_ELEMENTS_KEY;
  const selectedElements = ref<OpenCodeSelectedElement[]>([]);

  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      selectedElements.value = JSON.parse(stored);
    }
  } catch {
    // ignore
  }

  watch(
    selectedElements,
    (val) => {
      sessionStorage.setItem(storageKey, JSON.stringify(val));
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
