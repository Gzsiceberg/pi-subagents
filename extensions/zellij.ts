import { existsSync } from "node:fs";
import { basename } from "node:path";
import { spawn, spawnSync } from "node:child_process";

export interface PiInvocation {
  command: string;
  args: string[];
}

/** Match Pi's own subagent example so packaged, source, and binary installs work. */
export function getPiInvocation(args: string[]): PiInvocation {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const executable = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(executable);
  return isGenericRuntime
    ? { command: "pi", args }
    : { command: process.execPath, args };
}

export function isZellijAvailable(): boolean {
  if (!process.env.ZELLIJ && !process.env.ZELLIJ_SESSION_NAME) return false;
  const result = spawnSync("zellij", ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

/** Launch a command in a detached Zellij pane without watching for its result. */
export function launchZellijPane(options: {
  name: string;
  cwd: string;
  invocation: PiInvocation;
}): void {
  const args = [
    "action",
    "new-pane",
    "--name",
    options.name,
    "--cwd",
    options.cwd,
    "--close-on-exit",
    "--",
    options.invocation.command,
    ...options.invocation.args,
  ];

  const child = spawn("zellij", args, {
    cwd: options.cwd,
    env: process.env,
    stdio: "ignore",
  });

  // Availability was checked before launch; swallow a late spawn error so the
  // detached launcher cannot crash the parent session.
  child.once("error", () => {});
  child.unref();
}
