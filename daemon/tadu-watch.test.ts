import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { AGENT_ACTOR } from "../extensions/lib/tadu-actor";
import type { TaduEvent } from "../extensions/lib/tadu";
import { TaduWatcher } from "./tadu-watch";

class FakeChild extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	killed = false;
	kill(_signal?: string): boolean {
		this.killed = true;
		return true;
	}
	/** Push one event as a framed JSON line. */
	line(obj: Record<string, unknown>): void {
		this.stdout.emit("data", Buffer.from(`${JSON.stringify(obj)}\n`));
	}
	/** Push a raw stdout chunk (for framing tests). */
	chunk(text: string): void {
		this.stdout.emit("data", Buffer.from(text));
	}
	exit(): void {
		this.emit("exit", 0, null);
	}
}

type Harness = {
	watcher: TaduWatcher;
	children: FakeChild[];
	events: TaduEvent[];
	human: TaduEvent[];
	fireRestart: () => void;
};

function harness(): Harness {
	const children: FakeChild[] = [];
	const events: TaduEvent[] = [];
	const human: TaduEvent[] = [];
	let pendingRestart: (() => void) | undefined;
	const watcher = new TaduWatcher({
		cwd: "/work",
		spawn: () => {
			const child = new FakeChild();
			children.push(child);
			return child as unknown as ChildProcess;
		},
		onEvent: (e) => events.push(e),
		onHumanEvent: (e) => human.push(e),
		now: () => 1000, // fixed clock: uptime ~0, so backoff just keeps climbing
		setTimer: (fn) => {
			pendingRestart = fn;
			return 0 as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: () => {
			pendingRestart = undefined;
		},
	});
	return { watcher, children, events, human, fireRestart: () => pendingRestart?.() };
}

const moved = (seq: number, actor: string, to = "in-progress") => ({
	seq,
	time: "t",
	type: "task.moved",
	task: "TASK-1",
	actor,
	data: { from: "ready", to },
});

describe("TaduWatcher", () => {
	it("routes human lane moves and comments to onHumanEvent, the agent's own writes only to onEvent", () => {
		const h = harness();
		h.watcher.start();
		const child = h.children[0]!;
		child.line(moved(1, AGENT_ACTOR)); // agent's own move — echo, must be ignored by the loop
		child.line(moved(2, "Tom Davies")); // human drag
		child.line({ seq: 3, time: "t", type: "task.commented", task: "TASK-1", actor: "Tom Davies" });
		child.line({ seq: 4, time: "t", type: "task.created", task: "TASK-2", actor: "Tom Davies" }); // not a control type

		expect(h.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
		expect(h.human.map((e) => e.seq)).toEqual([2, 3]);
		h.watcher.stop();
	});

	it("frames events split across stdout chunk boundaries (strict-LF, no readline)", () => {
		const h = harness();
		h.watcher.start();
		const child = h.children[0]!;
		child.chunk(`${JSON.stringify(moved(1, "Tom Davies"))}\n${JSON.stringify(moved(2, "Tom Davies")).slice(0, 10)}`);
		child.chunk(`${JSON.stringify(moved(2, "Tom Davies")).slice(10)}\n`);
		expect(h.events.map((e) => e.seq)).toEqual([1, 2]);
		h.watcher.stop();
	});

	it("ignores already-seen sequence numbers (idempotent across a replay)", () => {
		const h = harness();
		h.watcher.start();
		const child = h.children[0]!;
		child.line(moved(1, "Tom Davies"));
		child.line(moved(2, "Tom Davies"));
		child.line(moved(1, "Tom Davies")); // stale duplicate
		child.line(moved(3, "Tom Davies"));
		expect(h.events.map((e) => e.seq)).toEqual([1, 2, 3]);
		h.watcher.stop();
	});

	it("restarts the stream with backoff when the watch process exits", () => {
		const h = harness();
		h.watcher.start();
		expect(h.children).toHaveLength(1);
		h.children[0]!.exit();
		expect(h.watcher.running).toBe(false);
		h.fireRestart();
		expect(h.children).toHaveLength(2);
		expect(h.watcher.running).toBe(true);
		// the fresh stream is live
		h.children[1]!.line(moved(5, "Tom Davies"));
		expect(h.human.map((e) => e.seq)).toEqual([5]);
		h.watcher.stop();
	});

	it("treats an async spawn error (ENOENT) as a termination that backs off, not a throw", () => {
		const h = harness();
		h.watcher.start();
		h.children[0]!.emit("error", new Error("spawn tadu ENOENT"));
		expect(h.watcher.running).toBe(false);
		h.fireRestart();
		expect(h.children).toHaveLength(2);
		h.watcher.stop();
	});

	it("stop() kills the child and prevents any further restart", () => {
		const h = harness();
		h.watcher.start();
		const child = h.children[0]!;
		h.watcher.stop();
		expect(child.killed).toBe(true);
		// an exit after stop must not schedule or fire a restart
		child.exit();
		h.fireRestart();
		expect(h.children).toHaveLength(1);
	});
});
