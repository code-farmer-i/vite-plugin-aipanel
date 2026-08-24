import { ref, watch } from "vue";
import type { AIPanelSelectedElement } from "@aipanel/core";
import { SELECTED_ELEMENTS_KEY } from "@aipanel/core";

export function useSelectedElements(serviceInstanceId = "") {
  const storageKey = serviceInstanceId
    ? `${SELECTED_ELEMENTS_KEY}_${serviceInstanceId}`
    : SELECTED_ELEMENTS_KEY;
  const selectedElements = ref<AIPanelSelectedElement[]>([]);

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

  const addElement = (element: AIPanelSelectedElement) => {
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
