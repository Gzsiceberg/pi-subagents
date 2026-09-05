import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { seedChildSession } from "./session.ts";
import { isHerdrEnvironment, launchHerdrAgent } from "./herdr.ts";
import { getPiInvocation, isZellijAvailable, launchZellijPane } from "./zellij.ts";

type ChildMode = "standalone" | "fork";

export interface ChildPiArgsOptions {
  sessionFile: string;
  model: { provider: string; id: string };
  thinkingLevel: string;
  activeTools: readonly string[];
  initialPrompt?: string;
}

/** Build an explicit model/thinking/tool launch while leaving prompts and extensions untouched. */
export function buildChildPiArgs(options: ChildPiArgsOptions): string[] {
  const args = [
    "--session",
    options.sessionFile,
    "--model",
    `${options.model.provider}/${options.model.id}`,
    "--thinking",
    options.thinkingLevel,
  ];

  if (options.activeTools.length > 0) {
    args.push("--tools", options.activeTools.join(","));
  } else {
    args.push("--no-tools");
  }

  if (options.initialPrompt) args.push("--", options.initialPrompt);
  return args;
}

async function spawnChild(
  pi: ExtensionAPI,
  mode: ChildMode,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const useHerdr = isHerdrEnvironment();
  if (!useHerdr && !isZellijAvailable()) {
    ctx.ui.notify(
      "Sub-agents require Pi to be running inside Herdr or Zellij. In Herdr, install the herdr CLI and make pi available in the pane shell; in Zellij, run `zellij --session pi`, then `pi`.",
      "error",
    );
    return;
  }

  await ctx.waitForIdle();

  if (!ctx.model) {
    ctx.ui.notify("Cannot start a sub-agent because the parent has no active model.", "error");
    return;
  }

  const parentSession = ctx.sessionManager.getSessionFile();
  if (mode === "fork" && !parentSession) {
    ctx.ui.notify("Cannot fork an ephemeral parent session.", "error");
    return;
  }

  const branch: readonly SessionEntry[] =
    mode === "fork" ? ctx.sessionManager.getBranch() : [];
  const sessionDir =
    ctx.sessionManager.getSessionDir() || SessionManager.create(ctx.cwd).getSessionDir();
  const seeded = seedChildSession({
    cwd: ctx.cwd,
    sessionDir,
    ...(mode === "fork" && parentSession ? { parentSession, entries: branch } : {}),
  });

  const initialPrompt = args.trim() || undefined;
  const childArgs = buildChildPiArgs({
    sessionFile: seeded.sessionFile,
    model: { provider: ctx.model.provider, id: ctx.model.id },
    thinkingLevel: ctx.thinkingLevel ?? pi.getThinkingLevel(),
    activeTools: pi.getActiveTools(),
    initialPrompt: useHerdr ? undefined : initialPrompt,
  });
  const panelName = mode === "fork" ? "Branched agent" : "Sub-agent";
  try {
    let target = "";
    if (useHerdr) {
      const child = await launchHerdrAgent(
        { cwd: ctx.cwd, piArgs: childArgs, initialPrompt, mode },
        (command, args, options) => pi.exec(command, args, options),
      );
      target = ` as ${child.name} (${child.paneId})`;
    } else {
      launchZellijPane({ name: panelName, cwd: ctx.cwd, invocation: getPiInvocation(childArgs) });
    }
    ctx.ui.notify(
      `${panelName} opened${target}${initialPrompt ? " with an initial prompt" : ""}.`,
      "info",
    );
  } catch (error) {
    ctx.ui.notify(
      `Could not start sub-agent: ${error instanceof Error ? error.message : String(error)}\nChild session kept at ${seeded.sessionFile}.`,
      "error",
    );
  }
}

export default function subagentsExtension(pi: ExtensionAPI) {
  pi.registerCommand("sub-agents", {
    description: "Open a fresh interactive Pi agent in Herdr or Zellij",
    handler: async (args, ctx) => {
      await spawnChild(pi, "standalone", args, ctx);
    },
  });

  const branchHandler = async (args: string, ctx: ExtensionCommandContext) => {
    await spawnChild(pi, "fork", args, ctx);
  };
  pi.registerCommand("branch", {
    description: "Branch the current conversation into an interactive Pi agent in Herdr or Zellij",
    handler: branchHandler,
  });
  pi.registerCommand("fork-agent", {
    description: "Alias for /branch",
    handler: branchHandler,
  });
}
