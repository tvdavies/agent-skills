/**
 * Provider — the local LM Studio model that powers extraction (and later reflect/
 * consolidate). Two spike-proven adjustments wrap @jeffs-brain/memory's OpenAIProvider:
 *
 *  - baseURL must NOT include `/v1` — the provider appends `/v1/chat/completions`,
 *    so a baseURL of `http://localhost:1234/v1` would 404 on `/v1/v1/...`.
 *  - LM Studio rejects `response_format: { type: "json_object" }` (it accepts only
 *    `json_schema` or `text`). extract() never requests it, but reflect/consolidate
 *    might, so the wrapper strips json-object mode defensively — the library always
 *    slices JSON out of a plain-text response anyway.
 */

import { OpenAIProvider } from "@jeffs-brain/memory";

export type LmStudioOptions = {
	/** LM Studio endpoint WITHOUT a trailing /v1 (default http://localhost:1234). */
	baseURL?: string;
	/** Model id (default a small instruct model — see DEFAULT_EXTRACT_MODEL). */
	model?: string;
	apiKey?: string;
};

/**
 * Default extraction model. Phase-0 model comparison: nuextract-v1.5 is fast + rich
 * but UNRELIABLE — it extracts nothing for some fact-rich inputs ([0,0,0] on inputs
 * where qwen extracted [2,2,2]). A small instruct model is consistent across inputs
 * (the conform wrapper handles its output shape), which a reliable dreamer needs.
 */
export const DEFAULT_EXTRACT_MODEL = "qwen/qwen3-4b-2507";

/** Normalise a base URL by trimming a trailing `/v1` (the provider adds it). */
export function normaliseBaseURL(url: string): string {
	return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Strip json-object response mode from a request (LM Studio rejects it). */
export function stripJsonObjectMode(req: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...req };
	if (out.jsonMode === true) delete out.jsonMode;
	const rf = out.responseFormat as { type?: string } | undefined;
	if (rf && rf.type === "json_object") delete out.responseFormat;
	return out;
}

type CompleteFn = (req: Record<string, unknown>, signal?: AbortSignal) => Promise<{ content?: string }>;
type StreamFn = (req: Record<string, unknown>, signal?: AbortSignal) => unknown;

/** Filesystem-safe slug for a memory filename, derived from its name. */
export function slugify(name: string): string {
	const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
	return s || "memory";
}

function firstJsonBlock(text: string): string | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	// Respect the OUTERMOST structure: an array's first char is '[' even though it
	// contains '{' objects — slicing on '{' first would break it.
	const oi = trimmed.indexOf("{");
	const ai = trimmed.indexOf("[");
	const arrayFirst = ai >= 0 && (oi < 0 || ai < oi);
	if (arrayFirst) {
		const end = trimmed.lastIndexOf("]");
		return end > ai ? trimmed.slice(ai, end + 1) : undefined;
	}
	if (oi >= 0) {
		const end = trimmed.lastIndexOf("}");
		return end > oi ? trimmed.slice(oi, end + 1) : undefined;
	}
	return undefined;
}

/** Flatten array/object content (nuextract emits content as a structured array) to text. */
function flattenText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(flattenText).filter((s) => s.trim()).join("; ");
	if (value && typeof value === "object") return Object.values(value).map(flattenText).filter((s) => s.trim()).join("; ");
	return "";
}
const firstNonEmpty = (...vals: unknown[]): string => {
	for (const v of vals) if (typeof v === "string" && v.trim()) return v;
	return "";
};

/**
 * Conform extracted memories to what @jeffs-brain/memory will actually persist: it
 * skips any memory with an empty `filename` OR a non-string/empty `content`. Fast
 * extraction models like nuextract omit the filename and emit `content` as a
 * structured array — so we derive a filename from the name and coerce content to a
 * non-empty string (flattening structure, else falling back to description/index/name).
 *
 * Only touches recognisable extraction JSON (an array of name-bearing objects, or a
 * `{ memories: [...] }` wrapper); reflection/consolidation responses + prose pass through.
 */
/**
 * Salvage complete memory objects from a TRUNCATED array — local models routinely hit
 * the library's hard 4096-token output cap mid-JSON, which otherwise loses the entire
 * (often large) extraction. Scans the array, collects every top-level {...} that parses,
 * and drops the trailing incomplete one. String-aware so braces inside values don't fool it.
 */
