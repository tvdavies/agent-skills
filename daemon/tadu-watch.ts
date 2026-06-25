/**
 * TADU watcher — the read side of the control plane.
 *
 * `tadu watch --json` push-streams every new event as one JSON line the moment it
 * is appended (no polling). The daemon runs it so a human acting on the board —
 * dragging a card between lanes, commenting on a task — is observed live and can
 * steer in-flight work.
 *
 * This module owns only the plumbing: spawn the streamer, frame its stdout with
 * the strict-LF JSONL framer (shared with the RPC client, because the U+2028/U+2029
 * caveat applies equally here), restart it with backoff if it dies, and hand each
 * parsed event to callbacks. It deliberately holds no policy — the daemon supplies
 * an `onHumanEvent` handler that decides what a drag or comment means, so the
 * (eventual) control loop drops straight into that seam.
 *
 * The watcher streams events appended *after* it starts (no `--from-start`): on
 * boot the daemon already reconciles existing state, and replaying the whole
 * history would re-fire stale human actions. A monotonic `seq` guard makes the
 * stream idempotent across restarts. The spawn is injected so the lifecycle
 * (filtering, restart, stop) is tested without the `tadu` binary.
 */

import { type ChildProcess, type SpawnOptions, spawn as nodeSpawn } from "node:child_process";
import type { TaduEvent } from "../extensions/lib/tadu.ts";
import { isHumanControlEvent } from "../extensions/lib/tadu-actor.ts";
import { backoffDelay } from "./backoff.ts";
import { JsonlFramer, parseLine } from "./framing.ts";

type SpawnLike = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type TimerHandle = ReturnType<typeof setTimeout>;

export type TaduWatcherOptions = {
	/** Workspace root the `tadu` CLI runs in (taduRoot()). */
	cwd: string;
	/** The `tadu` binary; overridable for tests. Default "tadu". */
	command?: string;
	spawn?: SpawnLike;
	/** Every parsed event, in order (both origins). */
	onEvent?: (event: TaduEvent) => void;
	/** Only human-initiated control events (lane drag / comment) — the control-loop seam. */
	onHumanEvent?: (event: TaduEvent) => void;
	logger?: (message: string) => void;
	setTimer?: (fn: () => void, ms: number) => TimerHandle;
	clearTimer?: (handle: TimerHandle) => void;
	now?: () => number;
	/** A run longer than this (ms) resets the restart backoff. Default 60s. */
	stableResetMs?: number;
};

export class TaduWatcher {
	private child: ChildProcess | undefined;
	private framer = new JsonlFramer();
	private stopping = false;
	private restarts = 0;
	private consecutiveFailures = 0;
	private startedAtMs = 0;
	private lastSeq = 0;
	private restartHandle: TimerHandle | undefined;
	private readonly o: Required<Omit<TaduWatcherOptions, "onEvent" | "onHumanEvent">> &
		Pick<TaduWatcherOptions, "onEvent" | "onHumanEvent">;

	constructor(options: TaduWatcherOptions) {
		this.o = {
			cwd: options.cwd,
			command: options.command ?? "tadu",
			spawn: options.spawn ?? (nodeSpawn as SpawnLike),
			logger: options.logger ?? (() => {}),
			setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
			clearTimer: options.clearTimer ?? ((h) => clearTimeout(h)),
			now: options.now ?? Date.now,
			stableResetMs: options.stableResetMs ?? 60_000,
			onEvent: options.onEvent,
			onHumanEvent: options.onHumanEvent,
		};
	}

	start(): void {
		this.stopping = false;
		this.spawn();
	}

	/** Stop watching; no further restarts. */
	stop(): void {
		this.stopping = true;
		if (this.restartHandle) this.o.clearTimer(this.restartHandle);
		const child = this.child;
		this.child = undefined;
		if (child) {
			try {
				child.kill("SIGTERM");
			} catch {
				// already gone
			}
		}
	}

	get running(): boolean {
		return this.child !== undefined;
	}

	private spawn(): void {
		// Fresh framer per spawn so a restart never splices a partial line from the
		// dead process onto the new stream.
		this.framer = new JsonlFramer();
		let child: ChildProcess;
		try {
			child = this.o.spawn(this.o.command, ["watch", "--json"], {
				cwd: this.o.cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (err) {
			// A synchronous spawn throw (rare) is just another termination.
			this.o.logger(`[tadu watch spawn error] ${(err as Error).message}`);
			this.scheduleRestart();
			return;
		}
		this.child = child;
		this.startedAtMs = this.o.now();

		child.stdout?.on("data", (chunk: Buffer) => {
			for (const line of this.framer.push(chunk)) this.handleLine(line);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			this.o.logger(`[tadu watch stderr] ${chunk.toString().trimEnd()}`);
		});

		// An async spawn error (ENOENT: tadu not on PATH) arrives as 'error', not
		// 'exit' — treat both as termination so a missing binary backs off instead of
		// throwing an unhandled error that would take the daemon down.
		let terminated = false;
		const terminate = () => {
			if (terminated) return;
			terminated = true;
			for (const line of this.framer.flush()) this.handleLine(line);
			this.child = undefined;
			this.scheduleRestart();
		};
		child.on("error", (err) => {
			this.o.logger(`[tadu watch spawn error] ${err.message}`);
			terminate();
		});
		child.on("exit", () => terminate());
	}

	private handleLine(line: string): void {
		const event = parseLine<TaduEvent>(line);
		if (!event || typeof event.type !== "string") return;
		// Idempotency guard: ignore any event we have already seen (defends against a
		// future replay-on-restart without changing today's from-now behaviour).
		if (typeof event.seq === "number") {
			if (event.seq <= this.lastSeq) return;
			this.lastSeq = event.seq;
		}
		this.o.onEvent?.(event);
		if (isHumanControlEvent(event)) this.o.onHumanEvent?.(event);
	}

	private scheduleRestart(): void {
		if (this.stopping) return;
		this.restarts += 1;
		const uptime = this.o.now() - this.startedAtMs;
		this.consecutiveFailures = uptime >= this.o.stableResetMs ? 1 : this.consecutiveFailures + 1;
		const delay = backoffDelay(this.consecutiveFailures);
		this.o.logger(`[tadu watch] stream ended; restart #${this.restarts} in ${delay}ms`);
		this.restartHandle = this.o.setTimer(() => {
			if (!this.stopping) this.spawn();
		}, delay);
	}
}
