#!/usr/bin/env bash
# fetch-pr-blockers.sh — print one JSON document with everything blocking a GitHub PR from merging.
#
# Sections: pr (meta + mergeability), threads (unresolved review threads), reviews
# (CHANGES_REQUESTED), checks (failing/cancelled/timed-out).
#
# Usage: fetch-pr-blockers.sh [<pr-number>]
# If pr-number is omitted, derives from the current branch via `gh pr view`.

set -euo pipefail

command -v gh >/dev/null || { echo "fetch-pr-blockers: 'gh' not found" >&2; exit 127; }
command -v jq >/dev/null || { echo "fetch-pr-blockers: 'jq' not found" >&2; exit 127; }

pr="${1:-}"
if [[ -z "$pr" ]]; then
  pr=$(gh pr view --json number -q .number)
fi

repo_info=$(gh repo view --json owner,name)
owner=$(jq -r .owner.login <<<"$repo_info")
name=$(jq -r .name <<<"$repo_info")

pr_meta=$(gh pr view "$pr" --json number,title,headRefName,baseRefName,mergeable,mergeStateStatus,isDraft,url)

checks=$(gh pr checks "$pr" --json name,state,link,workflow 2>/dev/null \
  | jq '[.[] | select(.state == "FAILURE" or .state == "CANCELLED" or .state == "TIMED_OUT")]' \
  || echo "[]")

reviews=$(gh pr view "$pr" --json reviews \
  | jq '[.reviews[] | select(.state == "CHANGES_REQUESTED") | {author: .author.login, state, body, submittedAt}]')

threads=$(gh api graphql -F owner="$owner" -F name="$name" -F pr="$pr" -f query='
  query($owner:String!, $name:String!, $pr:Int!) {
    repository(owner:$owner, name:$name) {
      pullRequest(number:$pr) {
        reviewThreads(first:100) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            originalLine
            comments(first:50) {
              nodes { databaseId author { login __typename } body url createdAt }
            }
          }
        }
      }
    }
  }' \
  | jq '[
      .data.repository.pullRequest.reviewThreads.nodes[]
      | select(.isResolved == false)
      | {
          id,
          isOutdated,
          path,
          line: (.line // .originalLine),
          firstCommentDatabaseId: (.comments.nodes[0].databaseId),
          author: (.comments.nodes[0].author.login),
          isBot: (
            (.comments.nodes[0].author.__typename == "Bot")
            or ((.comments.nodes[0].author.login // "") | endswith("[bot]"))
            or ((.comments.nodes[0].author.login // "" | ascii_downcase) | IN("coderabbitai", "greptileai", "sourcery-ai", "codacy-production"))
          ),
          comments: [.comments.nodes[] | {databaseId, author: .author.login, authorType: .author.__typename, body, url, createdAt}]
        }
    ]')

jq -n \
  --argjson pr "$pr_meta" \
  --argjson threads "$threads" \
  --argjson reviews "$reviews" \
  --argjson checks "$checks" \
  '{pr: $pr, threads: $threads, reviews: $reviews, checks: $checks}'
