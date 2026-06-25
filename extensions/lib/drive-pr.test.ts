import { describe, expect, it } from "bun:test";
import { buildDrivePrPrompt, DRIVE_PR_MARKER, isDrivePrPrompt, parseDrivePrNumber } from "./drive-pr";

describe("drive-pr protocol", () => {
	it("recognises and parses a drive-pr prompt", () => {
		const p = buildDrivePrPrompt(4988, { repo: "/repos/x", scriptsDir: "/s" });
		expect(p.startsWith(DRIVE_PR_MARKER)).toBe(true);
		expect(isDrivePrPrompt(p)).toBe(true);
		expect(isDrivePrPrompt("do something else")).toBe(false);
		expect(parseDrivePrNumber(p)).toBe(4988);
		expect(parseDrivePrNumber("not a drive-pr")).toBeUndefined();
	});

	it("embeds the PR, scripts, repo, park loop, and safety rails", () => {
		const p = buildDrivePrPrompt(123, { repo: "/home/me/proj", scriptsDir: "/opt/scripts" });
		expect(p).toContain("#123");
		expect(p).toContain("/home/me/proj");
		expect(p).toContain("/opt/scripts/fetch-pr-blockers.sh");
		expect(p).toContain("/opt/scripts/reply-and-resolve.sh");
		expect(p).toContain("worktree_adopt");
		expect(p).toContain("park");
		expect(p).toContain("isBot");
		expect(p).toContain("ESCALATE");
	});

	it("verifies green authoritatively, not by absence of blockers", () => {
		const p = buildDrivePrPrompt(5, { repo: "/r", scriptsDir: "/s" });
		// must check the real check rollup + review decision + CodeRabbit-reviewed, not just "no failing checks"
		expect(p).toContain("statusCheckRollup");
		expect(p).toContain("reviewDecision");
		expect(p).toContain("coderabbitai");
		expect(p).toMatch(/do NOT treat .*no failing checks.* as green/i);
		// anchors commands to the worktree (bash cwd is not sticky)
		expect(p).toContain('cd "<WT>"');
	});

	it("forbids merge, force-push, and pushing to a protected branch", () => {
		const p = buildDrivePrPrompt(9, { repo: "/r", scriptsDir: "/s" });
		expect(p).toContain("NEVER merge");
		expect(p).toContain("NEVER force-push");
		expect(p).toContain("protected/base branch");
	});
});
