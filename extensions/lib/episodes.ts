/**
 * Episode parser — turn a pi session JSONL into discrete "episodes".
 *
 * pi sessions are an append-only log of entries; message entries wrap an
 * AgentMessage (user / assistant / toolResult). An episode is one agent run:
 * a user prompt plus the assistant turns (thinking / text / tool calls) and
 * tool results that follow it, until the next user prompt. This is the unit the
 * dashboard renders ("what ran, when, what the agent did and output").
 *
 * Pure (no fs) so it is tested directly and works on any session file — the
 * resident session today, per-worker sessions once the fleet lands.
 */

export type EpisodePart =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "toolCall"; id?: string; name: string; args?: unknown }
	| { kind: "toolResult"; toolName?: string; text: string; isError: boolean };

export type EpisodeTurn = {
	role: "assistant" | "toolResult";
	parts: EpisodePart[];
	timestamp?: string;
};

export type Episode = {
	id: string;
	/** "heartbeat" (by prompt marker) or "session". */
	source: string;
	prompt: string;
	startedAt?: string;
	endedAt?: string;
	model?: string;
	usage: { input?: number; output?: number; cost?: number };
	toolCalls: number;
	/** Last assistant stop reason: stop | toolUse | error | aborted | length. */
	outcome: string;
	/** Concatenated assistant text — the user-visible output. */
	assistantText: string;
	turns: EpisodeTurn[];
};

const HEARTBEAT_MARKER = "[heartbeat]";

function asString(ts: unknown): string | undefined {
	if (typeof ts === "string") return ts;
	if (typeof ts === "number") return new Date(ts).toISOString();
	return undefined;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c) => c && typeof c === "object" && (c as { type?: string }).type === "text")
			.map((c) => String((c as { text?: unknown }).text ?? ""))
			.join("");
	}
	return "";
}

/** Parse already-decoded session entries into episodes. */
export function parseEpisodes(entries: unknown[], sessionId: string): Episode[] {
	const episodes: Episode[] = [];
	let current: Episode | undefined;
	let index = 0;

	for (const entry of entries) {
		const e = entry as { type?: string; message?: any; timestamp?: unknown };
		if (e?.type !== "message" || !e.message) continue;
		const m = e.message as {
			role?: string;
			content?: unknown;
			timestamp?: unknown;
			model?: string;
			usage?: { input?: number; output?: number; cost?: { total?: number } };
			stopReason?: string;
			toolName?: string;
			isError?: boolean;
		};
		const ts = asString(m.timestamp) ?? asString(e.timestamp);

		if (m.role === "user") {
			if (current) episodes.push(current);
			const prompt = extractText(m.content);
			current = {
				id: `${sessionId}#${index++}`,
				source: prompt.trimStart().startsWith(HEARTBEAT_MARKER) ? "heartbeat" : "session",
				prompt,
				startedAt: ts,
				endedAt: ts,
				usage: {},
				toolCalls: 0,
				outcome: "",
				assistantText: "",
				turns: [],
			};
			continue;
		}
		if (!current) continue;

		if (m.role === "assistant") {
			if (m.model) current.model = m.model;
			if (m.usage) {
				current.usage.input = (current.usage.input ?? 0) + (m.usage.input ?? 0);
				current.usage.output = (current.usage.output ?? 0) + (m.usage.output ?? 0);
				if (typeof m.usage.cost?.total === "number") {
					current.usage.cost = (current.usage.cost ?? 0) + m.usage.cost.total;
				}
			}
			if (m.stopReason) current.outcome = m.stopReason;
			const parts: EpisodePart[] = [];
			for (const raw of Array.isArray(m.content) ? m.content : []) {
				const part = raw as { type?: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown };
				if (part.type === "thinking") parts.push({ kind: "thinking", text: part.thinking ?? "" });
				else if (part.type === "text") {
					parts.push({ kind: "text", text: part.text ?? "" });
					current.assistantText += (current.assistantText ? "\n" : "") + (part.text ?? "");
				} else if (part.type === "toolCall") {
					parts.push({ kind: "toolCall", id: part.id, name: part.name ?? "?", args: part.arguments });
					current.toolCalls += 1;
				}
			}
			current.turns.push({ role: "assistant", parts, timestamp: ts });
			current.endedAt = ts;
		} else if (m.role === "toolResult") {
			current.turns.push({
				role: "toolResult",
				parts: [{ kind: "toolResult", toolName: m.toolName, text: extractText(m.content), isError: m.isError === true }],
				timestamp: ts,
			});
			current.endedAt = ts;
		}
	}
	if (current) episodes.push(current);
	return episodes;
}

/** Parse raw JSONL text into episodes. */
export function parseEpisodesFromJsonl(text: string, sessionId: string): Episode[] {
	const entries: unknown[] = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		try {
			entries.push(JSON.parse(line));
		} catch {
			// skip malformed line
		}
	}
	return parseEpisodes(entries, sessionId);
}

/** A compact list-view summary (no transcript) for the episodes index. */
export function episodeSummary(ep: Episode): {
	id: string;
	source: string;
	prompt: string;
	startedAt?: string;
	endedAt?: string;
	model?: string;
	usage: Episode["usage"];
	toolCalls: number;
	outcome: string;
	output: string;
} {
	return {
		id: ep.id,
		source: ep.source,
		prompt: ep.prompt.slice(0, 200),
		startedAt: ep.startedAt,
		endedAt: ep.endedAt,
		model: ep.model,
		usage: ep.usage,
		toolCalls: ep.toolCalls,
		outcome: ep.outcome,
		output: ep.assistantText.slice(0, 280),
	};
}
