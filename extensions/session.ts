import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
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

  return { sessionFile };
}
