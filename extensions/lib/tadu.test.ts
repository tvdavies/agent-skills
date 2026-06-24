import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTask, listTasks, readConfig, readEvents, workspaceExists } from "./tadu";

let root: string;

function writeFixture() {
	const d = join(root, ".tadu");
	mkdirSync(join(d, "tasks", "TASK-0001-fix-login", "comments"), { recursive: true });
	mkdirSync(join(d, "tasks", "TASK-0002-write-docs"), { recursive: true });
	writeFileSync(join(d, "config.yaml"), "statuses:\n  - backlog\n  - in-progress\n  - done\nterminal:\n  - done\n");
	writeFileSync(
		join(d, "tasks", "TASK-0001-fix-login", "task.md"),
		"---\nid: TASK-0001\ntitle: Fix login\nstatus: in-progress\nlabels:\n  - bug\ncreated_at: 2026-06-24T10:00:00Z\nupdated_at: 2026-06-24T12:00:00Z\n---\nThe login cache omits pwdVersion.\n",
	);
	writeFileSync(
		join(d, "tasks", "TASK-0001-fix-login", "comments", "0001--2026-06-24T11-00-00Z.md"),
		"---\ncreated_at: 2026-06-24T11:00:00Z\n---\nFound the root cause.\n",
	);
	writeFileSync(
		join(d, "tasks", "TASK-0002-write-docs", "task.md"),
		"---\nid: TASK-0002\ntitle: Write docs\nstatus: backlog\nlabels: []\ncreated_at: 2026-06-24T09:00:00Z\nupdated_at: 2026-06-24T09:00:00Z\n---\n",
	);
	writeFileSync(
		join(d, "events.jsonl"),
		'{"seq":1,"time":"2026-06-24T10:00:00Z","type":"task.created","task":"TASK-0001","actor":"agent"}\n{"seq":2,"time":"2026-06-24T11:00:00Z","type":"task.commented","task":"TASK-0001"}\n',
	);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "tadu-"));
	process.env.AGENT_TOOLKIT_TADU_ROOT = root;
	writeFixture();
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	delete process.env.AGENT_TOOLKIT_TADU_ROOT;
});

describe("tadu adapter", () => {
	it("detects the workspace and reads the status lanes", () => {
		expect(workspaceExists()).toBe(true);
		expect(readConfig().statuses).toEqual(["backlog", "in-progress", "done"]);
		expect(readConfig().terminal).toEqual(["done"]);
	});

	it("lists tasks newest-updated first with parsed frontmatter", () => {
		const tasks = listTasks();
		expect(tasks.map((t) => t.id)).toEqual(["TASK-0001", "TASK-0002"]);
		expect(tasks[0]).toMatchObject({ title: "Fix login", status: "in-progress", labels: ["bug"] });
	});

	it("reads a task with its description and comments", () => {
		const task = getTask("TASK-0001");
		expect(task?.description).toContain("pwdVersion");
		expect(task?.comments).toHaveLength(1);
		expect(task?.comments[0]?.text).toContain("root cause");
		expect(getTask("TASK-9999")).toBeUndefined();
	});

	it("reads the event log", () => {
		const events = readEvents();
		expect(events).toHaveLength(2);
		expect(events[0]?.type).toBe("task.created");
	});

	it("returns sensible defaults with no workspace", () => {
		delete process.env.AGENT_TOOLKIT_TADU_ROOT;
		process.env.AGENT_TOOLKIT_TADU_ROOT = join(root, "nope");
		expect(workspaceExists()).toBe(false);
		expect(listTasks()).toEqual([]);
		expect(readConfig().statuses.length).toBeGreaterThan(0);
	});
});
