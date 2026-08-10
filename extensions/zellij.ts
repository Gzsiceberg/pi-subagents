import { existsSync } from "node:fs";
import { basename } from "node:path";
import { spawn, spawnSync } from "node:child_process";

export interface PiInvocation {
  command: string;
  args: string[];
}

export interface ZellijCompletion {
  exitCode: number;
  signal: NodeJS.Signals | null;
  error?: string;
}

export interface ZellijLaunch {
  completion: Promise<ZellijCompletion>;
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

/**
 * Launch a command directly in a Zellij pane and resolve only after that pane's
 * command exits. This is the direct-command equivalent of the create/watch flow
 * in ../pi-interactive-subagents/pi-extension/subagents/cmux.ts.
 */
export function launchZellijPane(options: {
  name: string;
  cwd: string;
  invocation: PiInvocation;
}): ZellijLaunch {
  const args = [
    "action",
    "new-pane",
    "--name",
    options.name,
    "--cwd",
    options.cwd,
    "--close-on-exit",
    "--block-until-exit",
    "--",
    options.invocation.command,
    ...options.invocation.args,
  ];

  const child = spawn("zellij", args, {
    cwd: options.cwd,
    env: process.env,
    stdio: "ignore",
  });

  // A running sub-agent must not prevent the parent Pi process from shutting down.
  child.unref();

  const completion = new Promise<ZellijCompletion>((resolve) => {
    let settled = false;
    const finish = (result: ZellijCompletion) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.once("error", (error) => {
      finish({ exitCode: 1, signal: null, error: error.message });
    });
    child.once("close", (code, signal) => {
      finish({ exitCode: code ?? (signal ? 1 : 0), signal });
    });
  });

  return { completion };
}
