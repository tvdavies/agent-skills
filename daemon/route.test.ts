import { describe, expect, it } from "bun:test";
import { classifyTrigger } from "./route";
import type { Trigger } from "./inbox";

const base = (over: Partial<Trigger>): Trigger => ({ id: "t1", text: "do a thing", ...over });

describe("classifyTrigger", () => {
	it("delegates a trigger carrying a TADU task to a worker", () => {
		expect(classifyTrigger(base({ taduTask: "TASK-0001" }))).toBe("worker");
	});

	it("keeps heartbeats on the orchestrator even if a task is attached", () => {
		expect(classifyTrigger(base({ text: "[heartbeat] run the checklist", taduTask: "TASK-0002" }))).toBe(
			"orchestrator",
		);
	});

	it("keeps reply-expecting (origin) triggers on the orchestrator", () => {
		expect(classifyTrigger(base({ taduTask: "TASK-0003", origin: { kind: "slack", channel: "C1" } }))).toBe(
			"orchestrator",
		);
	});

	it("defaults to the orchestrator when there is no task", () => {
		expect(classifyTrigger(base({ source: "dashboard" }))).toBe("orchestrator");
	});
});
