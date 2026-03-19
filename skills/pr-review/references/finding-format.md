# Finding Format Specification

This document defines the contract between sub-agents and the synthesiser. All sub-agents MUST follow this format exactly.

## Finding Structure

Report each finding using this exact structure:

```
severity: CRITICAL | SHOULD_FIX | SUGGESTION
confidence: 80-100
file: path/to/file.ts
lines: 42-45
title: Short description (under 80 characters)
what: One-line explanation of the issue
why: Why it matters (impact on users, security, reliability, maintainability)
fix: Concrete suggestion — either a brief instruction or a code snippet
agent: [your agent name]
```

All fields are required. Do not omit any field.

## Severity Definitions

### CRITICAL (confidence 90-100)

Issues that MUST be fixed before merge:

- Security vulnerabilities (injection, auth bypass, secret exposure)
- Data loss or corruption risks
- Breaking changes to public APIs or shared contracts
- Explicit violations of CLAUDE.md rules marked as critical
- Race conditions or concurrency bugs that cause incorrect behaviour

### SHOULD_FIX (confidence 80-89)

Issues that would cause a real problem in production, create meaningful confusion for the next developer, or represent a correctness risk:

- Missing input validation at system boundaries
- Performance issues that affect user experience
- Error handling gaps that would cause silent failures or data loss
- Logic errors or correctness risks in business-critical paths
- Tests that give false confidence (assertions that always pass, testing the wrong thing)

### SUGGESTION (explicitly marked)

Things the author would genuinely thank you for pointing out. If you wouldn't mention it in a real code review with a colleague, don't include it.

- Alternative approaches that are meaningfully cleaner (not just different)
- Opportunities for reuse or simplification that save real effort
- Scope creep (work beyond what the ticket requires)

Each agent may report at most 3 suggestions. If you have more, keep only the most useful ones.

Suggestions should always be marked with `severity: SUGGESTION` regardless of confidence score.

## Confidence Scale

- **90-100**: High confidence. You have verified this is a real issue by reading the surrounding code — not just the changed lines, but the full execution path including any guards, fallbacks, or handling logic nearby. Evidence is clear and you have confirmed no existing safeguard addresses the concern.
- **80-89**: Moderate confidence. Likely an issue but context might change your assessment.
- **Below 80**: Do NOT report. If you are not reasonably confident, do not include the finding.

### Verification requirement for CRITICAL findings

Before reporting any CRITICAL finding, you MUST:
1. Read the full function or block containing the issue, not just the changed lines
2. Check whether a guard, fallback, or error handler already addresses the concern — look at the lines immediately before and after the flagged range
3. Search for related handling elsewhere in the same file (e.g. a condition check, a try/catch, a validation step)
4. If the concern is about a code path (e.g. "X could happen"), trace the path to confirm it is actually reachable

If you cannot confirm the issue after these steps, downgrade to SHOULD_FIX or drop it entirely. A false CRITICAL is worse than a missed SUGGESTION — it wastes reviewer time and erodes trust in the review.

## Scoping Rule

Review the changed code and any surrounding context necessary to evaluate its correctness. Do not flag pre-existing issues in unchanged code unless the PR's changes make them newly relevant or dangerous. If you read an unchanged file to understand context, that's expected — but don't generate findings against it unless the PR creates or worsens the problem.

## Completeness Rule

After reviewing, list the files you reviewed. For files with findings, include the count. Files without findings need only be listed — no need to explicitly say "no issues found" for each one.

```
## Files Reviewed
- path/to/changed-file-1.ts: 2 findings (1 CRITICAL, 1 SHOULD_FIX)
- path/to/changed-file-2.ts
- path/to/changed-file-3.tsx: 1 finding (1 SUGGESTION)
```

## Anti-padding Rule

If you find nothing noteworthy, say so clearly. Do NOT manufacture findings to justify your existence. An empty category is a good sign, not a failure. A review that says "No issues found" is perfectly valid and valuable — it means the code is clean.

## Examples

### Good Finding

```
severity: CRITICAL
confidence: 95
file: src/api/routers/billing.ts
lines: 45-48
title: Missing authorisation check on billing endpoint
what: The updateBillingPlan handler uses a basic auth check instead of an owner-level permission guard
why: Any authenticated user can modify another organisation's billing plan
fix: Replace the generic auth middleware with the owner-role guard on line 45
agent: security-performance
```

### Bad Finding (do NOT produce findings like this)

```
severity: SHOULD_FIX
confidence: 60
file: apps/app/src/components/button.tsx
lines: 1-100
title: Could use better naming
what: Some variable names could be improved
why: Readability
fix: Consider renaming variables
agent: standards
```

Problems: confidence below 80, vague description, no specific line range, no concrete fix, pre-existing code not changed in the PR.

### Not a Finding (do NOT report these)

- A missing test for a trivial early-return or guard clause
- A useEffect/useMemo dependency that is slightly broader than necessary but causes no harm
- A type that could be narrower but is correct as-is
- An approach that works correctly but could use a different pattern
- Style preferences not covered by the project's linter or CLAUDE.md
- Theoretical issues requiring multiple unlikely conditions to manifest
- Minor naming preferences when the current names are clear enough
