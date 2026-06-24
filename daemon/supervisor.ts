/**
 * Supervisor — the dumb babysitter that keeps the resident agent alive and fed.
 *
 * Responsibilities (and nothing more — zero LLM logic):
 *  - spawn the RPC client; respawn with exponential backoff on exit, resetting
 *    the backoff after a stable run;
 *  - drain the trigger inbox on a poll and forward each trigger to the agent;
 *  - write daemon-status.json so /status and the dashboard can see health.
 *
 * Timers and clock are injectable so restart/backoff behaviour is tested
 * deterministically without real waits.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { backoffDelay } from "./backoff.ts";
import type { Trigger } from "./inbox.ts";
import type { RpcClient } from "./rpc-client.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

export type SupervisorOptions = {
	createClient: () => RpcClient;
	inbox: { drain(): Trigger[] };
	statusPath: string;
	instance?: string;
	/** Inbox poll interval (ms). 0 disables the auto-poll (tests call pollInbox). */
	pollMs?: number;
	/** Status-write interval (ms). 0 disables the periodic write. */
	statusMs?: number;
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => TimerHandle;
	clearTimer?: (handle: TimerHandle) => void;
	/** Hook invoked for each forwarded trigger (e.g. to record a decision). */
	onForward?: (trigger: Trigger) => void;
	/** A run longer than this (ms) resets the restart backoff. */
	stableResetMs?: number;
};

type LastTrigger = { text: string; source?: string; at: string };

export class Supervisor {
	private readonly o: Required<
		Omit<SupervisorOptions, "onForward" | "instance">
	> &
		Pick<SupervisorOptions, "onForward" | "instance">;
	private client: RpcClient | undefined;
	private stopping = false;
	private restarts = 0;
	private consecutiveFailures = 0;
	private startedAtMs = 0;
	private lastTrigger: LastTrigger | undefined;
	private pollHandle: TimerHandle | undefined;
	private statusHandle: TimerHandle | undefined;
	private restartHandle: TimerHandle | undefined;

	constructor(options: SupervisorOptions) {
		this.o = {
			createClient: options.createClient,
			inbox: options.inbox,
			statusPath: options.statusPath,
			pollMs: options.pollMs ?? 1000,
			statusMs: options.statusMs ?? 10_000,
			now: options.now ?? Date.now,
			setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
			clearTimer: options.clearTimer ?? ((h) => clearTimeout(h)),
			stableResetMs: options.stableResetMs ?? 60_000,
			onForward: options.onForward,
			instance: options.instance,
		};
	}

	start(): void {
		this.stopping = false;
		this.spawnClient();
		if (this.o.pollMs > 0) {
			this.pollHandle = setInterval(() => this.pollInbox(), this.o.pollMs);
		}
		if (this.o.statusMs > 0) {
			this.statusHandle = setInterval(() => this.writeStatus(), this.o.statusMs);
		}
		this.writeStatus();
	}

	async stop(): Promise<void> {
		this.stopping = true;
		if (this.pollHandle) clearInterval(this.pollHandle);
		if (this.statusHandle) clearInterval(this.statusHandle);
		if (this.restartHandle) this.o.clearTimer(this.restartHandle);
		await this.client?.stop();
		this.client = undefined;
		this.writeStatus();
	}

	/** Drain the inbox and forward each trigger. Public for deterministic tests. */
	pollInbox(): void {
		const fresh = this.o.inbox.drain();
		if (fresh.length === 0) return;
		for (const trigger of fresh) {
			this.client?.submit(trigger.text);
			this.lastTrigger = {
				text: trigger.text,
				source: trigger.source,
				at: trigger.ts ?? new Date(this.o.now()).toISOString(),
			};
			this.o.onForward?.(trigger);
		}
		this.writeStatus();
	}

	private spawnClient(): void {
		const client = this.o.createClient();
		this.client = client;
		this.startedAtMs = this.o.now();
		client.on("exit", () => this.handleExit());
		client.on("agent_end", () => this.writeStatus());
		client.start();
	}

	private handleExit(): void {
		this.client = undefined;
		if (this.stopping) return;
		this.restarts += 1;
		const uptime = this.o.now() - this.startedAtMs;
		this.consecutiveFailures =
			uptime >= this.o.stableResetMs ? 1 : this.consecutiveFailures + 1;
		const delay = backoffDelay(this.consecutiveFailures);
		this.writeStatus();
		this.restartHandle = this.o.setTimer(() => {
			if (!this.stopping) this.spawnClient();
		}, delay);
	}

	private writeStatus(): void {
		const status = {
			instance: this.o.instance,
			pid: this.client?.pid,
			startedAt: new Date(this.startedAtMs || this.o.now()).toISOString(),
			restarts: this.restarts,
			healthy: this.client?.running ?? false,
			...(this.lastTrigger ? { lastTrigger: this.lastTrigger.at, lastTriggerText: this.lastTrigger.text } : {}),
		};
		try {
			mkdirSync(dirname(this.o.statusPath), { recursive: true });
			writeFileSync(this.o.statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
		} catch {
			// status is best-effort observability
		}
	}
}