export function salvageMemoryArray(text: string): unknown[] | undefined {
	const start = text.indexOf("[");
	if (start < 0) return undefined;
	const objects: unknown[] = [];
	let depth = 0;
	let objStart = -1;
	let inString = false;
	let escaped = false;
	for (let i = start + 1; i < text.length; i += 1) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") {
			if (depth === 0) objStart = i;
			depth += 1;
		} else if (ch === "}") {
			depth -= 1;
			if (depth === 0 && objStart >= 0) {
				try {
					objects.push(JSON.parse(text.slice(objStart, i + 1)));
				} catch {
					// incomplete/corrupt object — skip
				}
				objStart = -1;
			}
		}
	}
	return objects.length > 0 ? objects : undefined;
}

export function conformExtraction(content: string): string {
	const block = firstJsonBlock(content);
	if (block === undefined) return content;
	let parsed: unknown;
	try {
		parsed = JSON.parse(block);
	} catch {
		// Tolerate trailing commas (a common local-model quirk).
		try {
			parsed = JSON.parse(block.replace(/,(\s*[}\]])/g, "$1"));
		} catch {
			// Last resort: salvage complete objects from a truncated array.
			const salvaged = salvageMemoryArray(content);
			if (salvaged) parsed = salvaged;
			else return content;
		}
	}
	// Accept every shape the library will later try to persist: an array, a
	// { memories: [...] } / { memory: {...} } wrapper, or a bare single memory object.
	const looksLikeMemory = (o: unknown): boolean =>
		!!o && typeof o === "object" && ["name", "filename", "content", "description", "index_entry"].some((k) => k in (o as object));
	const wrap = (o: unknown): unknown[] => [o];
	const items: unknown[] | undefined = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === "object" && Array.isArray((parsed as { memories?: unknown }).memories)
			? (parsed as { memories: unknown[] }).memories
			: parsed && typeof parsed === "object" && looksLikeMemory((parsed as { memory?: unknown }).memory)
				? wrap((parsed as { memory: unknown }).memory)
				: looksLikeMemory(parsed)
					? wrap(parsed)
					: undefined;
	if (!items) return content;
	let changed = false;
	for (const m of items) {
		if (!m || typeof m !== "object") continue;
		const mm = m as Record<string, unknown>;
		if (typeof mm.name !== "string") continue;
		if (typeof mm.filename !== "string" || mm.filename.trim() === "") {
			mm.filename = `${slugify(mm.name)}.md`;
			changed = true;
		}
		if (typeof mm.content !== "string" || mm.content.trim() === "") {
			mm.content = firstNonEmpty(flattenText(mm.content), mm.description, mm.index_entry, mm.name);
			changed = true;
		}
	}
	return changed ? JSON.stringify(parsed) : content;
}

/** Wrap a provider so extraction responses are conformed to persist (filename + content). */
export function withExtractionConform<P>(provider: P): P {
	return new Proxy(provider as object, {
		get(target, prop, receiver) {
			if (prop === "complete") {
				const complete = (target as { complete: CompleteFn }).complete;
				return async (req: Record<string, unknown>, signal?: AbortSignal) => {
					const r = await complete.call(target, req, signal);
					return typeof r?.content === "string" ? { ...r, content: conformExtraction(r.content) } : r;
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as P;
}

/** Build an LM Studio provider hardened for local OpenAI-compatible serving. */
export function lmStudioProvider(opts: LmStudioOptions = {}) {
	const baseURL = normaliseBaseURL(opts.baseURL ?? process.env.AGENT_TOOLKIT_MEMORY_BASE_URL ?? "http://localhost:1234");
	const model = opts.model ?? process.env.AGENT_TOOLKIT_MEMORY_MODEL ?? DEFAULT_EXTRACT_MODEL;
	const inner = new OpenAIProvider({ apiKey: opts.apiKey ?? "lm-studio", model, baseURL });
	return new Proxy(inner, {
		get(target, prop, receiver) {
			if (prop === "complete") {
				const fn = (target as unknown as { complete: CompleteFn }).complete;
				return (req: Record<string, unknown>, signal?: AbortSignal) => fn.call(target, stripJsonObjectMode(req), signal);
			}
			if (prop === "stream") {
				const fn = (target as unknown as { stream: StreamFn }).stream;
				return (req: Record<string, unknown>, signal?: AbortSignal) => fn.call(target, stripJsonObjectMode(req), signal);
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as OpenAIProvider;
}
