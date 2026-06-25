/**
 * TADU actor model — the contract that lets the task board be a *bidirectional*
 * control plane without echo loops.
 *
 * Every TADU write records an `actor`: the env `TADU_ACTOR`, else the git user
 * (so on this single-user box every write defaults to "Tom Davies"). The toolkit
 * drives the board — it moves lanes and appends decision comments — AND the human
 * drives it — dragging cards, commenting on tasks. Both write the same store. To
 * react to the human's intent without re-reacting to its own writes, the daemon
 * stamps every system-originated write with one known identity, `AGENT_ACTOR`,
 * and treats every other actor as human. That is the echo-loop guard: the watch
 * loop acts only on events whose origin is "human".
 *
 * The discipline this enforces:
 *  - EVERY system write to TADU (pool lane moves, decision comments, trigger task
 *    creation, any worker-side `tadu` use) is stamped via {@link agentTaduEnv}.
 *  - The daemon process MUST NOT export `TADU_ACTOR` globally — otherwise a future
 *    board write made from inside the daemon would be mis-stamped as the agent and
 *    the human's drag would be ignored. Stamping is always per-invocation.
 *
 * Pure and dependency-free (beyond the event type) so classification is tested in
 * isolation.
 */

import type { TaduEvent } from "./tadu.ts";

/** The single identity stamped on every system-originated TADU write. */
export const AGENT_ACTOR = "agent:toolkit";

export type TaduEventOrigin = "agent" | "human";

/**
 * Classify an actor: our own writes vs. anything external. Anything that is not
 * exactly {@link AGENT_ACTOR} is treated as human — an allow-list of one — so a
 * write that somehow slipped through unstamped is never reacted to as if it were
 * the agent (fail towards "ask", not "echo").
 */
export function actorOrigin(actor: string | undefined): TaduEventOrigin {
	return actor === AGENT_ACTOR ? "agent" : "human";
}

/**
 * Event types the control plane reacts to. A human dragging a card emits
 * `task.moved`; a human comment emits `task.commented`. Other types — created via
 * triggers, labelled, linked — are not direct control signals.
 */
export const CONTROL_EVENT_TYPES: ReadonlySet<string> = new Set(["task.moved", "task.commented"]);

/**
 * Whether an event is a human-initiated control signal (a lane drag or a comment),
 * as opposed to an echo of one of our own writes. This is the seam the control
 * loop fills: react here, ignore everything else.
 */
export function isHumanControlEvent(event: TaduEvent): boolean {
	return CONTROL_EVENT_TYPES.has(event.type) && actorOrigin(event.actor) === "human";
}

/**
 * Stamp an environment so a spawned `tadu` write is attributed to the agent. Use
 * for every system-originated write so it is never mistaken for human intent by
 * the watch loop.
 */
export function agentTaduEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return { ...env, TADU_ACTOR: AGENT_ACTOR };
}
