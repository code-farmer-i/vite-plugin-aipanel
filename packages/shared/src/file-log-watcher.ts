import fs from "fs";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("FileLogReader");

export interface FileLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  source: string;
}

export interface LogFileOptions {
  name: string;
  filePath: string;
}

function detectLogLevel(line: string): "info" | "warn" | "error" {
  const lowerLine = line.toLowerCase();

  if (lowerLine.includes("error") || lowerLine.includes("err") || lowerLine.includes("fatal")) {
    return "error";
  }

  if (lowerLine.includes("warn") || lowerLine.includes("warning")) {
    return "warn";
  }

  return "info";
}

export async function readLogFile(
  options: LogFileOptions & {
    projectRoot?: string;
    level?: ("info" | "warn" | "error") | ("info" | "warn" | "error")[];
    limit?: number;
  },
): Promise<FileLogEntry[]> {
  const { name, filePath, projectRoot, level, limit } = options;

  const resolvedPath = resolvePath(filePath, projectRoot);

  if (!fs.existsSync(resolvedPath)) {
    log.debug(`Log file does not exist: ${resolvedPath}`);
    return [];
  }

  try {
    const content = await fs.promises.readFile(resolvedPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const entries: FileLogEntry[] = [];

    for (const line of lines) {
      const entry: FileLogEntry = {
        level: detectLogLevel(line),
        message: line,
        source: `file:${name}`,
      };

      if (level) {
        const levels = Array.isArray(level) ? level : [level];
        if (!levels.includes(entry.level)) {
          continue;
        }
      }

      entries.push(entry);
    }

    if (limit && limit > 0) {
      return entries.slice(-limit);
    }

    return entries;
  } catch (err) {
    log.error(`Error reading log file ${resolvedPath}`, { error: err });
    return [];
  }
}

export async function readLogFileTail(
  options: LogFileOptions & {
    projectRoot?: string;
    lines?: number;
    limit?: number;
    level?: ("info" | "warn" | "error") | ("info" | "warn" | "error")[];
  },
): Promise<FileLogEntry[]> {
  const { name, filePath, projectRoot, lines = 200, limit, level } = options;

  const resolvedPath = resolvePath(filePath, projectRoot);

  if (!fs.existsSync(resolvedPath)) {
    log.debug(`Log file does not exist: ${resolvedPath}`);
    return [];
  }

  try {
    const stat = fs.statSync(resolvedPath);
    const fd = fs.openSync(resolvedPath, "r");

    const chunkSize = 16 * 1024;
    let position = stat.size;
    let buffer = Buffer.alloc(0);
    const lineCount = 0;

    while (position > 0 && lineCount <= lines) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;

      const chunk = Buffer.alloc(readSize);
      fs.readSync(fd, chunk, 0, readSize, position);

      buffer = Buffer.concat([chunk, buffer]);

      const newLineCount = buffer.filter((byte) => byte === 10).length;
      if (newLineCount >= lines) {
        const linesArray = buffer.toString("utf-8").split("\n");
        const excessLines = newLineCount - lines;
        let charsToRemove = 0;
        let count = 0;
        for (let i = 0; i < linesArray.length; i++) {
          count += linesArray[i].length + 1;
          if (count > excessLines) {
            charsToRemove = linesArray.slice(0, i + 1).join("\n").length + 1;
            break;
          }
        }
        buffer = buffer.slice(charsToRemove);
        break;
      }
    }

    fs.closeSync(fd);

    const content = buffer.toString("utf-8").trim();
    const logLines = content.split("\n").filter((line) => line.trim());

    const entries: FileLogEntry[] = [];

    for (const line of logLines) {
      const entry: FileLogEntry = {
        level: detectLogLevel(line),
        message: line,
        source: `file:${name}`,
      };

      if (level) {
        const levels = Array.isArray(level) ? level : [level];
        if (!levels.includes(entry.level)) {
          continue;
        }
      }

      entries.push(entry);
    }

    if (limit && limit > 0) {
      return entries.slice(-limit);
    }

    return entries;
  } catch (err) {
    log.error(`Error reading log file ${resolvedPath}`, { error: err });
    return [];
  }
}

function resolvePath(filePath: string, projectRoot?: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  if (projectRoot) {
    return path.resolve(projectRoot, filePath);
  }

  return path.resolve(process.cwd(), filePath);
}
