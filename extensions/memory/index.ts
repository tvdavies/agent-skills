/**
 * Memory extension — hook-based recall over the @jeffs-brain/memory engine.
 *
 * On `before_agent_start` it recalls relevant memories for the incoming prompt and
 * injects them into the system prompt as a marked block — automatic, tool-free
 * recall (the reliability win: it never depends on the agent calling a tool).
 *
 * Flag-gated for a safe cutover: inert unless AGENT_TOOLKIT_MEMORY_ENGINE=jeffs, so
 * the existing OKF brain remains the default until this engine is proven. When you
 * switch the flag on, set AGENT_TOOLKIT_BRAIN_RECALL=off so only one recall injects.
 *
 * Env:
 *   AGENT_TOOLKIT_MEMORY_ENGINE=jeffs   activate this engine (else inert)
 *   AGENT_TOOLKIT_MEMORY_MODEL          extraction model (default nuextract-v1.5)
 *   AGENT_TOOLKIT_MEMORY_BASE_URL       LM Studio endpoint (default http://localhost:1234)
 *   AGENT_TOOLKIT_MEMORY_RECALL_LIMIT   max memories injected (default 6)
 *   AGENT_TOOLKIT_MEMORY_RECALL_MS      recall time budget per turn (default 800)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { BrainEngine } from "./engine.ts"; // type-only — runtime load is deferred

const MARKER = "<!-- memory-addendum -->";
const ADDENDUM = `

${MARKER}
## Persistent memory
- Relevant memories are injected automatically as a <memory> block before each turn — treat them as potentially stale and verify load-bearing details.
- Call memory_query to look something up when the injected block is insufficient.`;

function recallLimit(): number {
	const n = Number(process.env.AGENT_TOOLKIT_MEMORY_RECALL_LIMIT ?? 6);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
}
function recallBudgetMs(): number {
	const n = Number(process.env.AGENT_TOOLKIT_MEMORY_RECALL_MS ?? 800);
	return Number.isFinite(n) && n > 0 ? n : 800;
}

/** Race a promise against a timeout; resolve to `fallback` if it overruns or rejects.
 *  Clears the timer when the work settles so it never leaks. */
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const settle = work.then(
		(v) => {
			clearTimeout(timer);
			return v;
		},
		() => {
			clearTimeout(timer);
			return fallback;
		},
	);
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(fallback), ms);
	});
	return Promise.race([settle, timeout]);
}

export default function memoryExtension(pi: ExtensionAPI): void {
	// Inert unless explicitly enabled — the OKF brain stays the default during cutover.
	if (process.env.AGENT_TOOLKIT_MEMORY_ENGINE !== "jeffs") return;

	let enginePromise: Promise<BrainEngine | undefined> | undefined;
	const getEngine = (): Promise<BrainEngine | undefined> => {
		if (!enginePromise) {
			// Deferred runtime import: @jeffs-brain/memory only loads when the engine is
			// actually used, so the inert (flag-off) path has zero footprint.
			enginePromise = import("./engine.ts")
				.then((m) => m.createBrainEngine())
				.catch((e) => {
					console.error(`[memory] engine init failed: ${(e as Error).message}`);
					enginePromise = undefined; // allow a retry on a later turn
					return undefined;
				});
		}
		return enginePromise;
	};

	pi.on("before_agent_start", async (event) => {
		if (!event.prompt?.trim()) return { systemPrompt: event.systemPrompt };
		// Bound the WHOLE thing (engine init + recall) so a slow init or model never
		// delays the turn; degrade to "no injection".
		const block = await withTimeout(
			(async () => {
				const engine = await getEngine();
				if (!engine) return undefined; // unavailable → no addendum, no block
				return (await engine.recall(event.prompt, recallLimit())).block;
			})(),
			recallBudgetMs(),
			undefined as string | undefined,
		);
		if (block === undefined) return { systemPrompt: event.systemPrompt }; // engine down/slow
		// Engine is available: advertise the memory facility (even if no hit this turn), and
		// inject the block when there is one.
		const base = event.systemPrompt.includes(MARKER) ? event.systemPrompt : `${event.systemPrompt}${ADDENDUM}`;
		return { systemPrompt: block ? `${base}\n\n${block}` : base };
	});

	const querySchema = Type.Object({
		query: Type.String({ description: "What to look up in persistent memory." }),
		limit: Type.Optional(Type.Number({ description: "Max memories to return (default 6)." })),
	});
	type QueryInput = Static<typeof querySchema>;

	pi.registerTool({
		name: "memory_query",
		label: "memory query",
		description: "Search the agent's persistent memory (codebase facts, decisions, your preferences, project context) for relevant notes. Recall already runs automatically each turn; use this for a targeted lookup.",
		parameters: querySchema,
		async execute(_id, params: QueryInput) {
			const engine = await getEngine();
			if (!engine) {
				return { content: [{ type: "text" as const, text: "Memory engine is unavailable." }], details: { ok: false, count: 0 } };
			}
			const { block, count } = await engine.recall(params.query, params.limit && params.limit > 0 ? Math.floor(params.limit) : 6);
			return {
				content: [{ type: "text" as const, text: count ? block : "No relevant memories found." }],
				details: { ok: true, count },
			};
		},
	});

	const rememberSchema = Type.Object({
		fact: Type.String({ description: "A durable, reusable fact, decision, preference, or correction worth keeping for future sessions. No secrets or transient chatter." }),
	});
	type RememberInput = Static<typeof rememberSchema>;

	pi.registerTool({
		name: "memory_remember",
		label: "memory remember",
		description: "Persist a durable fact to memory right now (it would otherwise be captured only when the session is later ingested). Use for a preference, decision, fact, or correction worth keeping. Recall is automatic each turn; this is for immediate, explicit capture.",
		parameters: rememberSchema,
		async execute(_id, params: RememberInput) {
			const engine = await getEngine();
			if (!engine) return { content: [{ type: "text" as const, text: "Memory engine is unavailable." }], details: { ok: false, count: 0 } };
			const recorded = await engine.remember(params.fact);
			return {
				content: [{ type: "text" as const, text: recorded.length ? `Recorded ${recorded.length} memory item(s).` : "Nothing durable to record from that." }],
				details: { ok: true, count: recorded.length },
			};
		},
	});
}
