import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readLastGoodCommit,
	readRestartMarker,
	readUpdateRequest,
	writeLastGoodCommit,
	writeRestartMarker,
	writeRolledBackFlag,
	writeUpdateRequest,
} from "../extensions/lib/update";
import { type GitOps, isAuthorisedRequest, SelfUpdater, type SelfUpdateDeps } from "./self-update";

let dir: string;
let notes: Array<{ summary: string; force?: boolean }>;
let records: Array<{ kind: string; summary: string }>;
let restarted: number;
let resumed: string[];
let committed: string[];

const fakeGit = (over: Partial<GitOps> = {}): GitOps => ({
	head: () => "HEADCMT",
	hasChanges: () => true,
	commitAll: (m) => {
		committed.push(m);
		return "NEWCMT";
	},
	resetHard: () => true,
	...over,
});

function updater(opts: { validateOk?: boolean; git?: GitOps } = {}): SelfUpdater {
	const deps: SelfUpdateDeps = {
		stateDir: dir,
		git: opts.git ?? fakeGit(),
		validate: async () => ({ ok: opts.validateOk ?? true, output: "test output" }),
		notify: (summary, o) => notes.push({ summary, force: o?.force }),
		record: (kind, summary) => records.push({ kind, summary }),
		restart: () => {
			restarted += 1;
		},
		resume: (p) => resumed.push(p),
		now: () => 1_700_000_000_000,
		logger: () => {},
	};
	return new SelfUpdater(deps);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "selfup-"));
	notes = [];
	records = [];
	restarted = 0;
	resumed = [];
	committed = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SelfUpdater.apply", () => {
	it("validates, commits, writes a marker, and restarts when tests pass", async () => {
		writeLastGoodCommit(dir, "GOODCMT");
		writeUpdateRequest(dir, { reason: "tidy", resumePrompt: "verify", ts: "t" });
		await updater({ validateOk: true }).apply(readUpdateRequest(dir)!);

		expect(committed).toEqual(["self-update: tidy"]);
		const marker = readRestartMarker(dir);
		expect(marker).toMatchObject({ reason: "tidy", appliedCommit: "NEWCMT", rollbackTo: "GOODCMT", resumePrompt: "verify", attempts: 0 });
		expect(restarted).toBe(1);
		expect(readUpdateRequest(dir)).toBeUndefined(); // request consumed
		expect(notes.some((n) => /restarting to load it/.test(n.summary) && n.force)).toBe(true);
	});

	it("falls back to git HEAD as the rollback target when no last-good is recorded", async () => {
		writeUpdateRequest(dir, { reason: "x", ts: "t" });
		await updater({ validateOk: true }).apply(readUpdateRequest(dir)!);
		expect(readRestartMarker(dir)?.rollbackTo).toBe("HEADCMT");
	});

	it("does NOT restart and keeps the change uncommitted when tests fail", async () => {
		writeUpdateRequest(dir, { reason: "broken", ts: "t" });
		await updater({ validateOk: false }).apply(readUpdateRequest(dir)!);

		expect(restarted).toBe(0);
		expect(committed).toEqual([]);
		expect(readRestartMarker(dir)).toBeUndefined();
		expect(readUpdateRequest(dir)).toBeUndefined(); // request consumed (rejected)
		expect(records.some((r) => r.kind === "self-update-rejected")).toBe(true);
		expect(notes.some((n) => /validation .*failed/i.test(n.summary) && n.force)).toBe(true);
	});

	it("commits nothing when the working tree is clean", async () => {
		writeUpdateRequest(dir, { reason: "reload", ts: "t" });
		await updater({ validateOk: true, git: fakeGit({ hasChanges: () => false }) }).apply(readUpdateRequest(dir)!);
		expect(committed).toEqual([]);
		expect(readRestartMarker(dir)?.appliedCommit).toBe("HEADCMT"); // current head, no new commit
		expect(restarted).toBe(1);
	});

	it("aborts (no restart, no marker) when the commit fails", async () => {
		writeUpdateRequest(dir, { reason: "x", ts: "t" });
		const git = fakeGit({ hasChanges: () => true, commitAll: () => undefined });
		await updater({ validateOk: true, git }).apply(readUpdateRequest(dir)!);
		expect(restarted).toBe(0);
		expect(readRestartMarker(dir)).toBeUndefined();
		expect(records.some((r) => r.kind === "self-update-rejected")).toBe(true);
	});
});

