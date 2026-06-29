/**
 * Memory extension — a thin client to the `brain` CLI (the @ai-assistant/brain
 * memory engine: markdown source-of-truth + hybrid BM25/vector retrieval + a
 * background daemon that ingests sessions and extracts durable facts).
 *
 * This replaces the in-process @jeffs-brain engine. agent-toolkit no longer owns
 * a memory store, a dreamer, a provider, or redaction — `brain` owns all of that
 * (redaction included, in its `record()` chokepoint). We just shell out:
 *   - before_agent_start → `brain query <prompt> --format context` → inject a
 *     <brain_memories> block. Automatic, tool-free, bounded recall.
 *   - memory_remember → pipe a turn to `brain remember` (the daemon extracts).
 *   - memory_query → an explicit, higher-quality `brain query`.
 *
 * brain self-hydrates its store (~/brain) and provider credentials (~/brain/auth),
 * so this client needs only the binary path — no provider keys, no BRAIN_* plumbing.
 *
 * Env:
 *   AGENT_TOOLKIT_MEMORY_ENGINE   "brain" (default) | "okf" | "off" — gate
 *   AGENT_TOOLKIT_BRAIN_BIN       brain binary path (else $BRAIN_BIN, else "brain")
 *   AGENT_TOOLKIT_MEMORY_SCOPE    brain --scope override (else brain's default)
 *   AGENT_TOOLKIT_MEMORY_RECALL_LIMIT   max memories injected (default 6)
 *   AGENT_TOOLKIT_MEMORY_RECALL_MS      per-turn recall time budget (default 1500)
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

const MARKER = "<!-- memory-addendum -->";
const ADDENDUM = `

${MARKER}
## Persistent memory
- Relevant memories are injected automatically as a <brain_memories> block before each turn — treat them as potentially stale and verify load-bearing details.
- Call memory_query to look something up when the injected block is insufficient.
- Call memory_remember to persist a durable fact, decision, preference, or correction worth keeping. No secrets or transient chatter.`;

function memoryEngine(): string {
	return process.env.AGENT_TOOLKIT_MEMORY_ENGINE ?? "brain";
}
function brainBin(): string {
	return process.env.AGENT_TOOLKIT_BRAIN_BIN ?? process.env.BRAIN_BIN ?? "brain";
}
function memoryScope(): string | undefined {
	const s = process.env.AGENT_TOOLKIT_MEMORY_SCOPE?.trim();
	return s ? s : undefined;
}
function recallLimit(): number {
	const n = Number(process.env.AGENT_TOOLKIT_MEMORY_RECALL_LIMIT ?? 6);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
}
function recallBudgetMs(): number {
	const n = Number(process.env.AGENT_TOOLKIT_MEMORY_RECALL_MS ?? 1500);
	return Number.isFinite(n) && n > 0 ? n : 1500;
}

type BrainResult = { code: number; stdout: string; stderr: string };

/** Spawn the brain CLI; resolve with exit code + captured streams. Never throws on
 *  non-zero exit (callers inspect `code`); rejects only on spawn failure (e.g. ENOENT). */
function runBrain(args: string[], stdin?: string): Promise<BrainResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(brainBin(), args, {
			stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (d) => {
			stdout += d;
		});
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (d) => {
			stderr += d;
		});
		child.on("error", reject);
		// "close" (not "exit") so stdout/stderr are fully drained.
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
		if (stdin !== undefined && child.stdin) child.stdin.end(stdin, "utf8");
	});
}

/** Recall relevant memories for a query, formatted as a prompt-injection block.
 *  `rerank` off (the per-turn default) skips the slow LLM reranker; the explicit
 *  tool turns it on for higher quality. Throws on a non-zero brain exit. */
async function brainRecall(query: string, limit: number, rerank: boolean): Promise<string> {
	const args = ["query", query, "--format", "context", "--limit", String(limit)];
	const scope = memoryScope();
	if (scope) args.push("--scope", scope);
	if (!rerank) args.push("--no-rerank");
	const { code, stdout, stderr } = await runBrain(args);
	if (code !== 0) throw new Error(stderr.trim() || `brain query exited ${code}`);
	return stdout.trim();
}

type Turn = { role: "user" | "assistant"; text: string; recordedAt?: string };

/** Persist turns via `brain remember` (JSONL on stdin). Async mode: the verbatim
 *  chunk lands immediately (recallable now); the daemon extracts durable facts. */
async function brainRemember(turns: readonly Turn[]): Promise<void> {
	const scope = memoryScope();
	const args = ["remember", "--json", ...(scope ? ["--scope", scope] : [])];
	const stdin = `${turns.map((t) => JSON.stringify(t)).join("\n")}\n`;
	const { code, stderr } = await runBrain(args, stdin);
	if (code !== 0) throw new Error(stderr.trim() || `brain remember exited ${code}`);
}

