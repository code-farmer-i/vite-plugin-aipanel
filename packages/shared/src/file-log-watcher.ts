import fs from "fs";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("FileLogReader");

export interface FileLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
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

function parseLogTimestamp(line: string): string | null {
  const timestampPatterns = [
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2})/,
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z?)/,
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/,
    /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
    /(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})/,
    /(\d{2}\/\d{2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM))/i,
    /([A-Z]{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT)/,
    /(\[([^\]]+)\])/,
  ];

  for (const pattern of timestampPatterns) {
    const match = line.match(pattern);
    if (match) {
      const timestampStr = match[1];
      const date = new Date(timestampStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  return null;
}

export async function readLogFile(
  options: LogFileOptions & {
    projectRoot?: string;
    level?: ("info" | "warn" | "error") | ("info" | "warn" | "error")[];
    limit?: number;
    since?: string;
  },
): Promise<FileLogEntry[]> {
  const { name, filePath, projectRoot, level, limit, since } = options;

  const resolvedPath = resolvePath(filePath, projectRoot);

  if (!fs.existsSync(resolvedPath)) {
    log.debug(`Log file does not exist: ${resolvedPath}`);
    return [];
  }

  try {
    const content = await fs.promises.readFile(resolvedPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const entries: FileLogEntry[] = [];
    const sinceDate = since ? new Date(since) : null;
    let lastTimestamp: string | null = null;

    for (const line of lines) {
      const parsedTimestamp = parseLogTimestamp(line);
      if (parsedTimestamp) {
        lastTimestamp = parsedTimestamp;
      }

      const entry: FileLogEntry = {
        level: detectLogLevel(line),
        message: line,
        timestamp: parsedTimestamp || lastTimestamp || new Date().toISOString(),
        source: `file:${name}`,
      };

      if (sinceDate && new Date(entry.timestamp) < sinceDate) {
        continue;
      }

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
    since?: string;
  },
): Promise<FileLogEntry[]> {
  const { name, filePath, projectRoot, lines = 200, limit, level, since } = options;

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
    const sinceDate = since ? new Date(since) : null;

    for (const line of logLines) {
      const entry: FileLogEntry = {
        level: detectLogLevel(line),
        message: line,
        timestamp: parseLogTimestamp(line) || new Date().toISOString(),
        source: `file:${name}`,
      };

      if (sinceDate && new Date(entry.timestamp) < sinceDate) {
        continue;
      }

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
