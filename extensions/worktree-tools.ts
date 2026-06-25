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
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWorktreeTools } from "./worktrees.ts";

export default function worktreeToolsExtension(pi: ExtensionAPI): void {
	registerWorktreeTools(pi);
}
