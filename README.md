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

For Zellij-like prompt delivery latency, the extension uses Herdr's direct pane command surface:

1. Inspects the calling pane's live dimensions, then splits right when its width is at least three times its height (columns/rows), otherwise down. This favors readable columns and typically gives right → down → right as the parent shrinks. Resizes and closed panes are reflected automatically; unavailable geometry falls back to right. The split preserves the parent's working directory without stealing focus.
2. Reads the new pane ID from the JSON response rather than predicting IDs.
3. Submits `pi` through `herdr pane run <id> <command>`, with the child's session, model, thinking level, tool selection, and optional initial prompt already in Pi's arguments. Each argument is shell-quoted to preserve literal text, including quotes, newlines, and shell metacharacters.
4. Returns after command submission, without waiting for Herdr's agent readiness detection or sending a separate prompt.

The notification says **launch submitted**, not ready, and includes the pane ID. No explicit agent name is assigned. Inspect using the returned ID (replace the example below):

```bash
herdr pane focus w6:pF
herdr pane read w6:pF --source recent-unwrapped --lines 120
# Once Herdr recognizes Pi, agent commands also accept the pane ID:
herdr agent get w6:pF
herdr agent prompt w6:pF "Also check the tests"
```

Startup uses **`pi` in the pane shell**, not the parent's Node executable or source checkout. It requires a shell supporting POSIX-style single-quote concatenation (such as sh, bash, zsh, or fish). Ensure that shell resolves the intended Pi installation and configuration environment. The new shell does not inherit arbitrary environment changes made inside the parent Pi process.

This fast path does not detect later Pi startup errors, missing executables, or trust dialogs. Inspect the pane if Pi does not start working. Herdr command failures/timeouts are reported and the pane and seeded session are retained. The extension never automatically approves dialogs, retries a launch, closes potentially live agents, or falls back to Zellij and duplicates work.

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

# Opt-in: run inside Herdr with pi available in the pane shell
npm run test:herdr
```

The live smoke test exercises the production Herdr launcher against the installed CLI and real interactive Pi. It checks exact delivery of `test` and a multiline prompt containing leading dashes, quotes, and shell metacharacters. A test-only Pi extension captures input and stops it before any model call; no manual typing or API usage is needed. Discovery and tools are disabled in these test children. The test creates sibling panes without focusing them, closes only its own panes on success, and preserves panes/artifacts on failure for inspection. It reports per-command timings, launch submission latency, and actual Pi input delivery latency.

This complements the unit tests for command registration, session branching, and argument construction; it does not yet exercise slash-command dispatch or model responses end-to-end. Run both suites when changing the launcher—mocked CLI success alone cannot verify Herdr's actual argument parsing.

The Zellij spawning design is based on the neighboring MIT-licensed `../pi-interactive-subagents` project, especially `pi-extension/subagents/{cmux,index,session}.ts`. This package does not import that project at runtime.
