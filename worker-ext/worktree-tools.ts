/**
 * Worktree tools (slim) — the agent-callable worktree operations only.
 *
 * The full `worktrees` extension is interactive: it tracks the session's
 * effective cwd and rewrites tool paths, which is right for the resident TUI but
 * wrong for a headless `pi -p` worker. This slim extension registers just the
 * `worktree_*` tools (create / adopt / list / status / merge / remove) so a
 * worker — which runs with --no-extensions plus explicit -e loads — can manage
 * its own worktrees (adopt a PR branch, work across repos) without the session
 * machinery. The resident loads the full extension; workers load this one.
 *
 * Lives OUTSIDE extensions/ (which pi auto-discovers) so it is never loaded into
 * an interactive session alongside worktrees.ts — that would register the
 * worktree_* tools twice. Workers load it explicitly via -e.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWorktreeTools } from "../extensions/worktrees.ts";

export default function worktreeToolsExtension(pi: ExtensionAPI): void {
	registerWorktreeTools(pi);
}
