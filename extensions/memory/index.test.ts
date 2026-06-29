import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import memoryExtension from "./index";

/** Minimal fake ExtensionAPI that captures everything the extension registers. */
function fakePi() {
	// biome-ignore lint/suspicious/noExplicitAny: test double
	const hooks: Record<string, (event: any) => any> = {};
	// biome-ignore lint/suspicious/noExplicitAny: test double
	const tools: Record<string, any> = {};
	// biome-ignore lint/suspicious/noExplicitAny: test double
	const commands: Record<string, any> = {};
	const api = {
		on(event: string, handler: (event: unknown) => unknown) {
			hooks[event] = handler;
		},
		registerTool(spec: { name: string }) {
			tools[spec.name] = spec;
		},
		registerCommand(name: string, spec: unknown) {
			commands[name] = spec;
		},
	};
	return { api: api as never, hooks, tools, commands };
}

/** Fetch a registered hook, asserting it exists (narrows away `undefined`). */
function hook(pi: ReturnType<typeof fakePi>, name: string) {
	const h = pi.hooks[name];
	if (!h) throw new Error(`hook ${name} not registered`);
	return h;
}

/** A fake `brain` executable: records argv + stdin, branches on the subcommand, and
 *  fails when BRAIN_FAIL is set so the degradation paths are exercised. */
const FAKE_BRAIN = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$BRAIN_ARGS_OUT"
if [ -n "$BRAIN_FAIL" ]; then echo "brain: simulated failure" >&2; exit 1; fi
case "$1" in
  query) printf '<brain_memories>\\nTom prefers bun test.\\n</brain_memories>\\n' ;;
  remember) cat > "$BRAIN_REMEMBER_OUT" ;;
  daemon) echo "brain daemon: alive" ;;
  *) echo "unknown" >&2; exit 2 ;;
esac
`;

let dir: string;
let argsOut: string;
let rememberOut: string;
const saved: Record<string, string | undefined> = {};

function setEnv(k: string, v: string | undefined) {
	if (!(k in saved)) saved[k] = process.env[k];
	if (v === undefined) delete process.env[k];
	else process.env[k] = v;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "mem-client-"));
	const brain = join(dir, "brain");
	writeFileSync(brain, FAKE_BRAIN, { mode: 0o755 });
	chmodSync(brain, 0o755);
	argsOut = join(dir, "args.txt");
	rememberOut = join(dir, "remember.jsonl");
	setEnv("AGENT_TOOLKIT_BRAIN_BIN", brain);
	setEnv("AGENT_TOOLKIT_MEMORY_ENGINE", "brain");
	setEnv("BRAIN_ARGS_OUT", argsOut);
	setEnv("BRAIN_REMEMBER_OUT", rememberOut);
	setEnv("BRAIN_FAIL", undefined);
});
afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	for (const k of Object.keys(saved)) delete saved[k];
	rmSync(dir, { recursive: true, force: true });
});

describe("memory extension — brain client", () => {
	it("is inert under a non-brain engine (registers nothing)", () => {
		setEnv("AGENT_TOOLKIT_MEMORY_ENGINE", "okf");
		const pi = fakePi();
		memoryExtension(pi.api);
		expect(Object.keys(pi.hooks)).toHaveLength(0);
		expect(Object.keys(pi.tools)).toHaveLength(0);
	});

	it("injects the brain_memories block + addendum on before_agent_start (reranker off)", async () => {
		const pi = fakePi();
		memoryExtension(pi.api);
		const res = await hook(pi, "before_agent_start")({ prompt: "how do I run tests?", systemPrompt: "BASE" });
		expect(res.systemPrompt).toContain("BASE");
		expect(res.systemPrompt).toContain("<!-- memory-addendum -->");
		expect(res.systemPrompt).toContain("Tom prefers bun test.");
		const args = readFileSync(argsOut, "utf8");
		expect(args).toContain("query");
		expect(args).toContain("--format");
		expect(args).toContain("context");
		expect(args).toContain("--no-rerank"); // per-turn recall skips the slow reranker
	});

	it("skips brain entirely for an empty prompt", async () => {
		const pi = fakePi();
		memoryExtension(pi.api);
		const res = await hook(pi, "before_agent_start")({ prompt: "   ", systemPrompt: "BASE" });
		expect(res.systemPrompt).toBe("BASE");
	});

	it("degrades to addendum-only (no throw) when brain fails on recall", async () => {
		setEnv("BRAIN_FAIL", "1");
		const pi = fakePi();
		memoryExtension(pi.api);
		const res = await hook(pi, "before_agent_start")({ prompt: "anything", systemPrompt: "BASE" });
		expect(res.systemPrompt).toContain("BASE");
		expect(res.systemPrompt).toContain("<!-- memory-addendum -->");
		// No actual recall block was injected (the addendum text mentions the tag itself).
		expect(res.systemPrompt).not.toContain("Tom prefers bun test.");
	});

	it("memory_remember pipes a well-formed JSONL turn to brain remember", async () => {
		const pi = fakePi();
		memoryExtension(pi.api);
		const out = await pi.tools.memory_remember.execute("id", { fact: "Deploy on Fridays via the release script." });
		expect(out.details.ok).toBe(true);
		const args = readFileSync(argsOut, "utf8");
		expect(args).toContain("remember");
		expect(args).toContain("--json");
		const turn = JSON.parse(readFileSync(rememberOut, "utf8").trim());
		expect(turn.role).toBe("user");
		expect(turn.text).toBe("Deploy on Fridays via the release script.");
		expect(typeof turn.recordedAt).toBe("string");
	});

	it("memory_query runs full-quality (reranker on) and returns the block", async () => {
		const pi = fakePi();
		memoryExtension(pi.api);
		const out = await pi.tools.memory_query.execute("id", { query: "test runner" });
		expect(out.details.ok).toBe(true);
		expect(out.content[0].text).toContain("Tom prefers bun test.");
		const args = readFileSync(argsOut, "utf8");
		expect(args).not.toContain("--no-rerank"); // explicit lookup keeps the reranker
	});

	it("tools return a graceful error (ok:false) when brain fails", async () => {
		setEnv("BRAIN_FAIL", "1");
		const pi = fakePi();
		memoryExtension(pi.api);
		const q = await pi.tools.memory_query.execute("id", { query: "x" });
		expect(q.details.ok).toBe(false);
		const r = await pi.tools.memory_remember.execute("id", { fact: "y" });
		expect(r.details.ok).toBe(false);
	});
});
