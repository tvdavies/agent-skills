# Daemon & CLIs

The autonomous runtime that keeps a resident agent alive and feeds it work.
Pure, tested building blocks live in [`../daemon/`](../daemon); these are the
executables that wire them together.

## Components

- `toolkit-daemon.ts` — supervises a `pi --mode rpc` child: strict-LF JSONL
  framing (U+2028/2029 safe), respawn with exponential backoff, drains the
  trigger inbox and forwards each trigger (as a `prompt` when idle, `follow_up`
  when busy), answers the extension-UI sub-protocol (auto-cancel by default),
  and writes `daemon-status.json`. Holds **zero** LLM logic.
- `toolkit-trigger.ts` — appends a trigger to `inbox.jsonl` (the reliable
  transport the daemon drains) and, when a TADU workspace is present, also
  creates a TADU task for visibility (best-effort).

Cron, Slack (Phase 3), and you all poke the agent through `toolkit-trigger`.

## Runtime model

One resident `pi --mode rpc` process, driven by the daemon over stdio (not an
interactive TTY). You interact with it through `toolkit-trigger`, `/status`,
the decision log, and — later — Slack and the dashboard. The daemon runs under
`systemd --user` so it survives logout/reboot.

## Install is deferred

Nothing here installs system services automatically. Render the artefacts, then
run the printed steps yourself:

```bash
# Print the env file, launcher, systemd unit, and the manual install steps:
node --experimental-transform-types --no-warnings bin/toolkit-daemon.ts --print-units

# Or write the launcher + unit (+ a 0600 env template) to ~/.config/agent-toolkit:
node --experimental-transform-types --no-warnings bin/toolkit-daemon.ts --write-units
```

The printed steps cover `systemctl --user enable --now` and
`loginctl enable-linger`. Review them before running.

## Run locally (foreground, for testing)

```bash
AGENT_TOOLKIT_STATE_DIR=~/.local/state/agent-toolkit \
  node --experimental-transform-types --no-warnings bin/toolkit-daemon.ts
# in another shell:
node --experimental-transform-types --no-warnings bin/toolkit-trigger.ts "advance the active goal"
```

## Config (environment)

`AGENT_TOOLKIT_INSTANCE`, `AGENT_TOOLKIT_STATE_DIR`, `AGENT_TOOLKIT_SESSION_DIR`,
`AGENT_TOOLKIT_BRAIN_ROOT`, `AGENT_TOOLKIT_MODEL`, `AGENT_TOOLKIT_PI_BIN`.

## Tests

`bun test daemon/` covers framing (the U+2028/2029 bug class), inbox dedupe and
cursor, backoff, provisioning renderers, and an end-to-end run of the RPC client
and supervisor against a `fake-pi` fixture subprocess — no model required.
