/**
 * Trigger router (pure) — decide whether a trigger runs on the resident
 * orchestrator session or is delegated to a worker.
 *
 * The orchestrator stays free for conversation, supervision (heartbeats), and
 * anything expecting a low-latency reply. Discrete tracked work — a trigger that
 * carries a TADU task — is delegated to the worker pool so it runs as its own
 * session, concurrently, without blocking the orchestrator. This is the fleet
 * split: a thin supervisor up top, most work in subprocesses below.
 */

import { isHeartbeatPrompt } from "../extensions/heartbeat/protocol.ts";
import type { Trigger } from "./inbox.ts";

export type Route = "worker" | "orchestrator";

/**
 * Where a trigger should run. Heartbeats are supervision (orchestrator, which may
 * itself delegate). A reply-expecting trigger (e.g. a Slack DM) is conversational
 * (orchestrator). A trigger carrying a TADU task is discrete tracked work → a
 * worker. Everything else defaults to the orchestrator.
 */
export function classifyTrigger(trigger: Trigger): Route {
	if (isHeartbeatPrompt(trigger.text)) return "orchestrator";
	if (trigger.origin) return "orchestrator";
	if (trigger.taduTask) return "worker";
	return "orchestrator";
}
