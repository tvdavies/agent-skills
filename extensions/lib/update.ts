/**
 * Self-update coordination — the durable hand-off that lets the agent load its own
 * code change safely.
 *
 * The agent lives inside the process it must restart, so it cannot restart itself
 * cleanly. Instead, mirroring the park/resume pattern, three small on-disk records
 * coordinate the agent, the daemon, and the launcher:
 *
 *  - request   (self-update-request.json): the agent asks "load my change". The
 *    daemon validates (bun test), commits, and restarts.
 *  - marker    (self-update-restart.json): a restart is in flight. The LAUNCHER reads
 *    it on every (re)start and, if the new code keeps failing to boot, rolls the
 *    checkout back to `rollbackTo`. The daemon clears it once it boots healthy.
 *  - rolledback(self-update-rolledback.json): set by the launcher when it reverted, so
 *    the freshly-booted (old-code) daemon can tell the human the update failed.
 *  - lastgood  (self-update-lastgood): the commit the running daemon booted from — the
 *    rollback target, recorded on every healthy boot so it survives edits AND pulls.
 *
 * Pure fs + JSON, no orchestration, so every reader/writer (tool, daemon, launcher)
 * shares one format and the bookkeeping is tested in isolation.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REQUEST = "self-update-request.json";
const MARKER = "self-update-restart.json";
const ROLLED_BACK = "self-update-rolledback.json";
const LAST_GOOD = "self-update-lastgood";

export type UpdateRequest = {
	reason: string;
	/** A message to deliver to the agent after the restart (optional). */
	resumePrompt?: string;
	/** Worker run id, when a worker asked (the resident has none). */
	runId?: string;
	/** Capability token proving the request came from the resident (the daemon injects
	 *  this into the resident's env only; workers cannot read it). Forged requests omit it. */
	token?: string;
	ts: string;
};

export type RestartMarker = {
	/** Commit to revert to if the new code will not boot. */
	rollbackTo?: string;
	/** The commit the update produced (for reporting). */
	appliedCommit?: string;
	reason: string;
	resumePrompt?: string;
	runId?: string;
	/** Boot attempts on the new code so far (the launcher increments this). */
	attempts: number;
	ts: string;
};

export type RolledBackFlag = { reason: string; from?: string; to?: string; ts: string };

function writeJson(dir: string, file: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	// Atomic write (tmp + rename) so a reader — notably the launcher preflight, which
	// keys the rollback off this file — can never see a torn/partial JSON record.
	const target = join(dir, file);
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(tmp, target);
}
function readJson<T>(dir: string, file: string): T | undefined {
	const path = join(dir, file);
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}
function remove(dir: string, file: string): void {
	try {
		rmSync(join(dir, file), { force: true });
	} catch {
		// best-effort
	}
}

// --- request ---------------------------------------------------------------
export function writeUpdateRequest(dir: string, req: UpdateRequest): void {
	writeJson(dir, REQUEST, req);
}
export function readUpdateRequest(dir: string): UpdateRequest | undefined {
	return readJson<UpdateRequest>(dir, REQUEST);
}
export function clearUpdateRequest(dir: string): void {
	remove(dir, REQUEST);
}

// --- restart marker --------------------------------------------------------
export function writeRestartMarker(dir: string, marker: RestartMarker): void {
	writeJson(dir, MARKER, marker);
}
export function readRestartMarker(dir: string): RestartMarker | undefined {
	return readJson<RestartMarker>(dir, MARKER);
}
export function clearRestartMarker(dir: string): void {
	remove(dir, MARKER);
}
/** Increment the boot-attempt counter and persist; returns the updated marker. */
export function bumpRestartAttempts(dir: string): RestartMarker | undefined {
	const marker = readRestartMarker(dir);
	if (!marker) return undefined;
	const updated: RestartMarker = { ...marker, attempts: marker.attempts + 1 };
	writeRestartMarker(dir, updated);
	return updated;
}

// --- rolled-back flag ------------------------------------------------------
export function writeRolledBackFlag(dir: string, flag: RolledBackFlag): void {
	writeJson(dir, ROLLED_BACK, flag);
}
export function readRolledBackFlag(dir: string): RolledBackFlag | undefined {
	return readJson<RolledBackFlag>(dir, ROLLED_BACK);
}
export function clearRolledBackFlag(dir: string): void {
	remove(dir, ROLLED_BACK);
}

// --- last-good commit ------------------------------------------------------
export function writeLastGoodCommit(dir: string, commit: string): void {
	mkdirSync(dir, { recursive: true });
	const target = join(dir, LAST_GOOD);
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, `${commit.trim()}\n`, "utf8");
	renameSync(tmp, target);
}
export function readLastGoodCommit(dir: string): string | undefined {
	const path = join(dir, LAST_GOOD);
	if (!existsSync(path)) return undefined;
	try {
		const v = readFileSync(path, "utf8").trim();
		return v || undefined;
	} catch {
		return undefined;
	}
}

/**
 * The launcher's rollback decision: revert only after the new code has failed to
 * boot healthy more than `maxAttempts` times, and only if we have a target.
 */
export function shouldRollback(marker: RestartMarker, maxAttempts: number): boolean {
	return marker.attempts > maxAttempts && typeof marker.rollbackTo === "string" && marker.rollbackTo.length > 0;
}
