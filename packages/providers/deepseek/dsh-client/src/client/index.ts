/**
 * AIPanel 浏览器侧插件（dsh Web Client bundle）
 *
 * 经 dsh 的 dsh.client 契约被 __DSH_BOOT__ 自动激活。注册 `@aipanel` 文件引用 source：
 *   - candidates 读取 bridge 写入的 localStorage('dsh.bridge.selection') —— 最近选中元素
 *   - onPick 铸造 appearance:'file' 的 ReferenceInsert（输入框高亮）
 *   - codec.serialize 决定模型最终看到的文本（让 agent 自行解析）
 *
 * 类型全部来自官方已发布包 @deepseek-ai/dsh-client-ui-input-trigger 的 /client 子路径
 * （0.1.1-rc.2，与 `npx @deepseek-ai/dsh` 运行时同线）。本包仅 esbuild 打包、不在本项目
 * typecheck，类型在 dsh Web Client 运行时解析。
 */
import type {
  InputTriggerCandidate,
  InputTriggerServiceContract,
  InputTriggerSource,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { Context } from "@deepseek-ai/cordis";

const SELECTION_STORAGE_KEY = "dsh.bridge.selection";

/** bridge 写入 localStorage 的最近选中元素 */
interface SelectedElement {
  filePath?: string;
  line?: number;
  description?: string;
  innerText?: string;
}

/** 构造 model 可见的引用文本（agent 自行解析） */
function serializeElement(ref: string): string {
  return `@AIPanel 选中元素: ${ref}`;
}

/** 把选中元素铸成候选（name=展示标签，value=不透明 pick 载荷，即 "filePath:line|selector"） */
function toCandidate(e: SelectedElement): InputTriggerCandidate {
  const line = e.line != null ? `:${e.line}` : "";
  const selector = e.description ? `|${e.description}` : "";
  const location = `${e.filePath || ""}${line}`;
  return {
    name: location,
    description: e.description || e.innerText || undefined,
    value: `${location}${selector}`,
  };
}

/** 读 bridge 写入的最近选中元素候选 */
function readSelectionCandidates(): InputTriggerCandidate[] {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return [];
    const elements = JSON.parse(raw) as SelectedElement[];
    if (!Array.isArray(elements)) return [];
    return elements
      .filter((e): e is SelectedElement => !!e && typeof e === "object")
      .slice(0, 20)
      .map(toCandidate);
  } catch {
    return [];
  }
}

export function apply(ctx: Context) {
  const inputTriggers = ctx.get("inputTriggers") as InputTriggerServiceContract | undefined;
  if (!inputTriggers) return;

  const source: InputTriggerSource = {
    trigger: "@",
    name: "aipanel",
    order: 300,
    showGroupTitle: false,

    // 候选 = 最近选中元素（bridge 写入），按输入查询过滤
    candidates: async (_session, req) => {
      const all = readSelectionCandidates();
      const query = req.query.trim().toLowerCase();
      if (!query) return all;
      return all.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.description ?? "").toLowerCase().includes(query),
      );
    },

    // 选定 → 铸造 file 引用（appearance:'file'）
    onPick: (pick) => ({
      insert: {
        source: "aipanel",
        ref: pick.candidate.value ?? pick.candidate.name,
        label: pick.candidate.name,
        appearance: "file",
        clipboardText: pick.candidate.value ?? pick.candidate.name,
      },
    }),

    // 模型投影
    codec: {
      clipboardText: (ref) => ref,
      serialize: async (ref) => serializeElement(ref),
    },
  };

  ctx.effect(() => inputTriggers.registerSource(source), "aipanel: @ source");
}
