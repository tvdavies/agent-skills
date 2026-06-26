/**
 * Launcher preflight — the self-update rollback guard.
 *
 * Run by the launcher (launch.sh) on EVERY (re)start, before the daemon, with the
 * cwd set to the checkout. When a self-update restart is in flight it increments the
 * boot-attempt counter; once the new code has failed to boot more than the allowed
 * number of times it reverts the checkout to the recorded last-good commit and leaves
 * a flag the (now old-code) daemon reads to tell the human.
 *
 * CRITICAL: this is the safety net, so it must keep working even when the agent's
 * change has broken arbitrary repo modules. It therefore imports NOTHING from the
 * repo — only Node stdlib — and reads/writes the same on-disk records as
 * extensions/lib/update.ts by hand. It must never throw; a preflight failure just
 * means the daemon starts whatever is checked out.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// NaN/negative misconfiguration must not make rollback fire on the first boot.
const RAW_MAX = Number(process.env.AGENT_TOOLKIT_SELF_UPDATE_MAX_ATTEMPTS ?? 2);
const MAX_ATTEMPTS = Number.isFinite(RAW_MAX) && RAW_MAX >= 0 ? RAW_MAX : 2;

// Resolve the state dir exactly as extensions/lib/decisions.ts stateDir() does.
function stateDir(): string {
	return process.env.AGENT_TOOLKIT_STATE_DIR ?? join(homedir(), ".local", "state", "agent-toolkit");
}

type Marker = { rollbackTo?: string; appliedCommit?: string; reason?: string; attempts?: number };

function rollback(dir: string, target: string, from: string | undefined, reason: string): void {
	const reset = spawnSync("git", ["reset", "--hard", target], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 });
	const flag = { reason, from, to: target, ts: new Date().toISOString() };
	writeFileSync(join(dir, "self-update-rolledback.json"), `${JSON.stringify(flag, null, 2)}\n`, "utf8");
	rmSync(join(dir, "self-update-restart.json"), { force: true });
	console.error(`[preflight] self-update "${reason}" failing to boot; ${reset.status === 0 ? "rolled back" : "ROLLBACK FAILED"} to ${target.slice(0, 8)}`);
}

function main(): void {
	try {
		const dir = stateDir();
		const markerPath = join(dir, "self-update-restart.json");
		if (!existsSync(markerPath)) return; // not mid-update — normal start

		let marker: Marker;
		try {
			marker = JSON.parse(readFileSync(markerPath, "utf8")) as Marker;
		} catch {
			// A corrupt marker must not freeze the rollback. Fall back to the
			// independently-stored last-good commit if we have one.
			const lastGoodPath = join(dir, "self-update-lastgood");
			const target = existsSync(lastGoodPath) ? readFileSync(lastGoodPath, "utf8").trim() : "";
			if (target) rollback(dir, target, undefined, "corrupt self-update marker");
			else rmSync(markerPath, { force: true });
			return;
		}

		const attempts = (typeof marker.attempts === "number" ? marker.attempts : 0) + 1;
		marker.attempts = attempts;
		writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");

		const target = marker.rollbackTo;
		if (attempts <= MAX_ATTEMPTS || !target) {
			console.error(`[preflight] self-update boot attempt ${attempts}/${MAX_ATTEMPTS} for "${marker.reason ?? "?"}"`);
			return; // let the daemon try (or re-try) the new code
		}

		// The new code has failed to boot too many times — revert the checkout.
		rollback(dir, target, marker.appliedCommit, marker.reason ?? "self-update");
	} catch (e) {
		// Never block startup.
		console.error(`[preflight] error (continuing): ${(e as Error).message}`);
	}
}

main();
