/**
 * Notify-watcher — delivers the push channel to Slack.
 *
 * Extensions append escalations to notify.jsonl (rate-limited by the notify
 * lib). This watcher tails new notices and posts them to a Slack channel. On
 * start it skips the existing backlog (it only delivers what happens from now),
 * so a restart never re-pings old notices.
 *
 * Quiet hours (do-not-disturb): inside the configured window, routine notices
 * are HELD instead of delivered live, then flushed as a single batch when the
 * window ends — so you wake to one summary, not a night of pings. Escalations
 * always break through immediately. Holding is delivery-only: notices are still
 * recorded to the spine and notify.jsonl, so nothing is lost.
 *
 * The `post` function and clock are injected, so this is tested without Slack.
 */

import { type Notice, readNotices } from "../extensions/lib/notify.ts";
import { type HoursWindow, quietHoursDelivery } from "../extensions/lib/quiet-hours.ts";

export type NotifyWatcherOptions = {
	/** Deliver a formatted notice (e.g. to Slack). */
	post: (text: string) => void | Promise<void>;
	intervalMs?: number;
	/** Do-not-disturb window; routine notices are held inside it. */
	quietHours?: HoursWindow;
	/** Injected clock (defaults to Date.now), for testability. */
	now?: () => number;
	logger?: (message: string) => void;
};

export class NotifyWatcher {
	private readonly o: NotifyWatcherOptions;
	private cursor = 0;
	private held: Notice[] = [];
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(options: NotifyWatcherOptions) {
		this.o = options;
	}

	/** Begin watching, skipping the current backlog. */
	start(): void {
		this.cursor = readNotices().length;
		this.timer = setInterval(() => this.pollOnce(), this.o.intervalMs ?? 2000);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	/** Deliver notices appended since the last poll, honouring quiet hours. Public for tests. */
	pollOnce(): void {
		const now = new Date(this.o.now?.() ?? Date.now());
		const all = readNotices();
		if (all.length > this.cursor) {
			const fresh = all.slice(this.cursor);
			this.cursor = all.length;
			for (const notice of fresh) {
				if (quietHoursDelivery(notice.kind, this.o.quietHours, now) === "hold") {
					this.held.push(notice);
				} else {
					this.deliver(formatNotice(notice.summary, notice.kind));
				}
			}
		}
		// Flush anything held overnight once the window has ended (runs every poll,
		// so it fires even on a tick with no fresh notices).
		if (this.held.length && !this.inQuietHours(now)) {
			const batch = this.held;
			this.held = [];
			this.deliver(formatHeldBatch(batch));
		}
	}

	/** Whether a routine notice would be held right now (single source of window logic). */
	private inQuietHours(now: Date): boolean {
		return quietHoursDelivery("info", this.o.quietHours, now) === "hold";
	}

	private deliver(text: string): void {
		void Promise.resolve(this.o.post(text)).catch(() => this.o.logger?.("[notify] delivery failed"));
	}
}

function formatNotice(summary: string, kind: string): string {
	const icon = kind === "escalate" ? "⚠️" : "ℹ️";
	return `${icon} ${summary}`;
}

function formatHeldBatch(notices: Notice[]): string {
	if (notices.length === 1 && notices[0]) return formatNotice(notices[0].summary, notices[0].kind);
	const lines = notices.map((n) => `• ${n.summary}`);
	return `🌙 Held overnight (${notices.length}):\n${lines.join("\n")}`;
}
