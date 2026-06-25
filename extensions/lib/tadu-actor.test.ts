import { describe, expect, it } from "bun:test";
import {
	actorOrigin,
	AGENT_ACTOR,
	agentTaduEnv,
	CONTROL_EVENT_TYPES,
	isHumanControlEvent,
} from "./tadu-actor";
import type { TaduEvent } from "./tadu";

const ev = (over: Partial<TaduEvent>): TaduEvent => ({ seq: 1, time: "t", type: "task.moved", ...over });

describe("actorOrigin", () => {
	it("classifies the agent's own identity as agent", () => {
		expect(actorOrigin(AGENT_ACTOR)).toBe("agent");
	});

	it("treats every other actor — including the git user and unknown — as human", () => {
		expect(actorOrigin("Tom Davies")).toBe("human");
		expect(actorOrigin("unknown")).toBe("human");
		expect(actorOrigin(undefined)).toBe("human");
		expect(actorOrigin("")).toBe("human");
	});
});

describe("isHumanControlEvent", () => {
	it("is true for a human lane move and a human comment", () => {
		expect(isHumanControlEvent(ev({ type: "task.moved", actor: "Tom Davies" }))).toBe(true);
		expect(isHumanControlEvent(ev({ type: "task.commented", actor: "Tom Davies" }))).toBe(true);
	});

	it("is false for the agent's own move/comment (echo-loop guard)", () => {
		expect(isHumanControlEvent(ev({ type: "task.moved", actor: AGENT_ACTOR }))).toBe(false);
		expect(isHumanControlEvent(ev({ type: "task.commented", actor: AGENT_ACTOR }))).toBe(false);
	});

	it("is false for non-control event types even from a human", () => {
		expect(isHumanControlEvent(ev({ type: "task.created", actor: "Tom Davies" }))).toBe(false);
		expect(isHumanControlEvent(ev({ type: "task.labeled", actor: "Tom Davies" }))).toBe(false);
	});

	it("reacts to exactly the move and comment event types", () => {
		expect([...CONTROL_EVENT_TYPES].sort()).toEqual(["task.commented", "task.moved"]);
	});
});

describe("agentTaduEnv", () => {
	it("stamps TADU_ACTOR with the agent identity", () => {
		expect(agentTaduEnv({}).TADU_ACTOR).toBe(AGENT_ACTOR);
	});

	it("overrides any inherited TADU_ACTOR and preserves the rest of the env", () => {
		const out = agentTaduEnv({ PATH: "/bin", TADU_ACTOR: "Tom Davies" });
		expect(out.TADU_ACTOR).toBe(AGENT_ACTOR);
		expect(out.PATH).toBe("/bin");
	});
});
