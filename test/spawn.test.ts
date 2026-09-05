import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";

describe("Herdr command integration", () => {
  let dir: string;
  let originalPane: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-subagents-spawn-"));
    originalPane = process.env.HERDR_PANE_ID;
    process.env.HERDR_PANE_ID = "w1:p1";
  });
  afterEach(() => {
    if (originalPane === undefined) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = originalPane;
    rmSync(dir, { recursive: true, force: true });
  });

  function setup(failStart = false) {
    const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
    const calls: string[][] = [];
    const notifications: { message: string; level: string }[] = [];
    let idleWaited = false;
    const entries = [{
      type: "message", id: "aaaaaaaa", parentId: null, timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: "parent context", timestamp: 0 },
    }];
    const pi = {
      registerCommand(name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) {
        commands.set(name, command);
      },
      getActiveTools: () => ["read", "bash"],
      getThinkingLevel: () => "off",
      async exec(_command: string, args: string[]) {
        assert.equal(idleWaited, true);
        calls.push(args);
        return {
          stdout: args[0] === "pane" ? '{"result":{"pane":{"pane_id":"w1:p2"}}}' : "{}",
          stderr: failStart && args[1] === "start" ? "agent_not_ready" : "",
          code: failStart && args[1] === "start" ? 1 : 0,
          killed: false,
        };
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      cwd: dir,
      model: { provider: "test", id: "model" },
      thinkingLevel: "high",
      waitForIdle: async () => { idleWaited = true; },
      sessionManager: {
        getSessionFile: () => "/sessions/parent.jsonl",
        getSessionDir: () => dir,
        getBranch: () => entries,
      },
      ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
    } as unknown as ExtensionCommandContext;
    extension(pi);
    return { commands, calls, ctx, notifications, entries };
  }

  it("shares the alias handler, seeds the exact branch, and prompts only after startup", async () => {
    const { commands, calls, ctx, notifications, entries } = setup();
    assert.equal(commands.get("branch")!.handler, commands.get("fork-agent")!.handler);
    await commands.get("branch")!.handler("  Review this\ncarefully  ", ctx);
    const start = calls[1];
    const sessionFile = start[start.indexOf("--session") + 1];
    const [header, ...copied] = readFileSync(sessionFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(header.parentSession, "/sessions/parent.jsonl");
    assert.deepEqual(copied, entries);
    assert.deepEqual(start.slice(start.indexOf("--model")), ["--model", "test/model", "--thinking", "high", "--tools", "read,bash"]);
    assert.equal(calls[2].at(-1), "Review this\ncarefully");
    assert.equal(notifications.at(-1)?.level, "info");
    assert.match(notifications.at(-1)!.message, /branch-.*w1:p2/);
  });

  it("seeds an empty standalone session without sending an empty prompt", async () => {
    const { commands, calls, ctx } = setup();
    await commands.get("sub-agents")!.handler("   ", ctx);
    assert.equal(calls.length, 2);
    const start = calls[1];
    const lines = readFileSync(start[start.indexOf("--session") + 1], "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).parentSession, undefined);
  });

  it("reports startup failure without success and retains the recoverable session", async () => {
    const { commands, calls, ctx, notifications } = setup(true);
    await commands.get("branch")!.handler("work", ctx);
    assert.equal(calls.length, 2);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].level, "error");
    assert.match(notifications[0].message, /agent_not_ready/);
    assert.match(notifications[0].message, /Child session kept at/);
    assert.equal(readdirSync(dir).length, 1);
  });

  it("rejects ephemeral parents before creating a pane or session", async () => {
    const { commands, calls, ctx, notifications } = setup();
    ctx.sessionManager.getSessionFile = () => undefined;
    await commands.get("branch")!.handler("work", ctx);
    assert.equal(calls.length, 0);
    assert.equal(readdirSync(dir).length, 0);
    assert.match(notifications[0].message, /ephemeral/);
  });
});
