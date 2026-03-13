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

## Phase 1: Context Gathering

Run these steps sequentially before dispatching sub-agents.

### 1.1 Detect Base Branch

```bash
git remote show origin | grep 'HEAD branch' | awk '{print $NF}'
```

Fallback to `main` if the command fails. Allow override via `--base` argument.

### 1.2 Gather Changes

Determine the diff range:
- Default: `BASE_BRANCH...HEAD`
- If `--since COMMIT_SHA` provided: `COMMIT_SHA...HEAD`

Run these commands (replace BASE_BRANCH and RANGE with actual values):
```bash
git diff RANGE --name-only          # Changed files list
git log BASE_BRANCH..HEAD --oneline # Commit history
git diff RANGE --stat               # Change statistics
git diff RANGE                      # Full diff (for sub-agents)
```

If no changes found, inform the user and stop.

### 1.3 Detect Repo Context

Gather project context for sub-agents:
1. Read `CLAUDE.md` if it exists (project rules and conventions)
2. Detect package manager (pnpm, npm, yarn, bun) from lock files
3. Detect monorepo config (turborepo.json, pnpm-workspace.yaml, nx.json)
4. Detect test framework (jest, vitest, playwright) from config files
5. Detect linting setup (eslint, biome) from config files

### 1.4 Extract Ticket

Search the branch name for ticket ID patterns — any alphanumeric prefix followed by a number (e.g. `PROJ-1234`, `FE-42`, `fix/TEAM-567-description`). Also check recent commit messages for ticket references.

If a ticket ID is found, attempt to retrieve its details using whatever project management tools are available (skills, MCP servers, CLI tools). The skill should infer the appropriate tool from context — e.g. a Linear skill, Jira MCP, GitHub Issues CLI, etc. If no tool is available to fetch ticket details, note the ticket ID in the summary but skip the ticket compliance sub-agent.

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
- CLAUDE.md rule compliance (naming conventions, import patterns, file structure, British English)
- Code style consistency (formatting, naming, export patterns)
- Type safety (no `any` casts, proper type usage, `type` vs `interface`)
- Import patterns (alias usage, no relative imports where aliases expected)
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
- Pattern consistency with the existing codebase (sub-agent MUST search for comparable code using Grep/Glob before flagging inconsistencies)
- Appropriate abstractions and module boundaries
- Error handling patterns (consistent with project conventions)
- Duplicate functionality detection (search if similar utility already exists)
- Service communication patterns (APIs, RPC, message queues — whatever the project uses)
- Database access patterns (ORM usage, transaction boundaries, query patterns)

Scoping: The sub-agent may read unchanged files to understand context, but must only flag issues the PR creates or worsens.

### Sub-agent 4: Test Coverage

**Condition:** Only dispatch if test files changed OR new code paths were added (new functions, new endpoints, new branches).

**Task tool config:** `subagent_type: "general-purpose"`, `model: "sonnet"`

Prompt focus:
- Untested error handling paths and edge cases
- Missing negative tests (what happens when things fail?)
- Brittle tests that test implementation details rather than behaviour
- Test data quality (realistic scenarios vs trivial mocks)
- Rate test criticality 1-10 for each finding

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

**Task tool config:** `subagent_type: "general-purpose"`, `model: "haiku"`

Run the following commands and report results:
1. **Type check**: Detect and run the project's type-check command (`pnpm type-check`, `npx tsc --noEmit`, etc.)
2. **Lint**: Detect and run the project's lint command (`pnpm lint`, `npx eslint .`, etc.)

Do NOT run tests — they take too long and will run as part of CI anyway.

Report a table with PASS / FAIL / NOT AVAILABLE for each check. For failures, include the first 20 lines of error output.

### Instructions for ALL Sub-agents

Include these instructions verbatim in every sub-agent prompt:

Follow the finding format from the specification exactly. Only report findings with confidence at or above 80. After reviewing, list every changed file and confirm "no issues" for clean files. If you find nothing noteworthy, say so clearly. Do NOT manufacture findings to justify your existence. An empty category is a good sign, not a failure.

Before reporting any CRITICAL or SHOULD_FIX finding, verify the full execution path — read the surrounding code (not just the diff) to confirm that no existing guard, fallback, or handler already addresses the concern. If the issue is about a code path ("X could happen"), trace it to confirm it is actually reachable. A false positive at high severity is worse than a missed suggestion.

## Phase 3: Synthesise

Once all sub-agents return, process their findings:

### 3.1 Deduplicate

If multiple agents flag the same file + line range:
- Keep the most specific finding (the one with the clearest explanation and fix)
- Use the highest severity from the duplicates
- Note which agents independently identified the issue (increases confidence)

### 3.2 Cross-reference with Build

If build validation found type-check or lint failures:
- Link errors to related findings from other agents
- Elevate related findings if they explain the failure
- Add build context to the finding description

### 3.3 Sort and Prioritise

Order findings by severity, then by confidence:
1. **CRITICAL** (confidence 90-100): Must fix before merge
2. **SHOULD_FIX** (confidence 80-89): Important, should address
3. **SUGGESTION** (explicitly marked): Optional improvements

### 3.4 Count Totals

Calculate totals per severity for the summary section.

### 3.5 Identify Positives

Note things done well:
- Good test coverage for complex logic
- Proper error handling patterns
- Clean separation of concerns
- Effective use of existing utilities
- Security best practices followed

## Phase 4: Present

### Default: Conversational Output

Present a structured summary:

1. **Verdict**: One of APPROVE / APPROVE_WITH_SUGGESTIONS / REQUEST_CHANGES
   - APPROVE: No critical or should-fix findings
   - APPROVE_WITH_SUGGESTIONS: Only suggestions, no blockers
   - REQUEST_CHANGES: At least one critical or should-fix finding

2. **Summary**: 2-3 sentences covering what the PR does and overall quality assessment

3. **Build Status**: Table of type-check and lint results (only in conversational output — omit from GitHub comments since CI covers this)

4. **Ticket Compliance** (if applicable): Brief assessment of requirement coverage

5. **Findings by Severity**: Grouped sections, each finding with:
   - File and line reference
   - What the issue is
   - Why it matters
   - Suggested fix

6. **What's Good**: Positive observations (keep brief, 2-4 bullet points)

7. **Files Reviewed**: Complete list of reviewed files

### GitHub Output (--post flag)

When the user requests posting to GitHub:

1. Read `references/github-output.md` for the complete template, formatting rules, and inline comment format
2. Format the synthesised findings into body markdown and write to `/tmp/pr-review.md`
3. For each CRITICAL and SHOULD_FIX finding, format an inline comment using the inline comment template from `references/github-output.md` and collect into `/tmp/pr-review-inline.json`. SUGGESTION findings do NOT get inline comments.
4. Map the verdict to a review event (see event mapping table in `references/github-output.md`)
5. Post via: `bash /path/to/skill/scripts/post-review.sh --body /tmp/pr-review.md --inline /tmp/pr-review-inline.json --event EVENT` (run from the repo root so `gh pr view` can detect the PR; use the skill's base directory path for the script)

If updating an existing review comment, use `--edit-last` flag (inline comments are skipped on updates to avoid duplicate threads).

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
