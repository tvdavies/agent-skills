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

Issues that SHOULD be addressed but are not blockers:

- Pattern inconsistencies with the codebase
- Code quality issues (poor naming, unclear logic, missing error handling)
- Missing input validation at system boundaries
- Performance issues that affect user experience
- Test quality problems (brittle tests, missing edge cases)

### SUGGESTION (explicitly marked)

Optional improvements — nice to have:

- Minor style preferences
- Alternative approaches that might be cleaner
- Opportunities for reuse or simplification
- Documentation improvements
- Scope creep (work beyond what the ticket requires)

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

After reviewing, list every changed file with either your findings or "No issues found." This ensures completeness in a single pass. Use this format at the end of your response:

```
## Files Reviewed
- path/to/changed-file-1.ts: 2 findings (1 CRITICAL, 1 SHOULD_FIX)
- path/to/changed-file-2.ts: No issues found
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
