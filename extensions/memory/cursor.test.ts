import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IngestCursor } from "./cursor";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cursor-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("IngestCursor", () => {
	it("marks files done, persists, and reloads across instances", () => {
		const c = new IngestCursor("claude", dir);
		const stat = { mtimeMs: 1700000000123, size: 4096 };
		expect(c.done("/a.jsonl", stat)).toBe(false);
		c.mark("/a.jsonl", stat, "2026-06-29T00:00:00Z");
		c.save();
		const c2 = new IngestCursor("claude", dir);
		expect(c2.done("/a.jsonl", stat)).toBe(true);
		expect(c2.count()).toBe(1);
	});

	it("re-ingests when the file changed (different mtime or size)", () => {
		const c = new IngestCursor("pi", dir);
		c.mark("/b.jsonl", { mtimeMs: 1000, size: 10 }, "t");
		expect(c.done("/b.jsonl", { mtimeMs: 1000, size: 10 })).toBe(true);
		expect(c.done("/b.jsonl", { mtimeMs: 2000, size: 10 })).toBe(false); // appended → re-ingest
		expect(c.done("/b.jsonl", { mtimeMs: 1000, size: 20 })).toBe(false);
	});
});
