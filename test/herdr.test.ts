import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chooseSplitDirection, isHerdrEnvironment, launchHerdrAgent } from "../extensions/herdr.ts";

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
    if (args[1] === "layout") return success();
    const result = results.shift();
    assert.ok(result, "unexpected extra command");
    return result;
  };
  return { exec, calls };
}

describe("adaptive Herdr splits", () => {
  const layout = (width: number, height: number) => ({ result: { layout: { panes: [
    { pane_id: "other-focused-pane", rect: { width: 300, height: 20 } },
    { pane_id: env.HERDR_PANE_ID, rect: { width, height } },
  ] } } });

  it("chooses right → down → right as the calling pane shrinks", () => {
    assert.equal(chooseSplitDirection(layout(190, 38), env.HERDR_PANE_ID), "right");
    assert.equal(chooseSplitDirection(layout(95, 38), env.HERDR_PANE_ID), "down");
    assert.equal(chooseSplitDirection(layout(95, 19), env.HERDR_PANE_ID), "right");
  });

  it("uses current dimensions after resizing, with a defined threshold", () => {
    assert.equal(chooseSplitDirection(layout(114, 38), env.HERDR_PANE_ID), "right");
    assert.equal(chooseSplitDirection(layout(113, 38), env.HERDR_PANE_ID), "down");
    assert.equal(chooseSplitDirection(layout(60, 50), env.HERDR_PANE_ID), "down");
  });

  it("falls back safely for missing or malformed geometry", () => {
    for (const response of [null, {}, { result: { layout: { panes: {} } } }, layout(0, 38), layout(100, NaN)]) {
      assert.equal(chooseSplitDirection(response, env.HERDR_PANE_ID), "right");
    }
    assert.equal(chooseSplitDirection(layout(60, 50), "missing"), "right");
  });

  it("passes the adaptive direction to the real launch sequence", async () => {
    const fake = fakeExec();
    const exec: ExtensionAPI["exec"] = async (command, args, options) => args[1] === "layout"
      ? success(JSON.stringify(layout(95, 38))) : fake.exec(command, args, options);
    await launchHerdrAgent(options, exec, env);
    assert.equal(fake.calls[0].args[fake.calls[0].args.indexOf("--direction") + 1], "down");
  });

  it("still launches when optional layout inspection fails", async () => {
    const fake = fakeExec();
    const exec: ExtensionAPI["exec"] = async (command, args, options) => {
      if (args[1] === "layout") throw new Error("layout unavailable");
      return fake.exec(command, args, options);
    };
    await launchHerdrAgent(options, exec, env);
    assert.equal(fake.calls[0].args[fake.calls[0].args.indexOf("--direction") + 1], "right");
  });
});

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
        args: ["pane", "layout", "--current"],
        options: { cwd: options.cwd, timeout: 3_000 },
      },
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
        args: ["agent", "prompt", child.name, prompt],
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
    assert.equal(first.calls.length, 3);
    assert.equal(first.calls[0].command, "herdr");
  });

  it("accepts opaque non-numeric pane IDs returned by Herdr", async () => {
    const { exec, calls } = fakeExec([success('{"result":{"pane":{"pane_id":"w6:pF"}}}'), success()]);
    const child = await launchHerdrAgent(options, exec, env);
    assert.equal(child.paneId, "w6:pF");
    assert.ok(calls[2].args.includes("w6:pF"));
  });

  for (const stdout of ["not json", "null", "{}", '{"result":{"pane":{"pane_id":42}}}', '{"result":{"pane":{"pane_id":""}}}']) {
    it(`stops on malformed split response: ${stdout}`, async () => {
      const { exec, calls } = fakeExec([success(stdout)]);
      await assert.rejects(launchHerdrAgent(options, exec, env), /Herdr pane split/);
      assert.equal(calls.length, 2);
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
      assert.equal(calls.length, 3);
    });
  }

  it("does not retry a rejected prompt or close the potentially live agent", async () => {
    const { exec, calls } = fakeExec([split, success(), { stdout: "", stderr: "agent_blocked", code: 1, killed: false }]);
    await assert.rejects(launchHerdrAgent({ ...options, initialPrompt: "work" }, exec, env), /agent_blocked/);
    assert.equal(calls.length, 4);
  });

  it("reports CLI spawn failures", async () => {
    const exec: ExtensionAPI["exec"] = async () => { throw new Error("spawn herdr ENOENT"); };
    await assert.rejects(launchHerdrAgent(options, exec, env), /ENOENT/);
  });
});
