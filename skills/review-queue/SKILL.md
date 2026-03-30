---
name: review-queue
description: Fetches open GitHub PRs waiting for your review. Use when user says "review queue", "PRs to review", "what needs my review", "pending reviews", "PRs needing attention", "what should I review", or "check review requests". Runs gh CLI search excluding drafts and already-reviewed PRs.
metadata:
  author: tvd
  version: 1.0.0
---

# Review Queue

## Instructions

1. Run `~/.claude/skills/review-queue/scripts/review-queue.sh`
2. The output JSON has `in_repo` (boolean) and `prs` (array)
3. Each PR object includes `needsRereview` (boolean), `myReviewState` (e.g. "COMMENTED", "APPROVED", or null), and `myReviewAt` (ISO timestamp or null)
4. Split PRs into two groups: **Re-review** (`needsRereview` is true) shown first, then **Fresh review** (everything else)
5. If `in_repo` is true, show tables with columns: #, Title (linked), Author, Age, and for re-review PRs add a "My Last Review" column showing the state
6. If `in_repo` is false, add a Repo column to the tables
7. If there are no PRs, relay the message
