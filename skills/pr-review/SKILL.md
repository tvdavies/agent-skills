---
name: pr-review
description: Comprehensive PR review using parallel sub-agents for standards compliance, security, architecture, test coverage, ticket compliance, and build validation. Use when user says "review this PR", "review my changes", "check my PR", "pr review", "code review", "review the branch", "check before merge", "are my changes ready", or invokes /pr-review. Supports conversational output and GitHub PR comments.
metadata:
  author: tvd
  version: 1.0.0
---

# PR Review

Multi-agent pull request review that analyses code changes across six dimensions in parallel, then synthesises findings into a prioritised report. Designed for thorough, high-confidence reviews that surface real issues without manufacturing noise.

## Arguments

- `--since COMMIT_SHA`: Narrow the diff to `COMMIT_SHA...HEAD` for incremental re-review
- `--post`: Post the review as a GitHub PR comment instead of conversational output
- `--base BRANCH_NAME`: Override the detected base branch
- `--headless`: Non-interactive mode for CI/automation (see Headless Mode section)

## Working Directory

**Stay in the current working directory for the entire review.** Do not `cd` to the repository root or any other directory. If running inside a git worktree, all git commands, file reads, and sub-agent dispatches must operate within that worktree. When launching sub-agents via the Task tool, explicitly tell each sub-agent to work within the current directory and not change to another location.

## Phase 1: Context Gathering

Run these steps sequentially before dispatching sub-agents.

### 1.1 Detect Base Branch

```bash
git remote show origin | grep 'HEAD branch' | awk '{print $NF}'
```

Fallback to `main` if the command fails. Allow override via `--base` argument.

### 1.2 Gather Changes

**Always fetch the base branch from the remote before diffing** to avoid stale merge-base issues where already-merged commits appear in the diff:

```bash
git fetch origin BASE_BRANCH
```

Determine the diff range. When reviewing a PR by number, also fetch the PR's head branch:

```bash
# Fetch PR head branch (when reviewing by PR number)
git fetch origin PR_HEAD_BRANCH

# Diff range uses origin/ refs to ensure freshness:
# - Default (on the branch locally): origin/BASE_BRANCH...HEAD
# - Remote PR review (by number):    origin/BASE_BRANCH...origin/PR_HEAD_BRANCH
# - Incremental (--since):           COMMIT_SHA...HEAD (or ...origin/PR_HEAD_BRANCH)
```

Run these commands (replace RANGE with the resolved diff range):
```bash
git diff RANGE --name-only          # Changed files list
git log RANGE --oneline             # Commit history
git diff RANGE --stat               # Change statistics
git diff RANGE                      # Full diff (for sub-agents)
```

If no changes found, inform the user and stop.

**Important:** Never use a bare local branch name (e.g. `main`) in the diff range — always use `origin/BASE_BRANCH` to ensure you are comparing against the latest remote state. Using a stale local ref will include already-merged commits in the diff, leading to a review of code that is not part of the PR.

### 1.3 Detect Repo Context

Gather project context for sub-agents:
1. Read `CLAUDE.md` if it exists (project rules and conventions)
2. Detect package manager (pnpm, npm, yarn, bun) from lock files
3. Detect monorepo config (turborepo.json, pnpm-workspace.yaml, nx.json)
4. Detect test framework (jest, vitest, playwright) from config files
5. Detect linting setup (eslint, biome) from config files

### 1.4 Extract Ticket

Search the branch name for ticket ID patterns — any alphanumeric prefix followed by a number (e.g. `PROJ-1234`, `FE-42`, `fix/TEAM-567-description`). Also check recent commit messages for ticket references.

If a ticket ID is found, retrieve its details using this discovery order:

1. **Check available skills**: Look at the skills listed in the system prompt. If one matches the ticket's project management system (e.g. a Linear skill for Linear IDs, a Jira skill for Jira IDs), invoke it using the Skill tool to fetch the ticket details.
2. **Check CLI tools**: Try common CLIs via Bash — `linear-cli issues get TICKET_ID --output json --compact --no-pager --quiet`, `jira issue view TICKET_ID`, `gh issue view NUMBER`, etc. Use `which` or `command -v` to check availability before running.
3. **Check MCP tools**: If MCP tools for project management are available, use those.

