/**
 * run_diagnostics 诊断卡片视图（tool.call.toolview 的 keyed 注册）。
 *
 * host 端 dsh-plugin 通过 output.presentationMeta 把结构化诊断投影进持久化的
 * tool/result.meta；本视图从会话节点的 meta.diagnostics 读取并渲染为按严重级别
 * 着色的诊断列表（点击可打开文件），达到 opencode 诊断面板的呈现效果。
 * meta 缺失（旧日志 / 运行中 / PTC 子调度）时回退到通用文本渲染。
 *
 * 类型说明：会话节点类型与 slot owner props 均直接引用官方单一来源：
 *   - ToolCallBlock / ToolResultNode / RunningToolCall → @deepseek-ai/dsh-client-ui-conversation/client
 *   - ToolCallOwnerProps / tool.call.toolview → @deepseek-ai/dsh-client-ui-tool/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type { AIPanelDiagnosticEntry } from "@aipanel/core";
import type { ToolCallBlock, ToolResultNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ToolCallOwnerProps } from "@deepseek-ai/dsh-client-ui-tool/client";
import { useState, type ReactNode } from "react";
// 与官方 dsh-client-ui-tool 一致：primitives 作为 external 运行时解析（dsh web 提供），
// 不打包进产物（打包会带进 katex/markdown 整条子图，膨胀到 3.6MB）。
import { DisclosureRow, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";

interface DiagnosticsMeta {
  diagnostics?: unknown;
}

/** ctx.slots 的最小类型（slot 注册面；运行时由 dsh web 前端提供） */
interface SlotsRegistryLike {
  inject(key: string, callback: () => Iterable<() => void>): void;
  register(decl: { name: string; key: string }, component: unknown): () => void;
}

/** 是否为已结算的工具结果节点（官方 RunningToolCall 无 kind；ToolResultNode.kind === "tool-result"） */
function isSettledToolResult(block: ToolCallBlock): block is ToolResultNode {
  return typeof block === "object" && block !== null && "kind" in block && block.kind === "tool-result";
}

/** 从冻结的工具结果节点读取 host 侧持久化的诊断数据（校验通过才使用） */
function readDiagnostics(block: ToolCallBlock): AIPanelDiagnosticEntry[] | undefined {
  if (!isSettledToolResult(block)) return undefined;
  const meta = block.meta as DiagnosticsMeta | undefined;
  const diagnostics = meta?.diagnostics;
  if (!Array.isArray(diagnostics)) return undefined;
  return diagnostics.every(isEntry) ? (diagnostics as AIPanelDiagnosticEntry[]) : undefined;
}

/** 拼出工具结果节点里的纯文本（text blocks join "\n"） */
function extractBlockText(block: ToolCallBlock): string {
  if (!isSettledToolResult(block)) return "";
  const content = block.content as readonly unknown[];
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        typeof b === "object" &&
        b !== null &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}

function isEntry(d: unknown): d is AIPanelDiagnosticEntry {
  const e = d as AIPanelDiagnosticEntry | null;
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
  sep: {
    background: "var(--dsw-alias-label-caption)",
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
    color: "var(--dsw-alias-label-tertiary)",
    flex: "auto",
    fontSize: 12,
    lineHeight: 24,
    overflow: "hidden",
  },
  diagnostic: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "5px 0 5px 4px",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: "4px 0 4px 4px",
    padding: "8px 12px",
    borderRadius: 12,
    background: "var(--dsw-alias-markdown-code-block)",
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingBottom: 6,
    marginBottom: 4,
    borderBottom: "1px solid var(--dsw-alias-border-l1)",
  },
  cardTitle: {
    color: "var(--dsw-alias-label-primary)",
    fontWeight: 600,
    fontSize: 12,
    lineHeight: 1.4,
  },
  scopeBadge: {
    color: "var(--dsw-alias-label-secondary)",
    fontSize: 11,
    lineHeight: 1,
    padding: "3px 8px",
    borderRadius: 999,
    border: "1px solid var(--dsw-alias-border-l2)",
  },
  target: {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "none",
    padding: "0 0 4px 0",
    margin: "0 0 4px 0",
    color: "var(--dsw-alias-label-secondary)",
    fontSize: 12,
    fontFamily:
      "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)",
    cursor: "pointer",
    textDecoration: "underline",
  },
  targetText: {
    display: "block",
    padding: "0 0 4px 0",
    margin: "0 0 4px 0",
    color: "var(--dsw-alias-label-secondary)",
    fontSize: 12,
    fontFamily:
      "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)",
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
    color: "var(--dsw-alias-label-tertiary)",
    fontSize: 12,
    lineHeight: 1.4,
  },
  msg: {
    color: "var(--dsw-alias-label-primary)",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  successMsg: {
    color: "var(--dsw-alias-state-success-primary)",
    fontSize: 12,
    lineHeight: 1.6,
  },
} as const;

