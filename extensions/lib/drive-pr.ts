/**
 * Drive-to-green (Part B) — the autonomous "keep working until the PR is green"
 * process, as a prompt a worker runs in park/resume cycles.
 *
 * It is the autonomous variant of the address-pr-feedback skill: it reuses that
 * skill's proven scripts (fetch-pr-blockers.sh, reply-and-resolve.sh — which do
 * the gh GraphQL review-thread fetch + resolve and the failing-checks scan) but
 * acts end-to-end without an approval gate (act, then notify), and uses the
 * park tool to wait for CI / CodeRabbit between cycles instead of blocking. The
 * worker isolates the PR branch in a worktree (worktree_adopt), so it never
 * dirties anyone's checkout.
 *
 * Pure (just builds the prompt) so it is unit-tested and shared by the trigger CLI.
 */

export const DRIVE_PR_MARKER = "[drive-pr";

/** Whether a trigger prompt is a drive-to-green run. */
export function isDrivePrPrompt(prompt: string): boolean {
	return prompt.trimStart().startsWith(DRIVE_PR_MARKER);
}

/** Extract the PR number from a drive-pr prompt (e.g. "[drive-pr #4988] …"). */
export function parseDrivePrNumber(prompt: string): number | undefined {
	const match = /^\[drive-pr\s+#?(\d+)\]/.exec(prompt.trimStart());
	return match ? Number(match[1]) : undefined;
}

export type DrivePrOptions = {
	/** Local filesystem path to the PR's repo clone; the worker adopts the PR branch there. */
	repo: string;
	/** Absolute dir holding fetch-pr-blockers.sh + reply-and-resolve.sh. */
	scriptsDir: string;
};

/** Build the drive-to-green worker prompt for a PR. */
export function buildDrivePrPrompt(prNumber: number, opts: DrivePrOptions): string {
	const repo = opts.repo.trim();
	const scripts = opts.scriptsDir;
	const resume = `Resume driving PR #${prNumber}: re-run the cycle from step 1 (re-adopt the worktree, fetch, verify state, address, push, resolve, park).`;
	return [
		`[drive-pr #${prNumber}] You are autonomously driving GitHub PR #${prNumber} in ${repo} to a mergeable, all-green state, then reporting. Work like a principal engineer: act and report — do NOT ask for approval.`,
		``,
		`SETUP — do this at the start of EVERY cycle (separate bash calls do NOT share a working directory, so anchor every command explicitly):`,
		`- Isolate the PR branch (never dirty anyone's checkout): call the worktree_adopt tool with { pr: ${prNumber}, repo: "${repo}" }. It returns the worktree path — call it WT (idempotent: on a resumed cycle it returns the same existing worktree).`,
		`- Run EVERY git/gh/script command anchored to WT: prefix shell commands with \`cd "<WT>" && …\` (or use \`git -C "<WT>" …\`). Never rely on a previous cd persisting.`,
		`- Get the repo slug once: \`cd "<WT>" && gh repo view --json nameWithOwner -q .nameWithOwner\` → call it SLUG; pass \`-R "<SLUG>"\` to your own gh calls.`,
		`- Scripts (run them from WT so they resolve the right repo): ${scripts}/fetch-pr-blockers.sh and ${scripts}/reply-and-resolve.sh.`,
		``,
		`EACH CYCLE:`,
		`1. THREADS — \`cd "<WT>" && bash ${scripts}/fetch-pr-blockers.sh ${prNumber}\` → JSON: pr {mergeable, mergeStateStatus, isDraft}, threads [each: id (GraphQL), the first comment's databaseId, author, isBot, path, line, body], reviews [CHANGES_REQUESTED]. (Use this for the threads; verify CHECKS and REVIEW separately in step 2 — do NOT treat "no failing checks here" as green.)`,
		`2. STATE (authoritative — a brand-new PR has no blockers yet, which is NOT green): \`gh -R "<SLUG>" pr view ${prNumber} --json reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,headRefOid\`. Derive:`,
		`   - checksState: from statusCheckRollup — FAILED if any conclusion is FAILURE/CANCELLED/TIMED_OUT/ACTION_REQUIRED; PENDING if any is QUEUED/IN_PROGRESS/PENDING/EXPECTED, or the rollup is empty but checks are expected to run; GREEN only if every check is SUCCESS/NEUTRAL/SKIPPED and at least one check ran.`,
		`   - reviewed: has CodeRabbit reviewed THIS head commit? Check \`gh -R "<SLUG>" pr view ${prNumber} --json reviews,comments\` for a review or comment by coderabbitai[bot] dated at/after the head commit. (If CodeRabbit is clearly not configured for this repo, treat reviewed=true after one full cycle in which checks are GREEN; but by default WAIT for it.)`,
		`3. GREEN — you are DONE only when ALL hold: zero unresolved threads AND zero CHANGES_REQUESTED AND reviewDecision is APPROVED or REVIEW_NOT_REQUIRED (NOT REVIEW_REQUIRED) AND checksState=GREEN AND CodeRabbit has reviewed this head AND mergeable=MERGEABLE (mergeStateStatus not BLOCKED/DIRTY/BEHIND). Then post a short "ready to merge" summary as your final message and FINISH (do NOT merge, do NOT park).`,
		`4. WAIT — if checksState=PENDING, or CodeRabbit has not reviewed this head yet, or you just pushed: do NOT declare green. Call the park tool with { seconds: 180, prompt: "${resume}", reason: "waiting for CI/CodeRabbit" } and END YOUR TURN immediately.`,
		`5. ADDRESS — only if there are real blockers (failing checks, unresolved threads, CHANGES_REQUESTED). Triage each autonomously and fix in WT, grouped by logical change, scoped strictly to the feedback — no drive-by refactors:`,
		`   - Review threads: default APPLY (the reviewer is usually right). DISCUSS only when genuinely ambiguous / a real tradeoff; DECLINE only with a concrete, code-grounded reason.`,
		`   - CI failures: read the failing log (\`gh -R "<SLUG>" run view <run-id> --log-failed\`) and fix the ROOT CAUSE. If it is a pure flake, \`gh -R "<SLUG>" run rerun <run-id>\`.`,
		`   - Conflicts (mergeable=CONFLICTING / mergeStateStatus=DIRTY): rebase or merge the base and resolve. If you cannot resolve it safely, ESCALATE — never force-push.`,
		`6. PUSH — \`cd "<WT>" && git commit …\` then \`git push\` to the PR's head branch only. NEVER force-push. NEVER push to a protected/base branch (the guardrails floor blocks these too).`,
		`7. RESOLVE — ONLY AFTER the fix is pushed, per addressed thread: \`cd "<WT>" && bash ${scripts}/reply-and-resolve.sh ${prNumber} <thread-id> <first-comment-databaseId> "<reply>" [--no-resolve]\`:`,
		`   - Bot authors (isBot=true: CodeRabbit, Copilot, Greptile, Sourcery): RESOLVE on every action — reply "Done in <sha>." / the question / the reason, then resolve. Bots will not re-engage.`,
		`   - Human authors (isBot=false): resolve ONLY on apply. For discuss/decline pass --no-resolve and leave it for the human.`,
		`8. PARK & RE-CHECK — pushing re-triggers CI + a fresh CodeRabbit review. Call the park tool with { seconds: 180, prompt: "${resume}", reason: "re-check after push" } and END YOUR TURN.`,
		``,
		`SAFETY (hard rules — the guardrails floor also enforces the first three):`,
		`- NEVER merge the PR (no gh pr merge). NEVER force-push. NEVER push to a protected/base branch — only the PR's head branch.`,
		`- Resolve a thread only after its fix is pushed.`,
		`- Track the cycle count from the "[cycle N/…]" marker prepended to each resume. ESCALATE (report what is blocking as your final message; do not park) if you make no real progress across ~3 cycles, a human's CHANGES_REQUESTED needs a judgement you cannot safely make, a check keeps failing and you cannot fix it, or a conflict you cannot resolve. Do not loop forever.`,
		`- Record a one-line note of what you did each cycle so the trail is auditable.`,
	].join("\n");
}
