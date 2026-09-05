import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { launchHerdrAgent } from "../extensions/herdr.ts";

const binary = process.env.HERDR_BIN_PATH || "herdr";
const exec: ExtensionAPI["exec"] = (command, args, options) => new Promise((resolve) => {
  execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout }, (error, stdout, stderr) => {
    resolve({ stdout, stderr, code: error ? (typeof error.code === "number" ? error.code : 1) : 0, killed: error?.killed ?? false });
  });
});

it("delivers literal initial prompts to real interactive Pi through real Herdr", { timeout: 120_000 }, async () => {
  assert.equal(process.env.HERDR_ENV, "1", "Run this opt-in test inside Herdr");
  assert.ok(process.env.HERDR_PANE_ID);
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-live-"));
  const panes: string[] = [];
  let passed = false;
  // Track only panes created by this test, including ones whose startup fails.
  const trackedExec: ExtensionAPI["exec"] = async (command, args, options) => {
    const result = await exec(command, args, options);
    if (args[0] === "pane" && args[1] === "split" && result.code === 0) {
      panes.push(JSON.parse(result.stdout).result.pane.pane_id);
    }
    return result;
  };
  try {
    for (const [index, prompt] of ["test", "--review 'quotes' $(echo not-a-shell-command)\nsecond line"].entries()) {
      const capture = join(dir, `input-${index}.jsonl`);
      const child = await launchHerdrAgent({
        cwd: process.cwd(),
        mode: index === 0 ? "standalone" : "fork",
        piArgs: ["--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
          "--no-context-files", "--no-tools", "--offline", "--no-approve",
          "-e", resolve("test/fixtures/capture-input.ts"), "--capture-input", capture],
        initialPrompt: prompt,
      }, trackedExec);
      const deadline = Date.now() + 10_000;
      while (!existsSync(capture) && Date.now() < deadline) await delay(100);
      assert.ok(existsSync(capture), `Pi did not receive input in ${child.paneId}`);
      assert.deepEqual(readFileSync(capture, "utf8").trim().split("\n").map(line => JSON.parse(line)), [prompt]);
      const closed = await exec(binary, ["pane", "close", child.paneId], { timeout: 5000 });
      assert.equal(closed.code, 0, closed.stderr);
      panes.splice(panes.indexOf(child.paneId), 1);
    }
    passed = true;
  } finally {
    // On failure keep evidence, never touch pre-existing panes or user sessions.
    if (passed) rmSync(dir, { recursive: true, force: true });
    else console.error(`Smoke test artifacts: ${dir}; kept test panes: ${panes.join(", ")}`);
  }
});
