/**
 * Worker worktree isolation — give each worker its own git worktree so concurrent
 * workers never collide and never dirty the shared checkout.
 *
 * Deterministic by design: rather than ask an LLM "does this task need a
 * worktree?", the pool isolates every worker whose base cwd is a git repo. A
 * fresh `worker/<id>` branch is checked out under the trees dir; the worker runs
 * there. On finish an UNCHANGED worktree is removed (and its branch deleted),
 * while one with commits or uncommitted edits is PRESERVED so the user can review
 * or merge it. If the base is not a git repo (or worktree creation fails) the
 * worker runs in place — un-isolated but still bounded by the guardrails floor.
 *
 * Git is shelled but injectable, so the lifecycle is tested against a real temp repo.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type GitResult = { status: number | null; stdout: string; stderr: string };
export type GitRunner = (args: string[], cwd: string) => GitResult;

const defaultGit: GitRunner = (args, cwd) => {
	const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
	return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

export type WorktreeOutcome = {
	isolated: boolean;
	changed: boolean;
	removed: boolean;
	path?: string;
	branch?: string;
};

export type PreparedWorktree = {
	/** Where the worker should run. */
	cwd: string;
	/** True when an isolated worktree was created. */
	isolated: boolean;
	branch?: string;
	path?: string;
	/** Set when isolation was wanted but failed (worker runs un-isolated). */
	error?: string;
	/** Inspect the worktree and remove it if untouched; returns the outcome. */
	finalize: () => WorktreeOutcome;
};

export function isGitWorkTree(dir: string, git: GitRunner = defaultGit): boolean {
	return git(["rev-parse", "--is-inside-work-tree"], dir).stdout.trim() === "true";
}

/** Create an isolated worktree for a worker run (or fall back to the base cwd). */
export function prepareWorktree(
	baseCwd: string,
	id: string,
	treesDir: string,
	git: GitRunner = defaultGit,
): PreparedWorktree {
	const inPlace = (error?: string): PreparedWorktree => ({
		cwd: baseCwd,
		isolated: false,
		error,
		finalize: () => ({ isolated: false, changed: false, removed: false }),
	});

	if (!isGitWorkTree(baseCwd, git)) return inPlace();

	const baseHead = git(["rev-parse", "HEAD"], baseCwd).stdout.trim();
	const branch = `worker/${id}`;
	const path = join(treesDir, id);
	try {
		mkdirSync(treesDir, { recursive: true });
	} catch {
		// git will surface a clearer error if the dir is unusable
	}

	const add = git(["worktree", "add", "-b", branch, path, "HEAD"], baseCwd);
	if (add.status !== 0) return inPlace(add.stderr.trim() || "git worktree add failed");

	return {
		cwd: path,
		isolated: true,
		branch,
		path,
		finalize: () => finalizeWorktree(baseCwd, path, branch, baseHead, git),
	};
}

function finalizeWorktree(repoRoot: string, path: string, branch: string, baseHead: string, git: GitRunner): WorktreeOutcome {
	const dirty = git(["status", "--porcelain"], path).stdout.trim() !== "";
	const head = git(["rev-parse", "HEAD"], path).stdout.trim();
	const committed = head !== "" && head !== baseHead;
	if (dirty || committed) {
		return { isolated: true, changed: true, removed: false, path, branch };
	}
	// Untouched: tidy up so empty worktrees don't accumulate.
	git(["worktree", "remove", "--force", path], repoRoot);
	git(["branch", "-D", branch], repoRoot);
	return { isolated: true, changed: false, removed: true, path, branch };
}
