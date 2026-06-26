import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	bumpRestartAttempts,
	clearRestartMarker,
	clearRolledBackFlag,
	clearUpdateRequest,
	readLastGoodCommit,
	readRestartMarker,
	readRolledBackFlag,
	readUpdateRequest,
	shouldRollback,
	writeLastGoodCommit,
	writeRestartMarker,
	writeRolledBackFlag,
	writeUpdateRequest,
} from "./update";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "update-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("update request", () => {
	it("round-trips and clears", () => {
		writeUpdateRequest(dir, { reason: "tidy logs", resumePrompt: "verify", runId: "w-1", ts: "t" });
		expect(readUpdateRequest(dir)).toMatchObject({ reason: "tidy logs", resumePrompt: "verify", runId: "w-1" });
		clearUpdateRequest(dir);
		expect(readUpdateRequest(dir)).toBeUndefined();
	});
});

describe("restart marker + attempts", () => {
	it("round-trips, increments attempts, and clears", () => {
		writeRestartMarker(dir, { rollbackTo: "aaa", appliedCommit: "bbb", reason: "x", attempts: 0, ts: "t" });
		expect(readRestartMarker(dir)?.attempts).toBe(0);
		expect(bumpRestartAttempts(dir)?.attempts).toBe(1);
		expect(bumpRestartAttempts(dir)?.attempts).toBe(2);
		expect(readRestartMarker(dir)?.attempts).toBe(2);
		clearRestartMarker(dir);
		expect(readRestartMarker(dir)).toBeUndefined();
		expect(bumpRestartAttempts(dir)).toBeUndefined();
	});
});

describe("shouldRollback", () => {
	const m = (attempts: number, rollbackTo?: string) => ({ attempts, rollbackTo, reason: "x", ts: "t" });
	it("rolls back only past the attempt limit and only with a target", () => {
		expect(shouldRollback(m(2, "aaa"), 2)).toBe(false); // at the limit
		expect(shouldRollback(m(3, "aaa"), 2)).toBe(true); // past it
		expect(shouldRollback(m(9), 2)).toBe(false); // no rollback target
		expect(shouldRollback(m(9, ""), 2)).toBe(false);
	});
});

describe("rolled-back flag", () => {
	it("round-trips and clears", () => {
		writeRolledBackFlag(dir, { reason: "bad edit", from: "bbb", to: "aaa", ts: "t" });
		expect(readRolledBackFlag(dir)).toMatchObject({ reason: "bad edit", to: "aaa" });
		clearRolledBackFlag(dir);
		expect(readRolledBackFlag(dir)).toBeUndefined();
	});
});

describe("last-good commit", () => {
	it("round-trips", () => {
		expect(readLastGoodCommit(dir)).toBeUndefined();
		writeLastGoodCommit(dir, "deadbeef\n");
		expect(readLastGoodCommit(dir)).toBe("deadbeef");
	});
});

describe("absent files", () => {
	it("read helpers tolerate a missing dir/file", () => {
		expect(readUpdateRequest(join(dir, "nope"))).toBeUndefined();
		expect(readRestartMarker(join(dir, "nope"))).toBeUndefined();
		expect(existsSync(join(dir, "self-update-request.json"))).toBe(false);
	});
});
