/**
 * The dreamer — the batch ingestion ("dreaming") that distils local AI sessions into
 * the brain. It discovers pi/Claude/Codex transcripts, skips ones already ingested
 * (per-file cursor), normalises them (./sources), and feeds each through the engine's
 * extract() (which redacts first). Bounded + resumable: it processes a capped batch of
 * the newest un-ingested sessions per run, so the ~2GB backlog is chipped away across
 * scheduled runs without ever hammering the local model or re-ingesting.
 *
 * Off-peak by intent (the "sleep" that consolidates the day's work into memory). The
 * engine + clock are injectable so the orchestration is tested without a model.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { IngestCursor } from "./cursor.ts";
import type { BrainEngine } from "./engine.ts";
import { parseSession, repoSlug, type SourceKind } from "./sources.ts";

export type SourceConfig = { kind: SourceKind; dirs: string[]; match: RegExp };

/** Default discovery roots for each source on this machine. */
export function defaultSources(): SourceConfig[] {
	const h = homedir();
	const state = process.env.AGENT_TOOLKIT_STATE_DIR ?? join(h, ".local", "state", "agent-toolkit");
	return [
		{ kind: "claude", dirs: [join(h, ".claude", "projects")], match: /\.jsonl$/ },
		{ kind: "codex", dirs: [join(h, ".codex", "sessions")], match: /^rollout-.*\.jsonl$/ },
		{ kind: "pi", dirs: [join(state, "sessions"), join(state, "worker-sessions"), join(h, ".pi", "agent", "sessions")], match: /\.jsonl$/ },
	];
}

type Found = { file: string; mtimeMs: number; size: number };

function walk(dir: string, match: RegExp, out: Found[], depth = 0): void {
	if (depth > 8) return;
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isDirectory()) walk(full, match, out, depth + 1);
		else if (e.isFile() && match.test(e.name)) {
			try {
				const s = statSync(full);
				out.push({ file: full, mtimeMs: s.mtimeMs, size: s.size });
			} catch {
				// skip
			}
		}
	}
}

export type DreamOptions = {
	engine: BrainEngine;
	sources?: SourceConfig[];
	/** Max sessions to ingest this run (across all sources). Default 50. */
	maxSessions?: number;
	/** Only ingest sessions modified within this many days (0 = no age limit). Default 0. */
	sinceDays?: number;
	/** Min messages for a session to be worth extracting. Default 4. */
	minMessages?: number;
	/** Commit the brain every N sessions (and at the end). Default 25. */
	commitEvery?: number;
	now?: () => number;
	logger?: (m: string) => void;
};

export type DreamReport = {
	scanned: number;
	skipped: number;
	ingested: number;
	memories: number;
	bySource: Record<string, { ingested: number; memories: number }>;
	errors: number;
};

export async function runDream(opts: DreamOptions): Promise<DreamReport> {
	const sources = opts.sources ?? defaultSources();
	const maxSessions = opts.maxSessions ?? 50;
	const minMessages = opts.minMessages ?? 4;
	const commitEvery = opts.commitEvery ?? 25;
	const now = opts.now ?? Date.now;
	const log = opts.logger ?? (() => {});
	const ageCutoff = opts.sinceDays && opts.sinceDays > 0 ? now() - opts.sinceDays * 86_400_000 : 0;

	const report: DreamReport = { scanned: 0, skipped: 0, ingested: 0, memories: 0, bySource: {}, errors: 0 };

	// Gather candidate files across all sources, newest first, respecting cursors + age.
	type Candidate = Found & { kind: SourceKind; cursor: IngestCursor };
	const candidates: Candidate[] = [];
	const cursors = new Map<SourceKind, IngestCursor>();
	for (const src of sources) {
		const cursor = new IngestCursor(src.kind);
		cursors.set(src.kind, cursor);
		report.bySource[src.kind] ??= { ingested: 0, memories: 0 };
		const found: Found[] = [];
		for (const dir of src.dirs) if (existsSync(dir)) walk(dir, src.match, found);
		for (const f of found) {
			report.scanned += 1;
			if (ageCutoff && f.mtimeMs < ageCutoff) continue;
			if (cursor.done(f.file, f)) {
				report.skipped += 1;
				continue;
			}
			candidates.push({ ...f, kind: src.kind, cursor });
		}
	}
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
	const batch = candidates.slice(0, maxSessions);
	log(`[dream] ${report.scanned} scanned, ${report.skipped} already ingested, ${candidates.length} pending → ingesting ${batch.length}`);

	let sinceCommit = 0;
	for (const c of batch) {
		const at = new Date(now()).toISOString();
		try {
			const parsed = parseSession(c.kind, c.file);
			if (parsed.messages.length < minMessages) {
				c.cursor.mark(c.file, c, at); // nothing to learn; don't revisit
				continue;
			}
			const repo = repoSlug(parsed.cwd);
			// Give the extractor the provenance so it can attribute facts to the repo.
			const messages = [
				{ role: "system", content: `This is a ${c.kind} coding session in repo "${repo}". Extract durable, reusable facts: codebase conventions, decisions, the user's preferences, and corrections — not transient chatter.` },
				...parsed.messages,
			];
			// Unique cursor key PER FILE — the library's internal extract cursor is keyed by
			// (actorId, sessionId); subagent transcripts share a sessionId, which would make
			// later sessions skip. The file basename is unique, forcing a full extraction.
			const mems = await opts.engine.extract(messages, { sessionId: `${c.kind}:${repo}:${basename(c.file, ".jsonl")}` });
			c.cursor.mark(c.file, c, at);
			report.ingested += 1;
			report.memories += mems.length;
			report.bySource[c.kind]!.ingested += 1;
			report.bySource[c.kind]!.memories += mems.length;
			if (++sinceCommit >= commitEvery) {
				opts.engine.commit(`memory: dream batch (+${report.memories})`);
				for (const cur of cursors.values()) cur.save();
				sinceCommit = 0;
			}
		} catch (e) {
			report.errors += 1;
			c.cursor.mark(c.file, c, at); // don't loop on a bad file
			log(`[dream] error on ${c.file}: ${(e as Error).message}`);
		}
	}
	opts.engine.commit(`memory: dream (+${report.memories} from ${report.ingested} sessions)`);
	for (const cur of cursors.values()) cur.save();
	log(`[dream] done: ingested ${report.ingested} sessions, ${report.memories} memories, ${report.errors} errors`);
	return report;
}