If none of these approaches succeed, note the ticket ID in the summary but skip the ticket compliance sub-agent.

**Important**: The ticket details MUST be fetched here in Phase 1, not in the sub-agent. Sub-agents cannot invoke skills. Pass the fetched ticket text (title, description, acceptance criteria) directly into Sub-agent 5's prompt.

### 1.5 Categorise Files

Group changed files into categories:
- **Frontend**: `.tsx`, `.jsx`, `.css`, `.scss`, files under `app/`, `components/`, `pages/`
- **Backend**: `.ts`, `.js` files under `server/`, `api/`, `services/`, `apps/` (non-frontend)
- **Database**: `.prisma`, `.sql`, files under `drizzle/`, `migrations/`, `prisma/`
- **Infrastructure**: `Dockerfile`, `docker-compose`, `.tf`, `Makefile`, files under `infra/`
- **Packages**: Files under `packages/`
- **Tests**: `.test.ts`, `.spec.ts`, `.test.tsx`, files under `__tests__/`, `test/`
- **Config**: `package.json`, `tsconfig.json`, `.eslintrc`, `turbo.json`, etc.
- **Docs**: `.md`, `.mdx` files

## Phase 2: Dispatch Sub-agents

Launch all applicable sub-agents in a SINGLE message using the Task tool. Each sub-agent receives:
- The base branch and diff range
- The list of changed files with categories
- A summary of repo context (package manager, monorepo, test framework)
- The full contents of CLAUDE.md (if it exists)
- The finding format specification from `references/finding-format.md`

Read `references/finding-format.md` and include its contents in every sub-agent prompt.

### Sub-agent 1: Standards and Conventions

**Task tool config:** `subagent_type: "general-purpose"`, `model: "sonnet"`

Prompt focus:
- Check whether the code follows project conventions from CLAUDE.md (naming, imports, file structure, British English)
- Only flag deviations that would cause real confusion or maintenance burden — not minor stylistic preferences
- Type safety (no `any` casts, proper type usage, `type` vs `interface`)
- Only flag issues in changed lines, not pre-existing code

### Sub-agent 2: Security and Performance

**Task tool config:** `subagent_type: "general-purpose"`, `model: "sonnet"`

Prompt focus — Security:
- Hardcoded secrets, API keys, tokens in code or config
- Injection vulnerabilities (SQL, command, XSS, template)
- Missing authentication or authorisation checks
- Input validation gaps at system boundaries
- Insecure dependencies or patterns

Prompt focus — Performance:
- N+1 query patterns, missing database indexes
- Unbounded queries (no LIMIT, no pagination)
- Memory leaks (event listeners, unclosed resources)
- Unhandled promise rejections
- Large synchronous operations blocking the event loop

Security findings default to CRITICAL severity.

### Sub-agent 3: Architecture and Patterns

**Task tool config:** `subagent_type: "general-purpose"`, `model: "opus"`

Prompt focus:
- Assess whether the approach is sound — does the architecture make sense for what the PR is trying to do?
- Sub-agent MUST search for comparable code using Grep/Glob before flagging any inconsistency
- Only flag pattern deviations that would cause actual confusion or bugs, not stylistic differences
- Check for duplicate functionality (search if similar utility already exists)
- Evaluate error handling, service communication, and database access patterns for correctness

Scoping: The sub-agent may read unchanged files to understand context, but must only flag issues the PR creates or worsens.

### Sub-agent 4: Test Coverage

**Condition:** Only dispatch if test files changed OR new code paths were added (new functions, new endpoints, new branches).

**Task tool config:** `subagent_type: "general-purpose"`, `model: "sonnet"`

Prompt focus:
- Are the tests sufficient to have confidence in this change?
- Missing negative tests for important failure modes (not trivial guard clauses)
- Brittle tests that test implementation details rather than behaviour
- Tests that give false confidence (assertions that always pass, testing the wrong thing)

