# pi-subagents

A small [Pi](https://pi.dev) extension for interactive sub-agents in Zellij panels.

It registers exactly two slash commands:

| Command | Behavior |
| --- | --- |
| `/sub-agents [initial prompt]` | Opens a fresh interactive Pi session in a new Zellij panel. |
| `/fork-agent [initial prompt]` | Opens an interactive fork of the parent session in a new Zellij panel. |

The child stays interactive until you exit Pi in its panel (normally `Ctrl+D`). Parent and child sessions remain independent; exiting the child does not send a message to or trigger a turn in the parent.

## Cache-friendly forks

`/fork-agent` copies the parent's active session branch without adding wrapper messages, tools, or system-prompt instructions. The child is launched from the same working directory with the parent's:

- provider and model
- thinking level
- active tool allowlist
- normal Pi settings, extensions, context files, skills, and prompts

This keeps the existing provider-request prefix stable for prompt-cache reuse. An optional initial prompt is appended as a normal user message.

> Pi reserves exact `/fork` for its built-in session selector, so this extension uses `/fork-agent` rather than trying to override built-in TUI behavior.

## Install

Requirements:

- Pi 0.84.1 or newer
- Zellij 0.44 or newer

Install this checkout as a local Pi package:

```bash
pi install /absolute/path/to/pi-subagents
```

Start Pi inside Zellij:

```bash
zellij --session pi
pi
```

Then run either command:

```text
/sub-agents Review the current changes
/fork-agent Try a different implementation
```

Omit the text to open a child that waits for input.

## Design reference

The Zellij spawning design is based on the neighboring MIT-licensed `../pi-interactive-subagents` project, especially:

- `pi-extension/subagents/cmux.ts`
- `pi-extension/subagents/index.ts`
- `pi-extension/subagents/session.ts`

This package is intentionally Zellij-only and command-only; it does not import that project at runtime.
