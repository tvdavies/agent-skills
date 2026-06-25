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
	/** Local path or owner/name of the PR's repo; the worker adopts the PR branch there. */
	repo?: string;
	/** Absolute dir holding fetch-pr-blockers.sh + reply-and-resolve.sh. */
	scriptsDir: string;
};

/** Build the drive-to-green worker prompt for a PR. */
export function buildDrivePrPrompt(prNumber: number, opts: DrivePrOptions): string {
	const repo = opts.repo && opts.repo.trim() ? opts.repo.trim() : "";
	const scripts = opts.scriptsDir;
	const resumePrompt = `Resume driving PR #${prNumber} to green: re-run the cycle from step 1.`;
	return [
		`[drive-pr #${prNumber}] You are autonomously driving GitHub PR #${prNumber}${repo ? ` in ${repo}` : ""} to a mergeable, all-green state, then reporting. Work like a principal engineer: act and report — do NOT ask for approval.`,
		``,
		`SETUP (once):`,
		`- Isolate the PR branch so you never dirty anyone's checkout: call worktree_adopt({ pr: ${prNumber}${repo ? `, repo: "${repo}"` : ""} }) and cd into the returned worktree path. Run all git / gh / script commands from there. (On a resumed cycle the worktree already exists — adopt is idempotent.)`,
		`- The PR-blocker scripts live at ${scripts}: fetch-pr-blockers.sh and reply-and-resolve.sh.`,
		``,
		`EACH CYCLE:`,
		`1. Run \`bash ${scripts}/fetch-pr-blockers.sh ${prNumber}\`. It prints JSON: pr {mergeable, mergeStateStatus, isDraft}, threads [unresolved review threads: each has id (GraphQL), the first comment's databaseId, author, isBot, path, line, body], reviews [CHANGES_REQUESTED], checks [failing/cancelled/timed-out].`,
		`2. GREEN CHECK — you are DONE only when ALL hold: zero unresolved threads, zero failing/cancelled/timed-out checks, zero CHANGES_REQUESTED reviews, and mergeable=MERGEABLE (mergeStateStatus not BLOCKED/DIRTY/BEHIND). If green: post a short "ready to merge" summary as your final message and FINISH (do NOT merge, do NOT park).`,
		`3. WAITING — if checks are still pending/in-progress, OR you just pushed and CI/CodeRabbit have not re-run yet, OR CodeRabbit has not yet posted its initial review: do NOT declare green. Call park({ seconds: 180, prompt: "${resumePrompt}", reason: "waiting for CI/CodeRabbit" }) and END YOUR TURN immediately.`,
		`4. ADDRESS — triage every blocker autonomously and fix it in the worktree (grouped by logical change, scoped strictly to the feedback — no drive-by refactors):`,
		`   - Review threads: default APPLY the fix (the reviewer is usually right). DISCUSS only when genuinely ambiguous / a real tradeoff; DECLINE only with a concrete, code-grounded reason.`,
		`   - CI failures: read the failing log (\`gh run view <run-id> --log-failed\`, run id from the check link) and fix the ROOT CAUSE. If it is a pure flake with no real signal, \`gh run rerun <run-id>\` instead.`,
		`   - Merge conflicts (mergeable=CONFLICTING or mergeStateStatus=DIRTY): rebase/merge the base branch and resolve. If you cannot resolve it safely, escalate (step SAFETY) — do NOT force-push.`,
		`5. PUSH — commit with clear messages and \`git push\` to the PR's head branch. NEVER force-push. NEVER push to a protected or base branch (main/master/develop/production) — only the PR's own head branch.`,
		`6. RESOLVE — ONLY AFTER the fix is pushed, for each addressed thread run \`bash ${scripts}/reply-and-resolve.sh ${prNumber} <thread-id> <first-comment-databaseId> "<reply>" [--no-resolve]\`:`,
		`   - Bot authors (isBot=true: CodeRabbit, Copilot, Greptile, Sourcery): RESOLVE on every action — reply "Done in <sha>." (apply) / the question (discuss) / the reason (decline), then resolve. Bots will not re-engage.`,
		`   - Human authors (isBot=false): resolve ONLY on apply. For discuss/decline pass --no-resolve and leave the thread for the human.`,
		`7. PARK & RE-CHECK — pushing re-triggers CI + a fresh CodeRabbit review. Call park({ seconds: 180, prompt: "${resumePrompt}", reason: "re-check after push" }) and END YOUR TURN. On resume you start again at step 1.`,
		``,
		`SAFETY (hard rules):`,
		`- NEVER merge the PR. NEVER force-push. NEVER push to a protected/base branch.`,
		`- Resolve a thread only after its fix is pushed.`,
		`- Stop and ESCALATE (report what is blocking as your final message, do not park) if: you make no real progress across ~3 cycles; a human's CHANGES_REQUESTED needs a judgement you cannot safely make; a check keeps failing and you cannot fix it; or a conflict you cannot resolve. Do not loop forever.`,
		`- Record a one-line note of what you did each cycle so the trail is auditable.`,
	].join("\n");
}
