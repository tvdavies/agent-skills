#!/usr/bin/env node
/**
 * toolkit-dream — run the memory dreamer: distil local AI sessions into the brain.
 *
 * Invoked by cron (daily, off-peak) and on demand. Bounded + resumable via per-file
 * cursors, so repeated runs chip away at the backlog and incremental runs only ingest
 * new/changed sessions.
 *
 *   toolkit-dream [--max N] [--since-days N] [--source claude|codex|pi|all]
 *
 * Uses the same local LM Studio model + brain as the recall engine.
 */

import { createBrainEngine } from "../extensions/memory/engine.ts";
import { defaultSources, type DreamOptions, runDream } from "../extensions/memory/dreamer.ts";
import type { SourceKind } from "../extensions/memory/sources.ts";

function parseArgs(argv: string[]): { max?: number; sinceDays?: number; source?: SourceKind | "all" } {
	const out: { max?: number; sinceDays?: number; source?: SourceKind | "all" } = {};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--max") out.max = Number(argv[++i]);
		else if (a === "--since-days") out.sinceDays = Number(argv[++i]);
		else if (a === "--source") out.source = argv[++i] as SourceKind | "all";
	}
	return out;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	// The dreamer commits the brain in batches itself, so run the engine with per-extract
	// git OFF (fast) — the dreamer calls engine.commit().
	const engine = await createBrainEngine({ git: false });
	let sources = defaultSources();
	if (args.source && args.source !== "all") sources = sources.filter((s) => s.kind === args.source);

	const opts: DreamOptions = {
		engine,
		sources,
		maxSessions: Number.isFinite(args.max) && args.max ? args.max : Number(process.env.AGENT_TOOLKIT_DREAM_MAX ?? 50),
		sinceDays: Number.isFinite(args.sinceDays) ? args.sinceDays : Number(process.env.AGENT_TOOLKIT_DREAM_SINCE_DAYS ?? 0),
		logger: (m) => console.error(m),
	};
	const report = await runDream(opts);
	console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
	console.error(`[toolkit-dream] failed: ${(e as Error).message}`);
	process.exit(1);
});
