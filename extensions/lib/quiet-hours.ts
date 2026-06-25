/**
 * Quiet-hours (do-not-disturb) policy for the push channel — pure.
 *
 * During the configured window the agent keeps working, but routine notices are
 * HELD rather than pushed live; they are delivered as one batch when the window
 * ends (see the notify-watcher). Escalations always break through — an urgent
 * notice must not wait for morning. This is a delivery-time policy: every notice
 * is still recorded to the decision spine and notify.jsonl regardless, so the
 * dashboard and digests see everything; only live delivery is gated.
 *
 * The distinction is keyed on the notice kind: "escalate" breaks through, any
 * other kind (info / digest / summary / …) is held inside the window.
 */

import { type HoursWindow, isInHoursWindow } from "../heartbeat/schedule-gate.ts";

export type { HoursWindow };

export type DeliveryDecision = "deliver" | "hold";

/** Decide whether a notice may be delivered live now, or should be held. */
export function quietHoursDelivery(
	kind: string,
	window: HoursWindow | undefined,
	now: Date,
): DeliveryDecision {
	if (!window) return "deliver"; // no quiet hours configured
	if (kind === "escalate") return "deliver"; // urgent breaks through
	return isInHoursWindow(now, window) ? "hold" : "deliver";
}
