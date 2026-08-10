import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface SeedChildSessionOptions {
  cwd: string;
  sessionDir: string;
  parentSession?: string;
  entries?: readonly SessionEntry[];
}

export interface SeededChildSession {
  sessionFile: string;
  baselineLineCount: number;
}

function sessionTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Create the child's session at a known path before Pi starts.
 *
 * Forks copy the parent's active branch objects without rewriting message content.
 * Keeping that prefix byte-for-byte equivalent at the object level is important for
 * provider prompt-cache reuse.
 */
export function seedChildSession(options: SeedChildSessionOptions): SeededChildSession {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const sessionFile = join(options.sessionDir, `${sessionTimestamp(new Date(timestamp))}_${id}.jsonl`);
  const entries = options.entries ?? [];
  const header = {
    type: "session" as const,
    version: 3,
    id,
    timestamp,
    cwd: options.cwd,
    ...(options.parentSession ? { parentSession: options.parentSession } : {}),
  };

  mkdirSync(options.sessionDir, { recursive: true });
  const lines = [JSON.stringify(header), ...entries.map((entry) => JSON.stringify(entry))];
  writeFileSync(sessionFile, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });

  return { sessionFile, baselineLineCount: lines.length };
}

interface SessionLine {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
}

function textFromAssistant(line: SessionLine): string | null {
  const message = line.message;
  if (line.type !== "message" || message?.role !== "assistant") return null;

  if (Array.isArray(message.content)) {
    const text = message.content
      .filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text) return text;
  }

  if (message.stopReason === "error" && message.errorMessage?.trim()) {
    return `Sub-agent error: ${message.errorMessage.trim()}`;
  }

  return null;
}

/** Return only assistant output produced after the child was seeded. */
export function findChildResult(sessionFile: string, baselineLineCount: number): string | null {
  const lines = readFileSync(sessionFile, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .slice(baselineLineCount);

  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const text = textFromAssistant(JSON.parse(lines[index]) as SessionLine);
      if (text) return text;
    } catch {
      // Ignore a partially written or malformed line and keep looking backward.
    }
  }
  return null;
}
