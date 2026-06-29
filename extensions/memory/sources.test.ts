import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaude, parseCodex, parsePi, repoSlug } from "./sources";

let dir: string;
const write = (name: string, lines: unknown[]) => {
	const p = join(dir, name);
	writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
	return p;
};
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "sources-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("parseClaude", () => {
	it("extracts user+assistant text and cwd, skipping metadata records", () => {
		const f = write("c.jsonl", [
			{ type: "last-prompt", leafUuid: "x" },
			{ type: "user", cwd: "/home/tvd/agent-skills", sessionId: "S1", message: { role: "user", content: "run bun test" } },
			{ type: "mode", mode: "x" },
			{ type: "assistant", cwd: "/home/tvd/agent-skills", message: { role: "assistant", content: [{ type: "thinking", text: "hmm" }, { type: "text", text: "ok will do" }] } },
		]);
		const s = parseClaude(f);
		expect(s.cwd).toBe("/home/tvd/agent-skills");
		expect(s.sessionId).toBe("S1");
		expect(s.messages).toEqual([
			{ role: "user", content: "run bun test" },
			{ role: "assistant", content: "hmmok will do" },
		]);
	});
});

describe("parseCodex", () => {
	it("extracts response_item messages (skipping developer/system) + meta cwd/id", () => {
		const f = write("rollout-x.jsonl", [
			{ type: "session_meta", payload: { id: "CDX1", cwd: "/home/tvd/dev/foo" } },
			{ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "system" }] } },
			{ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello codex" }] } },
			{ type: "event_msg", payload: { type: "task_started" } },
			{ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi there" }] } },
		]);
		const s = parseCodex(f);
		expect(s.sessionId).toBe("CDX1");
		expect(s.cwd).toBe("/home/tvd/dev/foo");
		expect(s.messages).toEqual([
			{ role: "user", content: "hello codex" },
			{ role: "assistant", content: "hi there" },
		]);
	});
});

describe("parsePi", () => {
	it("extracts message records + session cwd/id", () => {
		const f = write("p.jsonl", [
			{ type: "session", id: "PI1", cwd: "/home/tvd/agent-skills" },
			{ type: "model_change", modelId: "x" },
			{ type: "message", role: "user", content: "pi prompt" },
			{ type: "message", role: "assistant", content: [{ type: "text", text: "pi reply" }] },
		]);
		const s = parsePi(f);
		expect(s.sessionId).toBe("PI1");
		expect(s.messages).toEqual([
			{ role: "user", content: "pi prompt" },
			{ role: "assistant", content: "pi reply" },
		]);
	});
});

describe("repoSlug", () => {
	it("derives a slug from cwd, handling worktrees", () => {
		expect(repoSlug("/home/tvd/agent-skills")).toBe("agent-skills");
		expect(repoSlug("/home/tvd/.pi-worktrees/lleverage/e21bbed8")).toBe("lleverage");
		expect(repoSlug("/home/tvd/dev/lleverage-ai/lleverage")).toBe("lleverage");
		expect(repoSlug(undefined)).toBe("unknown");
	});
});
