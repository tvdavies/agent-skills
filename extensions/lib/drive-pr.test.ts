import { describe, expect, it } from "bun:test";
import { buildDrivePrPrompt, DRIVE_PR_MARKER, isDrivePrPrompt, parseDrivePrNumber } from "./drive-pr";

describe("drive-pr protocol", () => {
	it("recognises and parses a drive-pr prompt", () => {
		const p = buildDrivePrPrompt(4988, { scriptsDir: "/s" });
		expect(p.startsWith(DRIVE_PR_MARKER)).toBe(true);
		expect(isDrivePrPrompt(p)).toBe(true);
		expect(isDrivePrPrompt("do something else")).toBe(false);
		expect(parseDrivePrNumber(p)).toBe(4988);
		expect(parseDrivePrNumber("not a drive-pr")).toBeUndefined();
	});

	it("embeds the PR, scripts, repo, park loop, and safety rails", () => {
		const p = buildDrivePrPrompt(123, { repo: "owner/name", scriptsDir: "/opt/scripts" });
		expect(p).toContain("#123");
		expect(p).toContain("owner/name");
		expect(p).toContain("/opt/scripts/fetch-pr-blockers.sh");
		expect(p).toContain("/opt/scripts/reply-and-resolve.sh");
		expect(p).toContain("worktree_adopt");
		expect(p).toContain("park(");
		// green condition + safety floor must be present
		expect(p).toContain("MERGEABLE");
		expect(p).toContain("NEVER merge");
		expect(p).toContain("NEVER force-push");
		expect(p).toContain("isBot");
		expect(p).toContain("ESCALATE");
	});

	it("works without a repo (drives a PR in the current repo)", () => {
		const p = buildDrivePrPrompt(7, { scriptsDir: "/s" });
		expect(p).toContain("#7");
		expect(p).not.toContain(' in undefined');
	});
});
