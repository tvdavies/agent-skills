/**
 * Park extension — lets a worker wait for an external change and resume itself.
 *
 * A `pi -p` worker exits at the end of its turn, so it cannot honour its own
 * in-process timer. Instead it calls `park({ prompt, seconds })`, which records a
 * park request and ends the turn; the daemon's worker pool resumes the exact same
 * session (`--continue`) at the due time with the given prompt, so the agent wakes
 * with full context. This is the worker-shaped equivalent of the in-session
 * scheduler — it makes a dormant worker into a state machine the daemon advances.
 *
 * Loaded into workers via -e (workers run --no-extensions). Outside a worker
 * session it is inert.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { stateDir } from "../extensions/lib/decisions.ts";
import { clampParkSeconds, writeParkRequest } from "../extensions/lib/park.ts";

const parkSchema = Type.Object({
	prompt: Type.String({
		description:
			"What to do when resumed — runs as your next message with full prior context (e.g. 'Re-check PR #4988: pull new CodeRabbit threads and CI status; address anything new; if still pending, park again.').",
	}),
	seconds: Type.Optional(Type.Number({ description: "How long to wait before resuming (clamped 30–3600). Default 180." })),
	minutes: Type.Optional(Type.Number({ description: "Convenience: minutes to wait (added to seconds)." })),
	reason: Type.Optional(Type.String({ description: "Short note on what you are waiting for." })),
});
type ParkInput = Static<typeof parkSchema>;

export default function parkExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "park",
		label: "park (wait + resume)",
		description:
			"Wait for an external change (CI, a code review, a deploy) and resume THIS session later with full context. Use to poll without holding the process open. After calling park, STOP — end your turn immediately; you will be resumed automatically at the due time with the prompt you provide. Only works inside a worker session.",
		promptSnippet: "Wait, then resume this session",
		parameters: parkSchema,
		async execute(_id, params: ParkInput) {
			const result = (text: string, details: Record<string, unknown>) => ({
				content: [{ type: "text" as const, text }],
				details,
			});
			const runId = process.env.AGENT_TOOLKIT_WORKER_RUN_ID;
			if (!runId) {
				return result("park is only available inside a worker session.", { ok: false });
			}
			const delay = clampParkSeconds((params.minutes ?? 0) * 60 + (params.seconds ?? 0) || 0);
			const dueAt = Date.now() + delay * 1000;
			writeParkRequest(stateDir(), { runId, dueAt, prompt: params.prompt, reason: params.reason });
			return result(
				`Parked for ${delay}s (resume at ${new Date(dueAt).toISOString()}). End your turn now — you will be resumed automatically with full context and your prompt.`,
				{ ok: true, dueAt, delay },
			);
		},
	});
}