### Sub-agent 5: Ticket Compliance

**Condition:** Only dispatch if a ticket was found and its details were retrieved.

**Task tool config:** `subagent_type: "general-purpose"`, `model: "sonnet"`

Prompt focus:
- Coverage of all requirements listed in the ticket
- Acceptance criteria met
- Scope creep — flag as SUGGESTION, not as a defect
- Missing pieces or edge cases mentioned in the ticket
- Requirements that appear partially implemented

### Sub-agent 6: Build Validation

There are two modes depending on how the review was invoked:

**When reviewing a PR by number:** Do NOT run local build commands — they run against the wrong code and can cause side effects (e.g., turborepo writing cache/artifacts to a parent repo when running from a worktree). Instead, fetch GitHub CI status and Cloud Build details.

No sub-agent needed — run these in Phase 1 and include the results directly.

**Step 1 — Get check status from GitHub:**
```bash
gh pr checks PR_NUMBER --json name,state,link
```

**Step 2 — For any FAILED check with a Cloud Build link, fetch the build logs:**

Extract the build ID from the link URL (the UUID segment), then:
```bash
gcloud builds describe BUILD_ID \
  --region=europe-west2 \
  --project=lleverage \
  --account="dev-agent@lleverage.iam.gserviceaccount.com" \
  --format='json(status,steps.id,steps.status)'
```

If any step failed, get the raw logs and extract the relevant failure output:
```bash
gcloud builds log BUILD_ID \
  --region=europe-west2 \
  --project=lleverage \
  --account="dev-agent@lleverage.iam.gserviceaccount.com" 2>&1 | grep -A 50 "Step #N.*FAILED\|error TS\|ERR!\|FAIL " | head -60
```

**Report format:**

| Step | Status |
|------|--------|
| Format | PASS |
| Lint | PASS |
| Type Check | FAIL |
| Unit Tests | PASS |

For failures, include the first 20 lines of error output from the build logs. For PENDING builds, report PENDING and note the build is still running.

If Cloud Build access fails (permissions, auth), fall back to the `gh pr checks` pass/fail table with the console link.

**When reviewing the current local branch (no PR number):**

**Task tool config:** `subagent_type: "general-purpose"`, `model: "haiku"`

Run the following commands and report results:
1. **Type check**: Detect and run the project's type-check command (`pnpm type-check`, `npx tsc --noEmit`, etc.)
2. **Lint**: Detect and run the project's lint command (`pnpm lint`, `npx eslint .`, etc.)

Do NOT run tests — they take too long and will run as part of CI anyway.

Report a table with PASS / FAIL / NOT AVAILABLE for each check. For failures, include the first 20 lines of error output.

### Instructions for ALL Sub-agents

Include these instructions verbatim in every sub-agent prompt:

Your job is to assess whether this code is ready to merge. The expected answer is yes — most PRs are fine. You are not looking for things to criticise; you are looking for reasons to block or genuinely useful improvements.

CRITICAL and SHOULD_FIX = things that would make you block this PR in a real code review. These must be verified — read the surrounding code (not just the diff) to confirm that no existing guard, fallback, or handler already addresses the concern. If the issue is about a code path ("X could happen"), trace it to confirm it is actually reachable. A false positive at high severity is worse than a missed suggestion.

SUGGESTION = things the author would genuinely thank you for pointing out. Maximum 3 suggestions per agent. If you have more, keep only the most useful ones.

These are NOT findings — do not report them:
- Missing tests for trivial branches, early returns, or guard clauses
- Slightly broad hook dependencies (useEffect, useMemo) that cause harmless no-ops
- Theoretical edge cases that require multiple unlikely conditions to manifest
- Stylistic preferences when the current approach works correctly
- Types that could be narrower but are correct as-is
- An approach that works but could use a different pattern

Follow the finding format from the specification exactly. Only report findings with confidence at or above 80. List the files you reviewed — for files with findings, include the count; files without findings need only be listed. If you find nothing noteworthy, say so clearly. Do NOT manufacture findings to justify your existence. An empty category is a good sign, not a failure.

## Phase 3: Synthesise

