/**
 * run_diagnostics 诊断卡片视图（tool.call.toolview 的 keyed 注册）。
 *
 * host 端 dsh-plugin 通过 output.presentationMeta 把结构化诊断投影进持久化的
 * tool/result.meta；本视图从会话节点的 meta.diagnostics 读取并渲染为按严重级别
 * 着色的诊断列表（点击可打开文件），达到 opencode 诊断面板的呈现效果。
 * meta 缺失（旧日志 / 运行中）时回退到通用文本渲染。
 *
 * 类型说明：dsh 客户端会话节点类型（ToolCallBlock / ToolResultNode）仅在新版
 * client 包发布，rc.2 生态不含其类型；这里按官方 records.ts 的运行时形状
 * 自定义最小结构（结构性兼容），不引入缺失依赖。
 */
import type { Context } from "@deepseek-ai/cordis";

/** 与 host 端 dsh-plugin presentationMeta 持久化的条目结构一致 */
interface DiagnosticEntry {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
}

interface DiagnosticsMeta {
  diagnostics?: unknown;
}

/** 已结算工具节点的最小结构（对应官方 ToolResultNode 的运行时形状） */
interface SettledToolBlock {
  kind: "tool-result";
  callId: string;
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
  meta?: unknown;
}

/** tool.call.toolview 的 owner props（官方 ToolCallOwnerProps 的结构子集） */
interface ToolCallOwnerProps {
  callId: string;
  toolName: string;
  block: SettledToolBlock | { callId: string; argsRaw?: string };
  cwd?: string;
  home?: string;
  openFile: (path: string) => void;
  inspect?: () => void;
}

/** ctx.slots 的最小类型（slot 注册面；运行时由 dsh web 前端提供） */
interface SlotsRegistryLike {
  inject(key: string, callback: () => Iterable<() => void>): void;
  register(decl: { name: string; key: string }, component: unknown): () => void;
}

/** bridge 按 provider option enableDiagnostics 写入的开关标记（与 provider constants 的 DSH_STORAGE_KEYS 对应） */
const DIAGNOSTICS_STORAGE_KEY = "dsh.bridge.diagnostics.enabled";

const ERROR_COLOR = "#f87171";
const WARN_COLOR = "#fbbf24";
const TEXT_COLOR = "#9ca3af";
const HEAD_COLOR = "#e5e7eb";

/** 从冻结的会话节点读取 host 侧持久化的诊断数据（校验通过才使用） */
function readDiagnostics(block: unknown): DiagnosticEntry[] | undefined {
  if (typeof block !== "object" || block === null) return undefined;
  const settled = block as SettledToolBlock;
  if (settled.kind !== "tool-result") return undefined;
  const meta = settled.meta as DiagnosticsMeta | undefined;
  const diagnostics = meta?.diagnostics;
  if (!Array.isArray(diagnostics)) return undefined;
  return diagnostics.every(isEntry) ? (diagnostics as DiagnosticEntry[]) : undefined;
}

function isEntry(d: unknown): d is DiagnosticEntry {
  const e = d as DiagnosticEntry | null;
  return (
    !!e &&
    typeof e.file === "string" &&
    typeof e.line === "number" &&
    typeof e.column === "number" &&
    (e.severity === "error" || e.severity === "warning") &&
    typeof e.message === "string"
  );
}

/** 展示用：剥离工作区根前缀 */
function relativize(path: string, cwd?: string): string {
  if (!cwd) return path;
  const root = cwd.replace(/[/\\]+$/, "");
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
    return path.slice(root.length + 1);
  }
  return path;
}

/** 回退渲染：无结构化 meta 时展示工具结果的原始文本 */
function RawResult({ block }: { block: unknown }) {
  const settled = block as SettledToolBlock;
  if (settled.kind !== "tool-result") {
    return <div style={styles.card}>诊断运行中…</div>;
  }
  const text = (settled.content ?? [])
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return (
    <div style={styles.card}>
      <pre style={styles.pre}>{text || "(无输出)"}</pre>
    </div>
  );
}

const styles = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: "nowrap",
    overflowX: "auto",
  },
  header: { fontWeight: 600, color: HEAD_COLOR },
  count: { color: TEXT_COLOR, fontWeight: 400, marginLeft: 6 },
  row: { display: "flex", alignItems: "baseline", gap: 6, cursor: "pointer" },
  marker: { flex: "none" },
  loc: { flex: "none", color: TEXT_COLOR },
  msg: { color: HEAD_COLOR },
  pre: { margin: 0, whiteSpace: "pre-wrap", color: HEAD_COLOR, font: "inherit" },
} as const;

function DiagnosticsRow({ block, cwd, openFile }: ToolCallOwnerProps) {
  const diagnostics = readDiagnostics(block);
  if (diagnostics === undefined) return <RawResult block={block} />;

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  if (diagnostics.length === 0) {
    return (
      <div style={styles.card}>
        <div style={styles.header}>✓ 未发现问题</div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        诊断结果
        <span style={styles.count}>
          {errors.length} 错误 · {warnings.length} 警告
        </span>
      </div>
      {diagnostics.map((d, i) => (
        <div
          key={i}
          style={styles.row}
          title={d.message}
          onClick={() => d.file && openFile(d.file)}
        >
          <span
            style={{
              ...styles.marker,
              color: d.severity === "error" ? ERROR_COLOR : WARN_COLOR,
            }}
          >
            {d.severity === "error" ? "✖" : "⚠"}
          </span>
          <span style={styles.loc}>
            {relativize(d.file, cwd)}:{d.line}:{d.column}
          </span>
          <span style={styles.msg}>{d.message}</span>
        </div>
      ))}
    </div>
  );
}

/** 注册 run_diagnostics 的 keyed 工具视图（命中后替换官方 generic 卡片） */
export function registerDiagnosticsView(ctx: Context): void {
  // 诊断功能未开启（bridge 未写入标记）时不注册视图，避免注入无用的渲染逻辑
  try {
    if (localStorage.getItem(DIAGNOSTICS_STORAGE_KEY) !== "1") return;
  } catch {
    return;
  }
  const slots = (ctx as unknown as { slots?: SlotsRegistryLike }).slots;
  if (!slots) return;
  slots.inject("tool.call.toolview", function* () {
    yield slots.register({ name: "tool.call.toolview", key: "run_diagnostics" }, DiagnosticsRow);
  });
}
