export type FloatingBubbleAxis = "x" | "y" | "xy" | "lock";

export type FloatingBubbleMagnetic = "x" | "y";

export interface FloatingBubbleOffset {
  x: number;
  y: number;
}

export interface FloatingBubbleGap {
  x: number;
  y: number;
}

export interface FloatingBubbleProps {
  offset?: FloatingBubbleOffset;
  axis?: FloatingBubbleAxis;
  magnetic?: FloatingBubbleMagnetic;
  gap?: number | FloatingBubbleGap;
  teleport?: string | Element;
}

export type FloatingBubbleEmits = {
  (e: "update:offset", value: FloatingBubbleOffset): void;
  (e: "click", event: MouseEvent): void;
  (e: "offset-change", offset: FloatingBubbleOffset): void;
  (e: "drag-start"): void;
  (e: "drag-end"): void;
};
