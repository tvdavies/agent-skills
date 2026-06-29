/**
 * Ingest cursor — tracks which session files have been distilled, so the dreamer never
 * re-ingests the same transcript and can chip away at the ~2GB backlog incrementally
 * across runs. Keyed by file path → {mtime, size}; a file is re-ingested only if it
 * changed (a live session appended). One JSON file per source under the state dir.
 *
 * Best-effort + crash-safe (atomic write): a lost cursor only causes re-ingestion, not
 * data loss.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type FileMark = { mtime: number; size: number; at: string };
type CursorData = Record<string, FileMark>;

export function ingestCursorDir(): string {
	const base = process.env.AGENT_TOOLKIT_STATE_DIR ?? join(homedir(), ".local", "state", "agent-toolkit");
	return join(base, ".ingest-cursors");
}

export class IngestCursor {
	private readonly path: string;
	private data: CursorData;

	constructor(source: string, dir = ingestCursorDir()) {
		this.path = join(dir, `${source}.json`);
		this.data = this.load();
	}

	private load(): CursorData {
		if (!existsSync(this.path)) return {};
		try {
			return JSON.parse(readFileSync(this.path, "utf8")) as CursorData;
		} catch {
			return {};
		}
	}

	/** Whether this file (at this mtime+size) has already been ingested. */
	done(file: string, stat: { mtimeMs: number; size: number }): boolean {
		const m = this.data[file];
		return !!m && m.mtime === Math.floor(stat.mtimeMs) && m.size === stat.size;
	}

	/** Record a file as ingested (in memory; call save() to persist). */
	mark(file: string, stat: { mtimeMs: number; size: number }, at: string): void {
		this.data[file] = { mtime: Math.floor(stat.mtimeMs), size: stat.size, at };
	}

	count(): number {
		return Object.keys(this.data).length;
	}

	/** Persist atomically (tmp + rename). */
	save(): void {
		try {
			mkdirSync(join(this.path, ".."), { recursive: true });
			const tmp = `${this.path}.tmp`;
			writeFileSync(tmp, `${JSON.stringify(this.data)}\n`, "utf8");
			renameSync(tmp, this.path);
		} catch {
			// best-effort
		}
	}
}
