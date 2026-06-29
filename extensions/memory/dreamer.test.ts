import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrainEngine } from "./engine";
import { runDream, type SourceConfig } from "./dreamer";

let root: string;
let claudeDir: string;
let extracts: Array<{ sessionId: string; system?: string; count: number }>;
let commits: number;

function fakeEngine(perSession = 2): BrainEngine {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: test double
		memory: {} as any,
		root,
		scope: "agent",
		async recall() {
			return { block: "", count: 0 };
		},
		async extract(messages, opts) {
			const sys = messages.find((m) => m.role === "system")?.content;
			extracts.push({ sessionId: opts.sessionId, system: sys, count: perSession });
			return Array.from({ length: perSession }, (_, i) => ({ i }));
		},
		async remember() {
			return [];
		},
		commit() {
			commits += 1;
		},
	};
}

const writeClaude = (name: string, turns: number, cwd: string) => {
	const lines: string[] = [];
	for (let i = 0; i < turns; i += 1) {
		lines.push(JSON.stringify({ type: "user", cwd, message: { role: "user", content: `q${i} about the codebase` } }));
		lines.push(JSON.stringify({ type: "assistant", cwd, message: { role: "assistant", content: [{ type: "text", text: `a${i}` }] } }));
	}
	writeFileSync(join(claudeDir, name), `${lines.join("\n")}\n`);
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "dream-"));
	claudeDir = join(root, "claude");
	mkdirSync(claudeDir, { recursive: true });
	process.env.AGENT_TOOLKIT_STATE_DIR = root; // cursors land under root/.ingest-cursors
	extracts = [];
	commits = 0;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	delete process.env.AGENT_TOOLKIT_STATE_DIR;
});

const sources = (): SourceConfig[] => [{ kind: "claude", dirs: [claudeDir], match: /\.jsonl$/ }];

describe("runDream", () => {
	it("ingests sessions, prepends repo provenance, and is cursor-resumable", async () => {
		writeClaude("s1.jsonl", 3, "/home/tvd/agent-skills");
		writeClaude("s2.jsonl", 3, "/home/tvd/.pi-worktrees/lleverage/abc");

		const r1 = await runDream({ engine: fakeEngine(2), sources: sources(), maxSessions: 50 });
		expect(r1.ingested).toBe(2);
		expect(r1.memories).toBe(4);
		// provenance + repo slug threaded into the extraction.
		expect(extracts.find((e) => e.sessionId.includes("agent-skills"))?.system).toContain('repo "agent-skills"');
		expect(extracts.some((e) => e.sessionId.includes("lleverage"))).toBe(true);
		expect(commits).toBeGreaterThan(0);

		// Second run: cursor skips everything already ingested.
		extracts = [];
		const r2 = await runDream({ engine: fakeEngine(2), sources: sources(), maxSessions: 50 });
		expect(r2.ingested).toBe(0);
		expect(r2.skipped).toBe(2);
		expect(extracts.length).toBe(0);
	});

	it("respects maxSessions (newest first) and re-ingests the rest next run", async () => {
		for (let i = 0; i < 5; i += 1) writeClaude(`s${i}.jsonl`, 2, "/home/tvd/agent-skills");
		const r1 = await runDream({ engine: fakeEngine(1), sources: sources(), maxSessions: 2 });
		expect(r1.ingested).toBe(2);
		const r2 = await runDream({ engine: fakeEngine(1), sources: sources(), maxSessions: 10 });
		expect(r2.ingested).toBe(3); // the remaining three
	});

	it("skips sessions below the message floor without re-revisiting them", async () => {
		writeClaude("tiny.jsonl", 1, "/home/tvd/agent-skills"); // 2 messages < minMessages 4
		const r = await runDream({ engine: fakeEngine(), sources: sources(), maxSessions: 50, minMessages: 4 });
		expect(r.ingested).toBe(0);
		expect(extracts.length).toBe(0);
		// marked done → not revisited
		const r2 = await runDream({ engine: fakeEngine(), sources: sources(), maxSessions: 50, minMessages: 4 });
		expect(r2.skipped).toBe(1);
	});
});
