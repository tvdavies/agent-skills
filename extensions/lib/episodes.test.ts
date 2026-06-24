import { describe, expect, it } from "bun:test";
import { episodeSummary, parseEpisodes, parseEpisodesFromJsonl } from "./episodes";

const entries = [
	{ type: "session", id: "s", timestamp: "2026-06-24T10:00:00Z" },
	{ type: "message", message: { role: "user", content: [{ type: "text", text: "what's in the README?" }], timestamp: "2026-06-24T10:00:01Z" } },
	{
		type: "message",
		message: {
			role: "assistant",
			model: "gpt-5.5",
			usage: { input: 100, output: 20, cost: { total: 0.001 } },
			stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: "let me read it" },
				{ type: "toolCall", id: "c1", name: "read", arguments: { file_path: "README.md" } },
			],
			timestamp: "2026-06-24T10:00:02Z",
		},
	},
	{ type: "message", message: { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "# Title" }], isError: false, timestamp: "2026-06-24T10:00:03Z" } },
	{
		type: "message",
		message: {
			role: "assistant",
			model: "gpt-5.5",
			usage: { input: 150, output: 30, cost: { total: 0.002 } },
			stopReason: "stop",
			content: [{ type: "text", text: "It's a title." }],
			timestamp: "2026-06-24T10:00:04Z",
		},
	},
	{ type: "message", message: { role: "user", content: [{ type: "text", text: "[heartbeat] run your check" }], timestamp: "2026-06-24T10:30:00Z" } },
	{ type: "message", message: { role: "assistant", model: "gpt-5.5", stopReason: "stop", content: [{ type: "text", text: "All clear." }], timestamp: "2026-06-24T10:30:02Z" } },
];

describe("parseEpisodes", () => {
	it("splits the session into prompt-delimited episodes", () => {
		const eps = parseEpisodes(entries, "sess");
		expect(eps).toHaveLength(2);
		expect(eps[0]?.id).toBe("sess#0");
		expect(eps[1]?.id).toBe("sess#1");
	});

	it("captures prompt, output, model, usage, tool calls, and outcome", () => {
		const [first] = parseEpisodes(entries, "sess");
		expect(first?.prompt).toBe("what's in the README?");
		expect(first?.source).toBe("session");
		expect(first?.assistantText).toBe("It's a title.");
		expect(first?.model).toBe("gpt-5.5");
		expect(first?.usage).toEqual({ input: 250, output: 50, cost: 0.003 });
		expect(first?.toolCalls).toBe(1);
		expect(first?.outcome).toBe("stop");
		// turns: assistant(thinking+toolCall), toolResult, assistant(text)
		expect(first?.turns).toHaveLength(3);
	});

	it("tags heartbeat episodes by their prompt marker", () => {
		const eps = parseEpisodes(entries, "sess");
		expect(eps[1]?.source).toBe("heartbeat");
		expect(eps[1]?.assistantText).toBe("All clear.");
	});

	it("parses from raw JSONL and summarises", () => {
		const jsonl = entries.map((e) => JSON.stringify(e)).join("\n");
		const eps = parseEpisodesFromJsonl(jsonl, "sess");
		const summary = episodeSummary(eps[0] as any);
		expect(summary.prompt).toContain("README");
		expect(summary.output).toContain("title");
		expect(summary.toolCalls).toBe(1);
	});

	it("tolerates malformed lines", () => {
		expect(() => parseEpisodesFromJsonl("not json\n{bad}\n", "s")).not.toThrow();
	});
});
