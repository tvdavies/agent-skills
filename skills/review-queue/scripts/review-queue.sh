#!/usr/bin/env bash
set -eo pipefail

# Detect if we're in a git repo and get the owner/repo
CURRENT_REPO=""
if git rev-parse --is-inside-work-tree &>/dev/null; then
  CURRENT_REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || true)
fi

# Fetch open PRs requesting my review (non-draft, no changes_requested from anyone)
if [ -n "$CURRENT_REPO" ]; then
  prs=$(gh search prs \
    --review-requested=@me \
    --state=open \
    --draft=false \
    --repo "$CURRENT_REPO" \
    --json repository,title,author,url,number,createdAt \
    --jq '.')
else
  prs=$(gh search prs \
    --review-requested=@me \
    --state=open \
    --draft=false \
    --json repository,title,author,url,number,createdAt \
    --jq '.')
fi

if [ -z "$prs" ] || [ "$prs" = "[]" ]; then
  echo "No PRs are currently waiting for your review."
  exit 0
fi

# Filter out PRs where any reviewer has requested changes
echo "$prs" | jq -c '.[]' | while read -r pr; do
  repo=$(echo "$pr" | jq -r '.repository.nameWithOwner')
  number=$(echo "$pr" | jq -r '.number')

  changes_requested=$(gh pr view "$number" --repo "$repo" --json reviews \
    --jq '[.reviews[] | select(.state == "CHANGES_REQUESTED")] | length' 2>/dev/null || echo "0")

  if [ "$changes_requested" = "0" ]; then
    echo "$pr"
  fi
done | jq -s --arg current_repo "$CURRENT_REPO" '{in_repo: ($current_repo != ""), repo: $current_repo, prs: .}'
