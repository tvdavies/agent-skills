/**
 * TADU control — the write side of the spine (the adapter in extensions/lib/tadu
 * is read-only). Thin wrappers over the `tadu` CLI, run in the central workspace,
 * so the worker pool can drive a task's lifecycle: move it across lanes and
 * append outcome comments (the decision log).
 *
 * Best-effort: a missing `tadu` binary or absent workspace must never break the
 * pool — visibility degrades, work continues. The runner is injectable so the
 * pool is tested without the CLI.
 */

import { spawnSync } from "node:child_process";
import { agentTaduEnv } from "../extensions/lib/tadu-actor.ts";
import { taduRoot } from "../extensions/lib/tadu.ts";

export type TaduRunner = (args: string[]) => { status: number | null; stdout: string; stderr: string };

const defaultRunner: TaduRunner = (args) => {
	// Stamp the agent actor so the watch loop never mistakes the pool's own lane
	// moves / decision comments for human control input (echo-loop guard).
	const r = spawnSync("tadu", args, { cwd: taduRoot(), encoding: "utf8", timeout: 5000, env: agentTaduEnv() });
	return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

export type TaduControl = {
	move: (taskId: string, status: string) => boolean;
	comment: (taskId: string, text: string) => boolean;
};

/** Build a TADU control surface. Pass a runner in tests; defaults to the CLI. */
export function taduControl(runner: TaduRunner = defaultRunner): TaduControl {
	const run = (args: string[]): boolean => {
		try {
			return runner(args).status === 0;
		} catch {
			return false;
		}
	};
	return {
		move: (taskId, status) => run(["move", taskId, status]),
		comment: (taskId, text) => run(["comment", taskId, text]),
	};
}
