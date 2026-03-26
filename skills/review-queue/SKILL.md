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
3. If `in_repo` is true, show a table with columns: #, Title (linked), Author, Age
4. If `in_repo` is false, show a table with columns: Repo, #, Title (linked), Author, Age
5. If there are no PRs, relay the message