Once all sub-agents return, process their findings:

### 3.1 Deduplicate

If multiple agents flag the same file + line range:
- Keep the most specific finding (the one with the clearest explanation and fix)
- Use the highest severity from the duplicates
- Note which agents independently identified the issue (increases confidence)

### 3.2 Filter Noise

Before cross-referencing with build, filter out low-value findings:
- Drop findings that are stylistic preferences when the current approach is correct
- Drop findings about theoretical edge cases that require multiple unlikely conditions
- Drop findings about test coverage for trivial code paths (early returns, guard clauses)
- Cap total suggestions at 3 across all agents — keep the most useful ones
- If no CRITICAL or SHOULD_FIX findings remain after filtering, keep the final output short

### 3.3 Cross-reference with Build

If build validation found type-check or lint failures:
- Link errors to related findings from other agents
- Elevate related findings if they explain the failure
- Add build context to the finding description

### 3.4 Sort and Prioritise

Order findings by severity, then by confidence:
1. **CRITICAL** (confidence 90-100): Must fix before merge
2. **SHOULD_FIX** (confidence 80-89): Important, should address
3. **SUGGESTION** (explicitly marked): Optional improvements

### 3.5 Count Totals

Calculate totals per severity for the summary section.

### 3.6 Identify Positives

Only note genuinely notable things — skip this section entirely if nothing stands out. Do not pad with generic praise like "good error handling" or "clean code."

## Phase 4: Present

### Default: Conversational Output

Present a structured summary. The output length should match the severity of the findings — clean PRs get short reviews.

**For APPROVE verdict** (no critical or should-fix findings):

1. **Verdict**: APPROVE
2. **Summary**: 2-3 sentences on what the PR does and that it looks good
3. **Build Status**: Table of type-check and lint results
4. **What's Good** (optional): Only if something is genuinely notable — skip if nothing stands out
5. **Files Reviewed**: Collapsible list

**For APPROVE_WITH_SUGGESTIONS** (only suggestions, no blockers):

1. **Verdict**: APPROVE_WITH_SUGGESTIONS
2. **Summary**: 2-3 sentences
3. **Build Status**: Table of type-check and lint results
4. **Suggestions**: Max 3 items, each with file/line, what, why, fix
5. **Files Reviewed**: Collapsible list

**For REQUEST_CHANGES** (at least one critical or should-fix finding):

1. **Verdict**: REQUEST_CHANGES
2. **Summary**: 2-3 sentences
3. **Build Status**: Table of type-check and lint results
4. **Ticket Compliance** (if applicable): Brief assessment of requirement coverage
5. **Findings by Severity**: Grouped sections, each finding with file/line, what, why, fix
6. **Suggestions** (if any, max 3)
7. **Files Reviewed**: Collapsible list

### GitHub Output (--post flag)

When the user requests posting to GitHub:

