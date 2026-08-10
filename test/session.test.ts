import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { findChildResult, seedChildSession } from "../extensions/session.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  tempDirs.push(dir);
  return dir;
}

function messageEntry(id: string, parentId: string | null, role: "user" | "assistant", text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message:
      role === "user"
        ? { role, content: [{ type: "text", text }], timestamp: Date.now() }
        : {
            role,
            content: [{ type: "text", text }],
            api: "test",
            provider: "test",
            model: "test",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          },
  };
}

describe("seedChildSession", () => {
  it("creates a standalone session at a known path", () => {
    const sessionDir = makeTempDir();
    const seeded = seedChildSession({ cwd: "/project", sessionDir });
    const lines = readFileSync(seeded.sessionFile, "utf8").trim().split("\n");
    const header = JSON.parse(lines[0]);

    assert.equal(lines.length, 1);
    assert.equal(seeded.baselineLineCount, 1);
    assert.equal(header.type, "session");
    assert.equal(header.version, 3);
    assert.equal(header.cwd, "/project");
    assert.equal(header.parentSession, undefined);
  });

  it("copies the exact active branch into a linked fork", () => {
    const sessionDir = makeTempDir();
    const entries = [
      messageEntry("aaaaaaaa", null, "user", "question"),
      messageEntry("bbbbbbbb", "aaaaaaaa", "assistant", "parent answer"),
    ];
    const seeded = seedChildSession({
      cwd: "/project",
      sessionDir,
      parentSession: "/sessions/parent.jsonl",
      entries,
    });
    const lines = readFileSync(seeded.sessionFile, "utf8").trim().split("\n");

    assert.equal(seeded.baselineLineCount, 3);
    assert.equal(JSON.parse(lines[0]).parentSession, "/sessions/parent.jsonl");
    assert.deepEqual(lines.slice(1).map((line) => JSON.parse(line)), entries);
  });
});

describe("findChildResult", () => {
  it("ignores inherited assistant messages and returns the child's latest response", () => {
    const sessionDir = makeTempDir();
    const inherited = [messageEntry("aaaaaaaa", null, "assistant", "inherited")];
    const seeded = seedChildSession({ cwd: "/project", sessionDir, entries: inherited });

    appendFileSync(
      seeded.sessionFile,
      `${JSON.stringify(messageEntry("bbbbbbbb", "aaaaaaaa", "assistant", "first child result"))}\n`,
    );
    appendFileSync(
      seeded.sessionFile,
      `${JSON.stringify(messageEntry("cccccccc", "bbbbbbbb", "assistant", "final child result"))}\n`,
    );

    assert.equal(findChildResult(seeded.sessionFile, seeded.baselineLineCount), "final child result");
  });

  it("returns null when the child exits without a new assistant response", () => {
    const sessionDir = makeTempDir();
    const seeded = seedChildSession({ cwd: "/project", sessionDir });
    assert.equal(findChildResult(seeded.sessionFile, seeded.baselineLineCount), null);
  });
});
