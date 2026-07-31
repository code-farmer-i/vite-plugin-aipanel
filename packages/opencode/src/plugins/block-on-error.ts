/**
 * @fileoverview LSP 错误硬阻止插件
 * @description 在 edit/write 工具执行后检查 LSP 诊断，如果有错误则回滚文件并返回失败
 */

import fs from "fs";
import path from "path";
import type { Hooks } from "@opencode-ai/plugin";
import { createLogger } from "@vite-plugin-opencode-assistant/shared/node";

const log = createLogger("BlockOnError");

/** 编辑/写入前保存的文件快照 */
interface Snapshot {
  filePath: string;
  content: string | null; // null 表示文件不存在
}

const BLOCKED_TOOLS = new Set(["edit", "write"]);
const LSP_ERROR_MARKER = "LSP errors detected";

export default {
  id: "vite-plugin-opencode-assistant/block-on-error",
  async server(): Promise<Hooks> {
    /** callID → 文件快照 */
    const snapshots = new Map<string, Snapshot>();

    return {
      "tool.execute.before": async (input, output) => {
        if (process.env.OPENCODE_BLOCK_ON_ERROR !== "1") return;
        if (!BLOCKED_TOOLS.has(input.tool)) return;

        const args = output.args as Record<string, unknown>;
        const filePath = args.filePath as string | undefined;
        if (!filePath) {
          log.debug("No filePath in tool args, skipping snapshot", { tool: input.tool });
          return;
        }

        try {
          const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
          snapshots.set(input.callID, { filePath, content });
          log.debug("Snapshot saved", {
            tool: input.tool,
            filePath,
            callID: input.callID,
            exists: content !== null,
          });
        } catch (err) {
          log.warn("Failed to save file snapshot", { filePath, error: (err as Error).message });
        }
      },

      "tool.execute.after": async (input, output) => {
        if (process.env.OPENCODE_BLOCK_ON_ERROR !== "1") return;
        if (!BLOCKED_TOOLS.has(input.tool)) return;

        const snap = snapshots.get(input.callID);
        if (!snap) {
          log.debug("No snapshot found for callID, skipping rollback check", {
            callID: input.callID,
          });
          return;
        }
        snapshots.delete(input.callID);

        // 检查 output 中是否包含 LSP 错误
        const hasErrors = output.output.includes(LSP_ERROR_MARKER);
        if (!hasErrors) {
          log.debug("No LSP errors detected, edit allowed", { filePath: snap.filePath });
          return;
        }

        // 提取错误信息
        const diagnosticsMatch = output.output.match(/<diagnostics[\s\S]*?<\/diagnostics>/);
        const errorBlock = diagnosticsMatch ? diagnosticsMatch[0] : "Unknown errors";

        // 回滚文件
        try {
          if (snap.content === null) {
            // 文件之前不存在（新建后出错），删除它
            if (fs.existsSync(snap.filePath)) {
              fs.unlinkSync(snap.filePath);
              log.info("Rolled back: deleted newly created file", { filePath: snap.filePath });
            }
          } else {
            // 恢复原始内容
            fs.writeFileSync(snap.filePath, snap.content, "utf-8");
            log.info("Rolled back: restored original file content", { filePath: snap.filePath });
          }
        } catch (err) {
          log.error("Failed to rollback file", {
            filePath: snap.filePath,
            error: (err as Error).message,
          });
        }

        // 替换 output，告知 agent 编辑被拒绝
        output.output = [
          `BLOCKED: Changes to \`${snap.filePath}\` were reverted due to errors. Fix these errors and try again.`,
          "",
          errorBlock,
        ].join("\n");
        output.title = `REJECTED: ${path.basename(snap.filePath)}`;

        log.warn("Edit blocked due to LSP errors", {
          tool: input.tool,
          filePath: snap.filePath,
          callID: input.callID,
        });
      },
    };
  },
};
