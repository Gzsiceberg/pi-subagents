import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { findChildResult, seedChildSession } from "./session.ts";
import {
  getPiInvocation,
  isZellijAvailable,
  launchZellijPane,
  type ZellijCompletion,
} from "./zellij.ts";

const RESULT_MAX_BYTES = 50 * 1024;

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

  if (options.initialPrompt) args.push(options.initialPrompt);
  return args;
}

function truncateResult(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= RESULT_MAX_BYTES) return text;

  let content = bytes.subarray(0, RESULT_MAX_BYTES).toString("utf8");
  if (content.endsWith("�")) content = content.slice(0, -1);
  return `${content}\n\n[Result truncated to 50KB. Full conversation: child session file below.]`;
}

function completionLabel(completion: ZellijCompletion): string {
  if (completion.error) return `failed to launch: ${completion.error}`;
  if (completion.signal) return `exited on ${completion.signal}`;
  return completion.exitCode === 0 ? "exited" : `exited with code ${completion.exitCode}`;
}

function deliverResult(
  pi: ExtensionAPI,
  options: {
    mode: ChildMode;
    sessionFile: string;
    baselineLineCount: number;
    completion: ZellijCompletion;
  },
): void {
  const title = options.mode === "fork" ? "Forked sub-agent" : "Sub-agent";
  let result: string | null = null;
  let extractionError: string | undefined;

  try {
    result = findChildResult(options.sessionFile, options.baselineLineCount);
  } catch (error) {
    extractionError = error instanceof Error ? error.message : String(error);
  }

  const status = completionLabel(options.completion);
  const body = result
    ? truncateResult(result)
    : extractionError
      ? `Could not read the child result: ${extractionError}`
      : "The child exited without producing a new assistant response.";

  try {
    pi.sendMessage(
      {
        customType: "interactive_subagent_result",
        content: `${title} ${status}.\n\n${body}\n\nSession: ${options.sessionFile}`,
        display: true,
        details: {
          mode: options.mode,
          status,
          sessionFile: options.sessionFile,
          exitCode: options.completion.exitCode,
          signal: options.completion.signal,
          error: options.completion.error,
        },
      },
      { triggerTurn: true, deliverAs: "steer" },
    );
  } catch {
    // The originating parent session may have been closed or replaced.
  }
}

async function spawnChild(
  pi: ExtensionAPI,
  mode: ChildMode,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!isZellijAvailable()) {
    ctx.ui.notify(
      "Sub-agents require Pi to be running inside Zellij (`zellij --session pi`, then `pi`).",
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
    initialPrompt,
  });
  const invocation = getPiInvocation(childArgs);
  const panelName = mode === "fork" ? "Forked sub-agent" : "Sub-agent";
  const launch = launchZellijPane({ name: panelName, cwd: ctx.cwd, invocation });

  ctx.ui.notify(
    `${panelName} opened${initialPrompt ? " with an initial prompt" : ""}. Its result will return when you exit it.`,
    "info",
  );

  void launch.completion.then((completion) => {
    deliverResult(pi, {
      mode,
      sessionFile: seeded.sessionFile,
      baselineLineCount: seeded.baselineLineCount,
      completion,
    });
  });
}

export default function subagentsExtension(pi: ExtensionAPI) {
  pi.registerCommand("sub-agents", {
    description: "Open a new interactive Pi sub-agent in a Zellij panel",
    handler: async (args, ctx) => {
      await spawnChild(pi, "standalone", args, ctx);
    },
  });

  pi.registerCommand("fork-agent", {
    description: "Fork the current session into an interactive Pi sub-agent in a Zellij panel",
    handler: async (args, ctx) => {
      await spawnChild(pi, "fork", args, ctx);
    },
  });
}
