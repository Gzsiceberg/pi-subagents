import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isHerdrEnvironment, launchHerdrAgent } from "../extensions/herdr.ts";

const env = { HERDR_PANE_ID: "w6:p1", HERDR_BIN_PATH: "/opt/herdr bin/herdr" };
const options = {
  cwd: "/project with spaces",
  piArgs: ["--session", "/sessions/child.jsonl", "--model", "provider/model", "--no-tools"],
  mode: "fork" as const,
};
const success = (stdout = "{}") => ({ stdout, stderr: "", code: 0, killed: false });
const split = success(JSON.stringify({ result: { pane: { pane_id: "w6:p42" } } }));

function fakeExec(results = [split, success(), success()]) {
  const calls: { command: string; args: string[]; options: unknown }[] = [];
  const exec: ExtensionAPI["exec"] = async (command, args, options) => {
    calls.push({ command, args, options });
    const result = results.shift();
    assert.ok(result, "unexpected extra command");
    return result;
  };
  return { exec, calls };
}

describe("Herdr native launch", () => {
  it("requires a pane environment, not merely an installed CLI/socket", () => {
    assert.equal(isHerdrEnvironment({}), false);
    assert.equal(isHerdrEnvironment({ HERDR_SOCKET_PATH: "/tmp/herdr.sock" }), false);
    assert.equal(isHerdrEnvironment(env), true);
  });

  it("splits, awaits readiness, then sends a literal prompt without waiting for work", async () => {
    const { exec, calls } = fakeExec();
    const prompt = "--review 'quotes' $(touch /tmp/nope)\nsecond line";
    const child = await launchHerdrAgent({ ...options, initialPrompt: prompt }, exec, env);
    assert.match(child.name, /^branch-[a-z0-9-]+$/);
    assert.equal(child.paneId, "w6:p42");
    assert.deepEqual(calls, [
      {
        command: env.HERDR_BIN_PATH,
        args: ["pane", "split", "--current", "--direction", "right", "--cwd", options.cwd, "--no-focus"],
        options: { cwd: options.cwd, timeout: 15_000 },
      },
      {
        command: env.HERDR_BIN_PATH,
        args: ["agent", "start", child.name, "--kind", "pi", "--pane", "w6:p42", "--timeout", "30000", "--", ...options.piArgs],
        options: { cwd: options.cwd, timeout: 35_000 },
      },
      {
        command: env.HERDR_BIN_PATH,
        args: ["agent", "prompt", child.name, "--", prompt],
        options: { cwd: options.cwd, timeout: 15_000 },
      },
    ]);
  });

  it("opens fresh agents with unique names and no injected prompt", async () => {
    const first = fakeExec([split, success()]);
    const second = fakeExec([split, success()]);
    const a = await launchHerdrAgent({ ...options, mode: "standalone" }, first.exec, { HERDR_PANE_ID: "w1:p1" });
    const b = await launchHerdrAgent({ ...options, mode: "standalone" }, second.exec, env);
    assert.match(a.name, /^agent-[a-z0-9-]+$/);
    assert.notEqual(a.name, b.name);
    assert.equal(first.calls.length, 2);
    assert.equal(first.calls[0].command, "herdr");
  });

  for (const stdout of ["not json", "null", "{}", '{"result":{"pane":{"pane_id":42}}}']) {
    it(`stops on malformed split response: ${stdout}`, async () => {
      const { exec, calls } = fakeExec([success(stdout)]);
      await assert.rejects(launchHerdrAgent(options, exec, env), /Herdr pane split/);
      assert.equal(calls.length, 1);
    });
  }

  for (const failure of [
    { stdout: "", stderr: '{"error":{"code":"agent_not_ready"}}', code: 1, killed: false },
    { stdout: "", stderr: "", code: 0, killed: true },
  ]) {
    it(`keeps the pane and never prompts after startup failure: ${JSON.stringify(failure)}`, async () => {
      const { exec, calls } = fakeExec([split, failure]);
      await assert.rejects(
        launchHerdrAgent({ ...options, initialPrompt: "do work" }, exec, env),
        /Pane w6:p42 was kept.*herdr pane focus w6:p42/,
      );
      assert.equal(calls.length, 2);
    });
  }

  it("does not retry a rejected prompt or close the potentially live agent", async () => {
    const { exec, calls } = fakeExec([split, success(), { stdout: "", stderr: "agent_blocked", code: 1, killed: false }]);
    await assert.rejects(launchHerdrAgent({ ...options, initialPrompt: "work" }, exec, env), /agent_blocked/);
    assert.equal(calls.length, 3);
  });

  it("reports CLI spawn failures", async () => {
    const exec: ExtensionAPI["exec"] = async () => { throw new Error("spawn herdr ENOENT"); };
    await assert.rejects(launchHerdrAgent(options, exec, env), /ENOENT/);
  });
});