1. Read `references/github-output.md` for the complete template, formatting rules, and inline comment format
2. Format the synthesised findings into body markdown and write to `/tmp/pr-review.md`
3. For each CRITICAL and SHOULD_FIX finding, format an inline comment using the inline comment template from `references/github-output.md` and collect into `/tmp/pr-review-inline.json`. SUGGESTION findings do NOT get inline comments.
4. Map the verdict to a review event (see event mapping table in `references/github-output.md`)
5. Post via: `bash /path/to/skill/scripts/post-review.sh --body /tmp/pr-review.md --inline /tmp/pr-review-inline.json --event EVENT --pr PR_NUMBER` (use the skill's base directory path for the script)

**Important:** Always pass `--pr PR_NUMBER` to target the correct PR explicitly. Do not rely on auto-detection from the current branch — it can target the wrong PR when running from a worktree or detached HEAD.

If updating an existing review comment, use `--edit-last` flag (inline comments are skipped on updates to avoid duplicate threads).

**Never call `gh pr review` directly.** The script handles both the review body and the approval/request-changes event in a single atomic API call, preventing duplicate reviews. Calling `gh pr review` separately will create a second review.

## Incremental Re-review

When `--since COMMIT_SHA` is provided, the review shifts from a full assessment to a delta report — showing what changed since the last review.

### Context Gathering (incremental)

1. Narrow the diff to `COMMIT_SHA...HEAD` — only new commits are reviewed
2. Retrieve the previous review by reading the most recent PR comment that contains "PR Review" and "pr-review skill" (use `gh pr view --comments` or `gh api`)
3. Parse the previous review to extract its findings (file, lines, title, severity)
4. Run the full sub-agent analysis on the narrowed diff as normal

### Synthesise (incremental)

After sub-agents return, classify every finding into one of three categories:

**Resolved** — A finding from the previous review where:
- The file + line range was modified in the new commits, AND
- The issue described is no longer present in the current code
- If unsure whether it's truly fixed, read the current file to verify

**Still Open** — A finding from the previous review where:
- The file + line range was NOT modified in the new commits, OR
- The file was modified but the issue persists

**New** — A finding from the current review that:
- Was not present in the previous review (different file, different line range, or different issue)
- Applies only to code introduced in the new commits

### Present (incremental)

The incremental output uses a different structure from the full review. The three categories (Resolved, Still Open, New) replace the severity-grouped sections.

**Conversational output:**

1. **Header**: "Incremental review since `COMMIT_SHA`" with counts: N resolved, N still open, N new
2. **Resolved**: List with strikethrough titles — brief confirmation each was addressed
3. **Still Open**: Full finding details grouped by severity, same format as the full review
4. **New Findings**: Full finding details grouped by severity, same format as the full review
5. **Build Status**: Fresh build results from this run
6. **Verdict**: Based on the combined Still Open + New findings (resolved findings don't count)

**GitHub output:**

Always post as a **new comment** (never `--edit-last`) so the PR timeline shows progression. Read `references/github-output.md` for the incremental template format. Only generate inline comments for NEW findings — still-open findings already have conversation threads from the prior review.

### Edge Cases

- **No previous review found**: Fall back to a full review. Note in the summary: "No previous review found — performing full review."
- **Previous review can't be parsed**: Fall back to a full review with the narrowed diff. Note: "Could not parse previous review — reviewing new commits only, without delta tracking."
- **All previous findings resolved**: Celebrate briefly. Verdict based on new findings only.

## Headless Mode

When `--headless` is passed, the review runs fully non-interactively — designed for CI pipelines, GitHub Actions, or any automation that invokes Claude without a human in the loop.

**Behavioural overrides in headless mode:**

1. **Never ask questions.** Do not use AskUserQuestion under any circumstances. If something is ambiguous (multiple possible base branches, unclear ticket ID, etc.), make a best-effort decision and move on.
2. **Always post to GitHub.** Headless implies `--post`. The GitHub PR comment is the sole output — do not produce conversational text.
3. **Silent degradation.** If ticket tools are unavailable, skip ticket compliance without mentioning it in the summary. If a sub-agent fails or times out, continue with partial results — do not suggest re-running.
4. **No confirmation for build commands.** Run type-check, lint, and test commands without hesitation. These are read-only verification steps.
5. **Fail cleanly on no PR.** If `gh pr view` shows no open PR for the current branch, exit with a single line: "No open PR found for this branch." Do not offer to create one.
6. **Fail cleanly on no changes.** If no diff is found, exit with a single line: "No changes found between the base branch and HEAD."

**Example CI invocation:**

```bash
claude -p "/pr-review --headless"
```

Or with a specific base branch:

```bash
claude -p "/pr-review --headless --base main"
```

## Error Handling

### No changes detected
Inform the user: "No changes found between the base branch and HEAD. Make sure you have commits on your branch."

### Ticket details unavailable
Skip ticket compliance, note in the summary: "Ticket compliance not checked (no project management tool available to fetch ticket details)."

### Build command not found
Report NOT AVAILABLE for that check. Do not fail the review.

### Sub-agent timeout or failure
Report partial results from successful agents. Note which agents failed and suggest re-running.

### Inline comment posting fails
Body comment is always posted first. If inline review submission fails, warn the user. All findings remain in the body comment. Do not retry.
