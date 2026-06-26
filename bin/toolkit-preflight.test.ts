/**
 * The launcher preflight is hand-rolled (stdlib-only, so a broken repo edit cannot
 * disable the rollback), which means its on-disk format must stay in lockstep with
 * extensions/lib/update.ts. This drives the REAL preflight script against a real git
 * repo: the marker is written via update.ts and the resulting rollback flag is read
 * via update.ts, so any format drift fails here.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRestartMarker, readRolledBackFlag, writeRestartMarker } from "../extensions/lib/update";

const PREFLIGHT = join(import.meta.dir, "toolkit-preflight.ts");

let repo: string;
let stateDir: string;
const git = (a: string[]) => spawnSync("git", a, { cwd: repo, encoding: "utf8" });
const runPreflight = () =>
	spawnSync("bun", ["run", PREFLIGHT], {
		cwd: repo,
		encoding: "utf8",
		env: { ...process.env, AGENT_TOOLKIT_STATE_DIR: stateDir, AGENT_TOOLKIT_SELF_UPDATE_MAX_ATTEMPTS: "2" },
	});

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "preflight-repo-"));
	stateDir = mkdtempSync(join(tmpdir(), "preflight-state-"));
	git(["init", "-q"]);
	git(["config", "user.email", "t@t"]);
	git(["config", "user.name", "t"]);
});
afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
	rmSync(stateDir, { recursive: true, force: true });
});

describe("toolkit-preflight (real script, real git)", () => {
	it("bumps attempts and rolls the checkout back to last-good once the limit is exceeded", () => {
		writeFileSync(join(repo, "f.ts"), "export const V = 'good';\n");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "good"]);
		const good = git(["rev-parse", "HEAD"]).stdout.trim();
		// The (bad) self-update commit.
		writeFileSync(join(repo, "f.ts"), "export const V = 'BROKEN';\n");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "bad"]);
		const bad = git(["rev-parse", "HEAD"]).stdout.trim();

		writeRestartMarker(stateDir, { rollbackTo: good, appliedCommit: bad, reason: "change V", attempts: 0, ts: "t" });

		runPreflight(); // attempt 1 ≤ 2
		expect(readRestartMarker(stateDir)?.attempts).toBe(1);
		expect(git(["rev-parse", "HEAD"]).stdout.trim()).toBe(bad); // not yet rolled back

		runPreflight(); // attempt 2 ≤ 2
		expect(readRestartMarker(stateDir)?.attempts).toBe(2);
		expect(git(["rev-parse", "HEAD"]).stdout.trim()).toBe(bad);

		runPreflight(); // attempt 3 > 2 → rollback
		expect(git(["rev-parse", "HEAD"]).stdout.trim()).toBe(good); // reverted
		expect(readFileSync(join(repo, "f.ts"), "utf8")).toContain("good");
		expect(readRestartMarker(stateDir)).toBeUndefined(); // marker cleared
		const flag = readRolledBackFlag(stateDir); // written in update.ts's format
		expect(flag).toMatchObject({ reason: "change V", to: good, from: bad });
	});

	it("does nothing when there is no restart marker (a normal start)", () => {
		writeFileSync(join(repo, "f.ts"), "x");
		git(["add", "-A"]);
		git(["commit", "-q", "-m", "c"]);
		const head = git(["rev-parse", "HEAD"]).stdout.trim();
		const r = runPreflight();
		expect(r.status).toBe(0);
		expect(git(["rev-parse", "HEAD"]).stdout.trim()).toBe(head);
		expect(readRolledBackFlag(stateDir)).toBeUndefined();
	});
});
