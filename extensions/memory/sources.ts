/**
 * Session sources — normalise pi / Claude Code / Codex transcripts into the message
 * shape the engine's extract() consumes. Each tool stores JSONL with a different
 * record layout (mapped from real files on disk); these adapters pull the user +
 * assistant text and the session's working directory (for repo attribution).
 *
 * Bounded by design: only the last N messages, each capped, so a huge session never
 * floods a single extraction. Pure parsing (no fs beyond the read passed in), tested
 * against fixtures of each format.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

export type ParsedSession = {
	sessionId: string;
	cwd?: string;
	messages: Array<{ role: string; content: string }>;
};

export type SourceKind = "pi" | "claude" | "codex";

const MAX_MESSAGES = 30; // the tail is the most salient
const MAX_CHARS = 2000; // per message — keep total input modest so extraction output fits the model's cap

function flattenContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b) => (typeof b === "string" ? b : typeof (b as { text?: unknown })?.text === "string" ? (b as { text: string }).text : ""))
			.filter(Boolean)
			.join("");
	}
	return "";
}

function finalise(sessionId: string, cwd: string | undefined, raw: Array<{ role: string; content: string }>): ParsedSession {
	const messages = raw
		.filter((m) => m.content.trim().length > 0)
		.map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
		.slice(-MAX_MESSAGES);
	return { sessionId, cwd, messages };
}

function readLines(file: string): unknown[] {
	const out: unknown[] = [];
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return out;
	}
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			// skip corrupt line
		}
	}
	return out;
}

/** Claude Code: ~/.claude/projects/**\/*.jsonl — type user|assistant, message.{role,content}, cwd. */
export function parseClaude(file: string): ParsedSession {
	const raw: Array<{ role: string; content: string }> = [];
	let cwd: string | undefined;
	let sessionId: string | undefined;
	for (const rec of readLines(file) as Array<Record<string, unknown>>) {
		const type = rec.type;
		if (typeof rec.cwd === "string" && !cwd) cwd = rec.cwd;
		if (typeof rec.sessionId === "string" && !sessionId) sessionId = rec.sessionId;
		if (type !== "user" && type !== "assistant") continue;
		const msg = rec.message as { role?: string; content?: unknown } | undefined;
		if (!msg) continue;
		const text = flattenContent(msg.content);
		if (text) raw.push({ role: msg.role === "assistant" ? "assistant" : "user", content: text });
	}
	return finalise(sessionId ?? basename(file).replace(/\.jsonl$/, ""), cwd, raw);
}

/** Codex: ~/.codex/sessions/**\/rollout-*.jsonl — response_item payloads with message role+content. */
export function parseCodex(file: string): ParsedSession {
	const raw: Array<{ role: string; content: string }> = [];
	let cwd: string | undefined;
	let sessionId: string | undefined;
	for (const rec of readLines(file) as Array<Record<string, unknown>>) {
		const payload = rec.payload as Record<string, unknown> | undefined;
		if (rec.type === "session_meta" && payload) {
			if (typeof payload.id === "string") sessionId = payload.id;
			if (typeof payload.cwd === "string") cwd = payload.cwd;
			continue;
		}
		if (rec.type !== "response_item" || !payload || payload.type !== "message") continue;
		const role = payload.role;
		if (role !== "user" && role !== "assistant") continue; // skip developer/system
		const text = flattenContent(payload.content);
		if (text) raw.push({ role, content: text });
	}
	return finalise(sessionId ?? basename(file).replace(/\.jsonl$/, ""), cwd, raw);
}

/** Pi: session JSONL with message records carrying role + content blocks. */
export function parsePi(file: string): ParsedSession {
	const raw: Array<{ role: string; content: string }> = [];
	let cwd: string | undefined;
	let sessionId: string | undefined;
	for (const rec of readLines(file) as Array<Record<string, unknown>>) {
		if (rec.type === "session") {
			if (typeof rec.id === "string") sessionId = rec.id;
			if (typeof rec.cwd === "string") cwd = rec.cwd;
			continue;
		}
		// pi message records: { type: "message", role, content } or nested message.
		const msg = (rec.type === "message" ? rec : (rec.message as Record<string, unknown> | undefined)) as
			| { role?: unknown; content?: unknown }
			| undefined;
		const role = msg?.role ?? rec.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = flattenContent(msg?.content ?? rec.content);
		if (text) raw.push({ role, content: text });
	}
	return finalise(sessionId ?? basename(file).replace(/\.jsonl$/, ""), cwd, raw);
}

const PARSERS: Record<SourceKind, (file: string) => ParsedSession> = {
	pi: parsePi,
	claude: parseClaude,
	codex: parseCodex,
};

export function parseSession(kind: SourceKind, file: string): ParsedSession {
	return PARSERS[kind](file);
}

/** A short, stable repo slug from a session's cwd (for attributing facts to a project). */
export function repoSlug(cwd: string | undefined): string {
	if (!cwd) return "unknown";
	// Worktrees: …/.pi-worktrees/<repo>/<hash>, …/.worktrees/<repo>/… → use <repo>
	// (any path segment ending in "worktrees", followed by the repo name).
	const wt = /(?:^|\/)[^/]*worktrees\/([^/]+)/.exec(cwd);
	if (wt?.[1]) return slug(wt[1]);
	return slug(basename(cwd.replace(/\/+$/, "")) || "unknown");
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "unknown";
