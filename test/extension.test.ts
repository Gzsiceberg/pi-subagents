import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentsExtension, { buildChildPiArgs } from "../extensions/index.ts";

describe("extension registration", () => {
  it("registers the documented commands and compatibility alias", () => {
    const commands: string[] = [];
    const fakePi = {
      registerCommand(name: string) {
        commands.push(name);
      },
    } as unknown as ExtensionAPI;

    subagentsExtension(fakePi);
    assert.deepEqual(commands, ["sub-agents", "branch", "fork-agent"]);
  });
});

describe("buildChildPiArgs", () => {
  it("pins the parent model, thinking level, and active tools", () => {
    assert.deepEqual(
      buildChildPiArgs({
        sessionFile: "/tmp/child.jsonl",
        model: { provider: "openai-codex", id: "gpt-5.6-sol" },
        thinkingLevel: "xhigh",
        activeTools: ["read", "bash", "edit", "write"],
        initialPrompt: "Try the alternate implementation",
      }),
      [
        "--session",
        "/tmp/child.jsonl",
        "--model",
        "openai-codex/gpt-5.6-sol",
        "--thinking",
        "xhigh",
        "--tools",
        "read,bash,edit,write",
        "--",
        "Try the alternate implementation",
      ],
    );
  });

  it("preserves an empty tool set and does not inject a prompt", () => {
    assert.deepEqual(
      buildChildPiArgs({
        sessionFile: "/tmp/child.jsonl",
        model: { provider: "anthropic", id: "claude-sonnet" },
        thinkingLevel: "off",
        activeTools: [],
      }),
      [
        "--session",
        "/tmp/child.jsonl",
        "--model",
        "anthropic/claude-sonnet",
        "--thinking",
        "off",
        "--no-tools",
      ],
    );
  });
});