function DiagnosticsRow({ block, cwd, toolName, openFile }: ToolCallOwnerProps) {
  const diagnostics = readDiagnostics(block);
  const [expanded, setExpanded] = useState(false);

  const isSettled = isSettledToolResult(block);
  const hasDiagnostics = typeof diagnostics !== "undefined" && diagnostics.length > 0;
  const errors = (diagnostics ?? []).filter((d) => d.severity === "error");
  const warnings = (diagnostics ?? []).filter((d) => d.severity === "warning");

  // 从模型可见文本首行区分单文件（"诊断结果: <文件>"）与全量（"全量诊断结果"）审查
  const contentText = extractBlockText(block);
  const firstLine = (contentText.split("\n")[0] || "").trim();
  const isFullProject = /^全量诊断结果/.test(firstLine);
  const scope = isFullProject ? "project" : "file";
  const scopeLabel = isFullProject ? "全量" : "单文件";
  const cardTitle = "诊断结果";
  // 目标文件：单文件优先取结构化诊断的绝对文件（可点击），否则取标题行相对路径（仅展示）
  const titleFileMatch = /^诊断结果:\s*(.+)$/.exec(firstLine);
  const targetFile =
    scope === "file" && diagnostics && diagnostics.length > 0 ? diagnostics[0].file : null;
  const targetDisplay =
    scope === "file"
      ? targetFile
        ? relativize(targetFile, cwd)
        : titleFileMatch
          ? titleFileMatch[1].trim()
          : null
      : null;

  const errColor = "var(--dsw-alias-state-error-primary)";
  const warnColor = "var(--dsw-alias-state-warn-primary)";

  const state = !isSettled
    ? "ongoing"
    : errors.length > 0
      ? "error"
      : warnings.length > 0
        ? "warning"
        : "done";
  const expandable = isSettled;

  let collapsed: ReactNode;
  if (hasDiagnostics) {
    collapsed = (
      <>
        <span style={styles.sep} aria-hidden />
        <span style={styles.summary}>
          <span style={{ color: "var(--dsw-alias-label-tertiary)" }}>{scopeLabel}</span>
          <span aria-hidden> · </span>
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
        <span style={styles.summary}>
          <span style={{ color: "var(--dsw-alias-label-tertiary)" }}>{scopeLabel}</span>
          <span aria-hidden> · </span>
          <span style={{ color: "var(--dsw-alias-state-success-primary)" }}>未发现问题</span>
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
      keepContentWhenOpen={true}
      onToggle={() => setExpanded((v) => !v)}
      collapsedContent={collapsed}
    >
      {expandable && expanded ? (
        <div style={styles.card}>
          <div style={styles.cardHead}>
            <span style={styles.cardTitle}>{cardTitle}</span>
            <span style={styles.scopeBadge}>{scopeLabel}</span>
          </div>
          {scope === "file" && targetDisplay ? (
            targetFile && typeof openFile === "function" ? (
              <button type="button" style={styles.target} onClick={() => openFile(targetFile)}>
                {targetDisplay}
              </button>
            ) : (
              <span style={styles.targetText}>{targetDisplay}</span>
            )
          ) : null}
          {hasDiagnostics ? (
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
          ) : (
            <span style={styles.successMsg}>未发现问题</span>
          )}
        </div>
      ) : null}
    </DisclosureRow>
  );
}

/** 注册 run_diagnostics 的 keyed 工具视图（命中后替换官方 generic 卡片） */
export function registerDiagnosticsView(ctx: Context, enabled = true): void {
  // 诊断功能总开关（provider option enableDiagnostics）：关闭时不注册视图。
  if (!enabled) return;
  const slots = (ctx as unknown as { slots?: SlotsRegistryLike }).slots;
  if (!slots) return;
  slots.inject("tool.call.toolview", function* () {
    yield slots.register({ name: "tool.call.toolview", key: "run_diagnostics" }, DiagnosticsRow);
  });
}