describe("SelfUpdater probation (resumeAfterUpdate → commitPoint)", () => {
	it("resumes the agent but KEEPS the marker until commitPoint (a crash before then still rolls back)", () => {
		writeRestartMarker(dir, { rollbackTo: "GOODCMT", appliedCommit: "NEWCMT", reason: "tidy", resumePrompt: "verify it", attempts: 1, ts: "t" });
		const u = updater();
		u.resumeAfterUpdate();
		expect(resumed).toEqual(["verify it"]);
		expect(readRestartMarker(dir)).toBeDefined(); // still on probation
		expect(readLastGoodCommit(dir)).toBeUndefined(); // last-good NOT advanced yet
		u.resumeAfterUpdate(); // idempotent
		expect(resumed).toEqual(["verify it"]);
	});

	it("commitPoint clears the marker and advances last-good once probation passes", () => {
		writeRestartMarker(dir, { rollbackTo: "GOODCMT", appliedCommit: "NEWCMT", reason: "tidy", attempts: 1, ts: "t" });
		updater().commitPoint();
		expect(readRestartMarker(dir)).toBeUndefined();
		expect(readLastGoodCommit(dir)).toBe("HEADCMT"); // advanced to the new commit
		expect(records.some((r) => r.kind === "self-update-applied")).toBe(true);
	});

	it("recordLastGood sets the baseline on a plain boot, never while a marker is present", () => {
		updater().recordLastGood();
		expect(readLastGoodCommit(dir)).toBe("HEADCMT");
		rmSync(join(dir, "self-update-lastgood"), { force: true });
		writeRestartMarker(dir, { reason: "x", attempts: 0, ts: "t" });
		updater().recordLastGood();
		expect(readLastGoodCommit(dir)).toBeUndefined(); // commitPoint advances last-good, not recordLastGood
	});
});

describe("isAuthorisedRequest", () => {
	it("accepts only a request carrying the daemon's non-empty token", () => {
		expect(isAuthorisedRequest({ token: "abc" }, "abc")).toBe(true);
		expect(isAuthorisedRequest({ token: "abc" }, "xyz")).toBe(false);
		expect(isAuthorisedRequest({}, "abc")).toBe(false); // forged: no token
		expect(isAuthorisedRequest({ token: "abc" }, "")).toBe(false); // daemon with no token never accepts
	});
});

describe("SelfUpdater.onBoot", () => {
	it("reports a rollback the launcher performed, then clears the flag", () => {
		writeRolledBackFlag(dir, { reason: "bad edit", from: "NEWCMT", to: "GOODCMT", ts: "t" });
		const u = updater();
		u.onBoot();
		expect(notes.some((n) => /rolled back/i.test(n.summary) && n.force)).toBe(true);
		expect(records.some((r) => r.kind === "self-update-rolledback")).toBe(true);
		u.onBoot(); // idempotent — flag cleared, no duplicate report
		expect(notes.filter((n) => /rolled back/i.test(n.summary)).length).toBe(1);
	});

	it("does nothing on a clean boot", () => {
		updater().onBoot();
		expect(notes).toEqual([]);
	});
});

describe("SelfUpdater.pendingRestart", () => {
	it("reflects the marker presence", () => {
		const u = updater();
		expect(u.pendingRestart()).toBe(false);
		writeRestartMarker(dir, { reason: "x", attempts: 0, ts: "t" });
		expect(u.pendingRestart()).toBe(true);
	});
});