/** Retry brain remember on SQLite lock contention (the daemon may hold the db). */
async function brainRememberWithRetry(turns: readonly Turn[], retries = 3): Promise<void> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= retries; attempt += 1) {
		try {
			return await brainRemember(turns);
		} catch (err) {
			lastErr = err;
			if (/database is locked/i.test(String(err))) {
				await new Promise((r) => setTimeout(r, 250 * attempt));
				continue;
			}
			throw err;
		}
	}
	throw lastErr;
}

/** Race a promise against a timeout; resolve to `fallback` on overrun or rejection.
 *  Clears the timer when work settles so it never leaks. */
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
	// brain is the default engine; "okf" hands memory back to the in-process OKF
	// brain (extensions/brain), "off" disables memory entirely.
	if (memoryEngine() !== "brain") return;

	// Serialise remember calls so concurrent tool invocations don't race the db.
	let rememberQueue: Promise<unknown> = Promise.resolve();
	const enqueueRemember = (turns: readonly Turn[]): Promise<void> => {
		const run = rememberQueue.then(() => brainRememberWithRetry(turns));
		rememberQueue = run.catch(() => undefined);
		return run;
	};

	pi.on("before_agent_start", async (event) => {
		if (!event.prompt?.trim()) return { systemPrompt: event.systemPrompt };
		// Bounded recall: a slow/absent brain degrades to "no injection", never delays
		// or fails the turn. Per-turn recall skips the LLM reranker for latency.
		const block = await withTimeout(
			brainRecall(event.prompt, recallLimit(), false).catch(() => ""),
			recallBudgetMs(),
			"",
		);
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
		description:
			"Search the agent's persistent memory (codebase facts, decisions, your preferences, project context) for relevant notes. Recall already runs automatically each turn; use this for a targeted, higher-quality lookup.",
		parameters: querySchema,
		async execute(_id, params: QueryInput) {
			const limit = params.limit && params.limit > 0 ? Math.floor(params.limit) : 6;
			try {
				// Explicit lookup → full quality (reranker on); the user is waiting.
				const block = await brainRecall(params.query, limit, true);
				return {
					content: [{ type: "text" as const, text: block || "No relevant memories found." }],
					details: { ok: true, hasResults: block.length > 0 },
				};
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Memory query failed: ${(err as Error).message}` }],
					details: { ok: false, hasResults: false },
				};
			}
		},
	});

	const rememberSchema = Type.Object({
		fact: Type.String({
			description:
				"A durable, reusable fact, decision, preference, or correction worth keeping for future sessions. No secrets or transient chatter.",
		}),
	});
	type RememberInput = Static<typeof rememberSchema>;

	pi.registerTool({
		name: "memory_remember",
		label: "memory remember",
		description:
			"Persist a durable fact to memory now. Use for a preference, decision, fact, or correction worth keeping. Recall is automatic each turn; this is for immediate, explicit capture.",
		parameters: rememberSchema,
		async execute(_id, params: RememberInput) {
			const fact = params.fact.trim();
			if (!fact) {
				return { content: [{ type: "text" as const, text: "Nothing to remember." }], details: { ok: false } };
			}
			try {
				await enqueueRemember([{ role: "user", text: fact, recordedAt: new Date().toISOString() }]);
				return { content: [{ type: "text" as const, text: "Remembered." }], details: { ok: true } };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Failed to remember: ${(err as Error).message}` }],
					details: { ok: false },
				};
			}
		},
	});

	pi.registerCommand("memory", {
		description: "Persistent memory (brain): /memory status | query <q> | remember <text>",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "status", label: "status — brain daemon health + queue" },
				{ value: "query ", label: "query — search persistent memory" },
				{ value: "remember ", label: "remember — persist a durable fact" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const [command = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const remainder = rest.join(" ");
			switch (command) {
				case "status": {
					const { code, stdout, stderr } = await runBrain(["daemon", "status"]);
					ctx.ui.notify(
						code === 0 ? stdout.trim() || "brain: ok" : `brain unavailable: ${stderr.trim()}`,
						code === 0 ? "info" : "warning",
					);
					return;
				}
				case "query": {
					if (!remainder) return void ctx.ui.notify("Usage: /memory query <q>", "warning");
					try {
						const block = await brainRecall(remainder, recallLimit(), true);
						ctx.ui.notify(block || "No relevant memories found.", "info");
					} catch (err) {
						ctx.ui.notify(`Memory query failed: ${(err as Error).message}`, "error");
					}
					return;
				}
				case "remember": {
					if (!remainder) return void ctx.ui.notify("Usage: /memory remember <text>", "warning");
					try {
						await enqueueRemember([{ role: "user", text: remainder, recordedAt: new Date().toISOString() }]);
						ctx.ui.notify("Remembered.", "info");
					} catch (err) {
						ctx.ui.notify(`Failed to remember: ${(err as Error).message}`, "error");
					}
					return;
				}
				default:
					ctx.ui.notify("Usage: /memory status | query <q> | remember <text>", "warning");
			}
		},
	});
}
