import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHoursWindow } from "../extensions/heartbeat/schedule-gate";
import { notify } from "../extensions/lib/notify";
import { NotifyWatcher } from "./notify-watcher";

const budget = { maxPerWindow: 100, windowMs: 10_000, minGapMs: 0 };
const quietHours = parseHoursWindow("23:00-07:00");
const at = (h: number, m = 0) => new Date(2026, 5, 24, h, m, 0).getTime();
let dir: string;
let posted: string[];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "nw-"));
	process.env.AGENT_TOOLKIT_STATE_DIR = dir;
	posted = [];
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	delete process.env.AGENT_TOOLKIT_STATE_DIR;
});

describe("NotifyWatcher", () => {
	it("delivers newly-appended notices once", () => {
		const watcher = new NotifyWatcher({ post: (t) => { posted.push(t); }});
		notify({ summary: "one" }, { now: 1000, budget });
		notify({ summary: "two" }, { now: 1100, budget });
		watcher.pollOnce();
		expect(posted).toHaveLength(2);
		expect(posted[0]).toContain("one");
		// Already-delivered notices are not re-sent.
		watcher.pollOnce();
		expect(posted).toHaveLength(2);
		notify({ summary: "three" }, { now: 1200, budget });
		watcher.pollOnce();
		expect(posted).toEqual([expect.stringContaining("one"), expect.stringContaining("two"), expect.stringContaining("three")]);
	});

	it("start() skips the existing backlog", () => {
		notify({ summary: "old" }, { now: 1000, budget });
		const watcher = new NotifyWatcher({ post: (t) => { posted.push(t); }});
		watcher.start();
		try {
			notify({ summary: "new" }, { now: 1100, budget });
			watcher.pollOnce();
			expect(posted).toEqual([expect.stringContaining("new")]);
		} finally {
			watcher.stop();
		}
	});

	it("holds routine notices during quiet hours, flushing one batch when the window ends", () => {
		let clock = at(2, 0); // 02:00 — inside the window
		const watcher = new NotifyWatcher({ post: (t) => { posted.push(t); }, quietHours, now: () => clock });
		notify({ summary: "routine one", kind: "info" }, { now: 1000, budget });
		notify({ summary: "routine two", kind: "info" }, { now: 1100, budget });
		watcher.pollOnce();
		expect(posted).toHaveLength(0); // both held, nothing pinged overnight

		clock = at(7, 1); // 07:01 — window has ended
		watcher.pollOnce();
		expect(posted).toHaveLength(1);
		expect(posted[0]).toContain("Held overnight (2)");
		expect(posted[0]).toContain("routine one");
		expect(posted[0]).toContain("routine two");
	});

	it("lets escalations break through quiet hours immediately", () => {
		const clock = at(3, 0); // inside the window
		const watcher = new NotifyWatcher({ post: (t) => { posted.push(t); }, quietHours, now: () => clock });
		notify({ summary: "urgent", kind: "escalate" }, { now: 1000, budget });
		watcher.pollOnce();
		expect(posted).toEqual([expect.stringContaining("urgent")]);
	});

	it("flushes a single held notice without the batch header", () => {
		let clock = at(2, 0);
		const watcher = new NotifyWatcher({ post: (t) => { posted.push(t); }, quietHours, now: () => clock });
		notify({ summary: "lonely", kind: "info" }, { now: 1000, budget });
		watcher.pollOnce();
		expect(posted).toHaveLength(0);
		clock = at(8, 0);
		watcher.pollOnce();
		expect(posted).toEqual([expect.stringContaining("lonely")]);
		expect(posted[0]).not.toContain("Held overnight");
	});
});
