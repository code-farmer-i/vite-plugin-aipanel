/**
 * 注入页面的 Vue DevTools 数据裁剪能力。
 *
 * 桥（vue-devtools-bridge）与时间线采集器（vue-devtools-timeline）共用同一套裁剪规则，
 * 保证任何返回给 agent 的 Vue 数据都经过同样的截断/去内部字段处理。
 */

import type { InspectorState } from "@vue/devtools-kit";

// ==================== 裁剪常量 ====================

const MAX_STRING_LENGTH = 150;
const MAX_DEPTH = 3;
const MAX_KEYS = 20;

const VUE_INTERNAL_KEYS = new Set([
  "dep",
  "subs",
  "subsHead",
  "deps",
  "depsTail",
  "activeLink",
  "prevActiveLink",
  "nextDep",
  "prevDep",
  "flags",
  "globalVersion",
  "sc",
  "isSSR",
  "__v_isRef",
  "__v_isReadonly",
  "__v_skip",
  "computed",
  "effect",
  "setter",
  "fn",
]);

/**
 * 对 agent 无意义、被刻意裁掉的状态分类（省 token）。
 * 导出给工具描述做一致性守卫：描述必须显式告诉模型这些分类永远查不到，
 * 否则模型会按描述去查、再把"查不到"读成"不存在"。
 */
export const SKIP_STATE_TYPES: ReadonlySet<string> = new Set([
  "provided",
  "injected",
  "event listeners",
  "template refs",
]);

/**
 * 裁剪后出现的**值级占位记号**（导出给工具描述做一致性守卫）。
 * 不解释它们，模型会把占位读成真实值 —— 例如 `"__undefined__"` 被当成一个字符串 prop。
 * 长字符串另有一种形态：`<前缀... (N chars)>`（见 sanitizeValue）。
 */
export const SANITIZE_PLACEHOLDERS = ["__undefined__", "[Function]", "<max depth>"] as const;

// ==================== 数据裁剪 ====================

function isVueInternalObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  // Vue 组件公共实例代理：枚举其 key 会在 dev 下触发警告，直接视为内部对象
  if ((value as { __isVue?: unknown }).__isVue === true) return true;
  const keys = Object.keys(value as object);
  const internalCount = keys.filter((k) => VUE_INTERNAL_KEYS.has(k)).length;
  return internalCount > 0 && internalCount >= keys.length * 0.5;
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "<max depth>";

  // null / undefined 占位符
  if (value === null || value === "__undefined__") return null;

  // 字符串
  if (typeof value === "string") {
    if (value.startsWith("data:") || value.length > MAX_STRING_LENGTH)
      return `<${value.slice(0, 50)}... (${value.length} chars)>`;
    if (value === "[Circular Reference]" || value === "[Function]") return null;
    return value;
  }

  // 非 JSON 安全的 primitive：必须转成字符串，否则 JSON.stringify 会抛
  // （BigInt 抛 TypeError，Symbol/Function 会被静默丢弃）—— 与 safeStringify 的处理保持一致
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[Function]";

  // 基本类型
  if (typeof value !== "object") return value;

  // 数组
  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((v) => sanitizeValue(v, depth + 1));
  }

  // Vue 内部对象 → 丢弃
  if (isVueInternalObject(value)) return null;

  // 普通对象
  const result: Record<string, unknown> = {};
  const keys = Object.keys(value as object)
    .filter((k) => !k.startsWith("Symbol("))
    .slice(0, MAX_KEYS);

  for (const key of keys) {
    if (VUE_INTERNAL_KEYS.has(key)) continue;
    const v = sanitizeValue((value as Record<string, unknown>)[key], depth + 1);
    if (v !== null) result[key] = v;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** 裁剪 InspectorState[]，去掉 Vue 内部数据和噪音类型 */
export function sanitizeState(state: InspectorState[]): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const item of state) {
    if (SKIP_STATE_TYPES.has(item.type)) continue;

    if (!result[item.type]) result[item.type] = {};

    const value = sanitizeValue(item.value);
    if (value !== null) {
      result[item.type][item.key] = {
        value,
        ...(item.stateType ? { type: item.stateType } : {}),
      };
    }
  }
  return result;
}

// ==================== safeStringify ====================

export function safeStringify(obj: unknown): string {
  const seen = new WeakSet();

  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular Reference]";
      seen.add(value);
    }
    if (typeof value === "function") return "[Function]";
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "bigint") return `${value}n`;
    if (value === undefined) return "__undefined__";
    return value;
  });
}
