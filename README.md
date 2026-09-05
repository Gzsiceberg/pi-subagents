# pi-subagents

A small [Pi](https://pi.dev) extension for independent interactive agents in **Herdr or Zellij** panes.

| Command | Behavior |
| --- | --- |
| `/branch [initial prompt]` | Forks the current conversation into a new interactive agent. |
| `/sub-agents [initial prompt]` | Opens a fresh interactive Pi session. |
| `/fork-agent [initial prompt]` | Compatibility alias for `/branch`. |

```text
/branch Try a different implementation
/sub-agents Review the current changes
```

Omit the prompt to open a child that waits for input. `/branch` is intentionally short for frequent use; Pi reserves `/fork` for its built-in session selector.

Parent and child sessions remain independent. This extension does not collect results, inject coordination messages, or trigger parent turns. Both agents use the **same working directory**, not separate Git worktrees; coordinate concurrent edits accordingly.

## Install

Requirements:

- Pi 0.84.1 or newer
- Herdr 0.8.2 or newer, **or** Zellij 0.44 or newer

```bash
pi install /absolute/path/to/pi-subagents
```

Start Pi in a Herdr terminal pane, or use Zellij:

```bash
zellij --session pi
pi
```

After updating the extension, run `/reload` in Pi.

## Herdr

Herdr is selected automatically when `HERDR_PANE_ID` is set, including when Zellij environment variables are also present. The CLI is resolved from `HERDR_BIN_PATH`, falling back to `herdr` on PATH.

Following Herdr's [agent automation guide](https://herdr.dev/docs/agent-automation/), the extension:

1. Splits the current pane to the right with the parent's working directory, without stealing focus.
2. Reads the new pane ID from the JSON response rather than predicting IDs.
3. Runs `herdr agent start <unique-name> --kind pi --pane <id>` with the child's session, model, thinking level, and tool selection, waiting up to 30 seconds for interactive readiness.
4. Sends the optional initial prompt through `herdr agent prompt` only after startup succeeds. It does **not** wait for the work to finish.

The notification includes the agent name (for example, `branch-a1b2c3d4`) and pane ID. You can use Herdr's CLI separately:

```bash
herdr agent focus branch-a1b2c3d4
herdr agent read branch-a1b2c3d4 --source recent-unwrapped --lines 120
herdr agent prompt branch-a1b2c3d4 "Also check the tests"
herdr agent wait branch-a1b2c3d4 --until idle --until done --timeout 120000
```

Native startup uses Herdr's canonical **`pi` executable in the pane shell**, not the parent's Node executable or source checkout. Ensure that shell resolves the intended Pi installation and configuration environment. The new shell does not inherit arbitrary environment changes made inside the parent Pi process.

If startup is blocked (for example, by a trust dialog), times out, or prompt submission fails, the extension reports the error and keeps the pane and seeded session for inspection. It does not automatically approve dialogs, resend prompts, close potentially live agents, or fall back to Zellij and duplicate work. Inspect the pane, resolve any dialog deliberately, then submit the prompt yourself if needed.

Exit the child Pi normally (`Ctrl+D`); the Herdr pane returns to its shell.

## Zellij

Outside Herdr, the extension checks for Zellij and launches the child in a new pane using the parent's Pi invocation. The pane closes when the child exits (`Ctrl+D`). Neither backend requires new model-callable tools or system-prompt instructions.

## Cache-friendly branches

`/branch` copies the parent's active session branch without adding wrapper messages, tools, or system-prompt instructions. The child starts from the same working directory with the parent's:

- provider and model
- thinking level
- active tool allowlist

Pi loads its normal settings, extensions, context files, skills, and prompts in the child. Keeping these resources and configuration consistent preserves the provider-request prefix for potential prompt-cache reuse. An optional initial prompt is submitted as normal user input. Ephemeral parent sessions cannot be branched.

## Development

```bash
npm test
npm run typecheck
```

The Zellij spawning design is based on the neighboring MIT-licensed `../pi-interactive-subagents` project, especially `pi-extension/subagents/{cmux,index,session}.ts`. This package does not import that project at runtime.
