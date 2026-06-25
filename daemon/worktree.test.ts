import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isGitWorkTree, prepareWorktree } from "./worktree";

let root: string;
let repo: string;
let trees: string;

function git(args: string[], cwd: string) {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
	return r.stdout;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "wt-"));
	repo = join(root, "repo");
	trees = join(root, "trees");
	mkdirp(repo);
	git(["init", "-q", "-b", "main"], repo);
	git(["config", "user.email", "t@example.com"], repo);
	git(["config", "user.name", "Test"], repo);
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(["add", "."], repo);
	git(["commit", "-q", "-m", "init"], repo);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function mkdirp(dir: string) {
	mkdirSync(dir, { recursive: true });
}

describe("prepareWorktree", () => {
	it("isolates a worker in its own branch + worktree", () => {
		const prepared = prepareWorktree(repo, "w-1", trees);
		expect(prepared.isolated).toBe(true);
		expect(prepared.cwd).toBe(join(trees, "w-1"));
		expect(prepared.branch).toBe("worker/w-1");
		expect(existsSync(join(trees, "w-1", "README.md"))).toBe(true);
	});

	it("removes an untouched worktree on finalize", () => {
		const prepared = prepareWorktree(repo, "w-2", trees);
		const out = prepared.finalize();
		expect(out.changed).toBe(false);
		expect(out.removed).toBe(true);
		expect(existsSync(join(trees, "w-2"))).toBe(false);
	});

	it("preserves a worktree with uncommitted changes for review", () => {
		const prepared = prepareWorktree(repo, "w-3", trees);
		writeFileSync(join(prepared.cwd, "new-file.txt"), "work in progress\n");
		const out = prepared.finalize();
		expect(out.changed).toBe(true);
		expect(out.removed).toBe(false);
		expect(existsSync(join(trees, "w-3"))).toBe(true);
		expect(out.branch).toBe("worker/w-3");
	});

	it("preserves a worktree with a commit on finalize", () => {
		const prepared = prepareWorktree(repo, "w-4", trees);
		writeFileSync(join(prepared.cwd, "feature.txt"), "done\n");
		git(["add", "."], prepared.cwd);
		git(["commit", "-q", "-m", "feature"], prepared.cwd);
		const out = prepared.finalize();
		expect(out.changed).toBe(true);
		expect(out.removed).toBe(false);
	});

	it("runs in place (un-isolated) when the base is not a git repo", () => {
		const plain = join(root, "plain");
		mkdirp(plain);
		expect(isGitWorkTree(plain)).toBe(false);
		const prepared = prepareWorktree(plain, "w-5", trees);
		expect(prepared.isolated).toBe(false);
		expect(prepared.cwd).toBe(plain);
		expect(prepared.finalize().removed).toBe(false);
	});
});
