/**
 * run_diagnostics 诊断卡片视图（tool.call.toolview 的 keyed 注册）。
 *
 * host 端 dsh-plugin 通过 output.presentationMeta 把结构化诊断投影进持久化的
 * tool/result.meta；本视图从会话节点的 meta.diagnostics 读取并渲染为按严重级别
 * 着色的诊断列表（点击可打开文件），达到 opencode 诊断面板的呈现效果。
 * meta 缺失（旧日志 / 运行中 / PTC 子调度）时回退到通用文本渲染。
 *
 * 类型说明：dsh 客户端会话节点类型（ToolCallBlock / ToolResultNode）仅在新版
 * client 包发布，rc.2 生态不含其类型；这里按官方 records.ts 的运行时形状
 * 自定义最小结构（结构性兼容），不引入缺失依赖。
 */
import type { Context } from "@deepseek-ai/cordis";
import { useState, type ReactNode } from "react";
// 与官方 dsh-client-ui-tool 一致：primitives 作为 external 运行时解析（dsh web 提供），
// 不打包进产物（打包会带进 katex/markdown 整条子图，膨胀到 3.6MB）。
import { DisclosureRow, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";

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

/** 拼出工具结果节点里的纯文本（text blocks join "\n"） */
function extractBlockText(block: unknown): string {
  if (typeof block !== "object" || block === null) return "";
  const settled = block as SettledToolBlock;
  if (!Array.isArray(settled.content)) return "";
  return (settled.content ?? [])
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
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

const styles = {
  count: { color: "var(--dsw-alias-label-tertiary, #9ca3af)", fontWeight: 500, fontSize: 12 },
  sep: {
    background: "var(--dsw-alias-label-caption, #555)",
    borderRadius: 1,
    flex: "none",
    width: 2,
    height: 2,
    margin: "0 8px",
  },
  summary: {
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    color: "var(--dsw-alias-label-tertiary, #9ca3af)",
    flex: "auto",
    fontSize: 12,
    lineHeight: 24,
    overflow: "hidden",
  },
  diagnostic: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "4px 0 4px 22px",
  },
  marker: { flex: "0 0 auto", width: 14, textAlign: "center", fontSize: 12, lineHeight: 1.6 },
  diagBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  loc: {
    color: "var(--dsw-alias-label-tertiary, #9ca3af)",
    fontSize: 12,
    lineHeight: 1.4,
  },
  msg: {
    color: "var(--dsw-alias-label-primary, #f0f0f0)",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
} as const;

function DiagnosticsRow({ block, cwd, toolName }: ToolCallOwnerProps) {
  const diagnostics = readDiagnostics(block);
  const [expanded, setExpanded] = useState(false);

  const isSettled = (block as SettledToolBlock)?.kind === "tool-result";
  const hasDiagnostics = typeof diagnostics !== "undefined" && diagnostics.length > 0;
  const errors = (diagnostics ?? []).filter((d) => d.severity === "error");
  const warnings = (diagnostics ?? []).filter((d) => d.severity === "warning");

  const errColor = "var(--dsw-alias-state-error-primary, #ef4444)";
  const warnColor = "var(--dsw-alias-state-warn-primary, #f59e0b)";

  const state = !isSettled
    ? "ongoing"
    : errors.length > 0
      ? "error"
      : warnings.length > 0
        ? "warning"
        : "done";
  const expandable = hasDiagnostics;

  let collapsed: ReactNode;
  if (hasDiagnostics) {
    collapsed = (
      <>
        <span style={styles.sep} aria-hidden />
        <span style={styles.summary}>
          <span style={{ color: errColor }}>{errors.length} 错误</span> ·{" "}
          <span style={{ color: warnColor }}>{warnings.length} 警告</span>
        </span>
      </>
    );
  } else if (!isSettled) {
    collapsed = (
      <>
        <span style={styles.sep} aria-hidden />
        <span style={styles.summary}>诊断运行中…</span>
      </>
    );
  } else if (diagnostics && diagnostics.length === 0) {
    collapsed = (
      <>
        <span style={styles.sep} aria-hidden />
        <span style={{ ...styles.summary, color: "var(--dsw-alias-state-success-primary, #34d399)" }}>
          未发现问题
        </span>
      </>
    );
  } else {
    collapsed = (
      <>
        <span style={styles.sep} aria-hidden />
        <span style={styles.summary}>{extractBlockText(block) || "无输出"}</span>
      </>
    );
  }

  return (
    <DisclosureRow
      icon={<StateDot state={state} />}
      title={toolName}
      open={expanded}
      expandable={expandable}
      expandOnRowClick={expandable}
      keepContentWhenOpen={false}
      onToggle={() => setExpanded((v) => !v)}
      collapsedContent={collapsed}
    >
      {expandable && expanded && hasDiagnostics ? (
        diagnostics.map((d, i) => (
          <div key={i} style={styles.diagnostic}>
            <span
              style={{
                ...styles.marker,
                color: d.severity === "error" ? errColor : warnColor,
              }}
            >
              {d.severity === "error" ? "✖" : "⚠"}
            </span>
            <div style={styles.diagBody}>
              <span style={styles.loc}>
                {relativize(d.file, cwd)}:{d.line}:{d.column}
              </span>
              <span style={styles.msg}>{d.message}</span>
            </div>
          </div>
        ))
      ) : null}
    </DisclosureRow>
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
