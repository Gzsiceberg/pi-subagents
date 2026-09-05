import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function isHerdrEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.HERDR_PANE_ID);
}

export interface HerdrLaunchOptions {
  cwd: string;
  piArgs: string[];
  initialPrompt?: string;
  mode: "standalone" | "fork";
}

/** Use Herdr's native readiness detection, not sleeps or raw terminal input. */
export async function launchHerdrAgent(
  options: HerdrLaunchOptions,
  exec: ExtensionAPI["exec"],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ name: string; paneId: string }> {
  if (!isHerdrEnvironment(env)) throw new Error("Pi must be running inside a Herdr pane.");
  const binary = env.HERDR_BIN_PATH || "herdr";
  const name = `${options.mode === "fork" ? "branch" : "agent"}-${randomUUID().slice(0, 8)}`;
  let paneId: string | undefined;

  async function run(args: string[], timeout = 15_000): Promise<string> {
    const result = await exec(binary, args, { cwd: options.cwd, timeout });
    if (result.killed || result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
      throw new Error(`${result.killed ? "Herdr command timed out" : "Herdr command failed"}: ${detail.slice(0, 2000)}`);
    }
    return result.stdout;
  }

  try {
    const output = await run([
      "pane", "split", "--current", "--direction", "right",
      "--cwd", options.cwd, "--no-focus",
    ]);
    let response;
    try {
      response = JSON.parse(output);
    } catch {
      throw new Error("Herdr pane split returned invalid JSON; inspect the layout before retrying.");
    }
    const returnedId = response?.result?.pane?.pane_id;
    // Herdr IDs are opaque handles; pane suffixes are not necessarily numeric.
    if (typeof returnedId !== "string" || !returnedId.trim()) {
      throw new Error("Herdr pane split did not return a valid result.pane.pane_id; inspect the layout before retrying.");
    }
    paneId = returnedId;

    await run([
      "agent", "start", name, "--kind", "pi", "--pane", paneId,
      "--timeout", "30000", "--", ...options.piArgs,
    ], 35_000);

    if (options.initialPrompt) {
      // TEXT is a fixed positional argument, even when it starts with dashes.
      // Unlike `agent start`, Herdr's prompt parser does not support `--`.
      await run(["agent", "prompt", name, options.initialPrompt]);
    }
    return { name, paneId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // A timeout/blocked startup can leave a live agent. Never close it, resend a
    // prompt, or fall back to another backend: that could duplicate work.
    throw new Error(paneId
      ? `${detail}\nPane ${paneId} was kept. Inspect it with herdr pane focus ${paneId} or herdr pane read ${paneId}.`
      : detail);
  }
}
