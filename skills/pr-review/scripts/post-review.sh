#!/usr/bin/env bash
#
# post-review.sh — Post PR review body comment + optional inline review comments.
#
# Usage:
#   post-review.sh --body FILE [--inline FILE] [--event EVENT] [--edit-last] [--dry-run]
#
# Arguments:
#   --body FILE      Path to markdown file for the body comment (required)
#   --inline FILE    Path to JSON file with inline comments (optional)
#   --event EVENT    Review event: REQUEST_CHANGES | COMMENT | APPROVE (default: COMMENT)
#   --edit-last      Update the most recent comment instead of posting new
#   --dry-run        Print what would be posted without actually posting
#
# Dependencies: bash, gh, jq, python3

set -euo pipefail

# --- Argument parsing ---

BODY_FILE=""
INLINE_FILE=""
EVENT="COMMENT"
EDIT_LAST=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --body)     BODY_FILE="$2"; shift 2 ;;
        --inline)   INLINE_FILE="$2"; shift 2 ;;
        --event)    EVENT="$2"; shift 2 ;;
        --edit-last) EDIT_LAST=true; shift ;;
        --dry-run)  DRY_RUN=true; shift ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$BODY_FILE" ]]; then
    echo "Error: --body FILE is required" >&2
    exit 1
fi

if [[ ! -f "$BODY_FILE" ]]; then
    echo "Error: Body file not found: $BODY_FILE" >&2
    exit 1
fi

# --- Detect PR context ---

PR_JSON=$(gh pr view --json number,headRefOid,url 2>/dev/null || true)
if [[ -z "$PR_JSON" ]]; then
    echo "Error: No open PR found for the current branch." >&2
    exit 1
fi

PR_NUMBER=$(echo "$PR_JSON" | jq -r '.number')
COMMIT_SHA=$(echo "$PR_JSON" | jq -r '.headRefOid')
PR_URL=$(echo "$PR_JSON" | jq -r '.url')

# Extract owner/repo from PR URL (https://github.com/OWNER/REPO/pull/N)
OWNER_REPO=$(echo "$PR_URL" | sed -E 's|https://github.com/([^/]+/[^/]+)/pull/[0-9]+|\1|')

echo "PR #${PR_NUMBER} | commit ${COMMIT_SHA:0:8} | ${OWNER_REPO}"

# --- Step 1: Post body comment ---

if [[ "$DRY_RUN" == true ]]; then
    echo ""
    echo "=== DRY RUN: Body comment ==="
    if [[ "$EDIT_LAST" == true ]]; then
        echo "Would UPDATE last comment with contents of: $BODY_FILE"
    else
        echo "Would POST new comment with contents of: $BODY_FILE"
    fi
    echo "Body size: $(wc -c < "$BODY_FILE") bytes"
else
    if [[ "$EDIT_LAST" == true ]]; then
        gh pr comment --edit-last --body-file "$BODY_FILE"
        echo "Updated existing PR comment."
    else
        gh pr comment --body-file "$BODY_FILE"
        echo "Posted new PR comment."
    fi
fi

# --- Step 2: Inline review comments ---

# Skip inline comments when editing (avoid duplicate threads)
if [[ "$EDIT_LAST" == true ]]; then
    echo "Skipping inline comments (--edit-last mode)."
    exit 0
fi

# Skip if no inline file provided or file is empty/missing
if [[ -z "$INLINE_FILE" ]]; then
    exit 0
fi

if [[ ! -f "$INLINE_FILE" ]]; then
    echo "Warning: Inline file not found: $INLINE_FILE — skipping inline comments."
    exit 0
fi

COMMENT_COUNT=$(jq '.comments | length' "$INLINE_FILE" 2>/dev/null || echo "0")
if [[ "$COMMENT_COUNT" == "0" ]]; then
    echo "No inline comments to post."
    exit 0
fi

echo ""
echo "Processing ${COMMENT_COUNT} inline comment(s)..."

# --- Step 2a: Fetch PR diff and extract valid ranges ---

DIFF=$(gh api "repos/${OWNER_REPO}/pulls/${PR_NUMBER}" \
    -H "Accept: application/vnd.github.v3.diff" 2>/dev/null || true)

if [[ -z "$DIFF" ]]; then
    echo "Warning: Could not fetch PR diff — skipping inline comments."
    exit 0
fi

# Parse diff hunks to extract valid {file: [[start, end], ...]} ranges
VALID_RANGES=$(echo "$DIFF" | python3 -c '
import sys, json, re

diff = sys.stdin.read()
ranges = {}
current_file = None

for line in diff.split("\n"):
    # Match diff header: +++ b/path/to/file
    m = re.match(r"^\+\+\+ b/(.+)$", line)
    if m:
        current_file = m.group(1)
        if current_file not in ranges:
            ranges[current_file] = []
        continue

    # Match hunk header: @@ -old,count +new,count @@
    m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
    if m and current_file:
        start = int(m.group(1))
        count = int(m.group(2)) if m.group(2) else 1
        end = start + count - 1
        ranges[current_file].append([start, end])

print(json.dumps(ranges))
' 2>/dev/null || echo "{}")

if [[ "$VALID_RANGES" == "{}" ]]; then
    echo "Warning: Could not parse diff ranges — skipping inline comments."
    exit 0
fi

# --- Step 2b: Validate and filter inline comments ---

VALIDATED_COMMENTS=$(python3 -c "
import json, sys

with open('$INLINE_FILE') as f:
    data = json.load(f)

ranges = json.loads('''$VALID_RANGES''')
valid = []
skipped = 0

for c in data.get('comments', []):
    path = c.get('path', '')
    line = c.get('line', 0)
    start_line = c.get('start_line')

    if path not in ranges:
        print(f'  Skipped: {path}:{line} — file not in diff', file=sys.stderr)
        skipped += 1
        continue

    # Check if the end line falls within any hunk range
    in_range = False
    for r_start, r_end in ranges[path]:
        if r_start <= line <= r_end:
            in_range = True
            break

    if not in_range:
        print(f'  Skipped: {path}:{line} — line not in diff hunk', file=sys.stderr)
        skipped += 1
        continue

    # Build the comment for the API
    comment = {
        'path': path,
        'line': line,
        'side': 'RIGHT',
        'body': c['body']
    }

    # Add start_line for multi-line comments if valid
    if start_line and start_line != line:
        comment['start_line'] = start_line
        comment['start_side'] = 'RIGHT'

    valid.append(comment)

if skipped:
    print(f'  {skipped} comment(s) skipped (outside diff)', file=sys.stderr)

print(json.dumps(valid))
" 2>/dev/null)

VALID_COUNT=$(echo "$VALIDATED_COMMENTS" | jq 'length' 2>/dev/null || echo "0")

if [[ "$VALID_COUNT" == "0" ]]; then
    echo "No inline comments within diff range — skipping."
    exit 0
fi

echo "${VALID_COUNT} inline comment(s) validated."

# --- Step 2c: Build and submit review ---

REVIEW_PAYLOAD=$(jq -n \
    --arg event "$EVENT" \
    --arg commit "$COMMIT_SHA" \
    --argjson comments "$VALIDATED_COMMENTS" \
    '{
        event: $event,
        commit_id: $commit,
        body: "",
        comments: $comments
    }')

if [[ "$DRY_RUN" == true ]]; then
    echo ""
    echo "=== DRY RUN: Inline review ==="
    echo "Event: $EVENT"
    echo "Commit: ${COMMIT_SHA:0:8}"
    echo "Comments:"
    echo "$REVIEW_PAYLOAD" | jq '.comments[] | {path, line, start_line}'
    echo ""
    echo "Full payload:"
    echo "$REVIEW_PAYLOAD" | jq '.'
    exit 0
fi

# Submit the review
RESPONSE=$(echo "$REVIEW_PAYLOAD" | gh api \
    "repos/${OWNER_REPO}/pulls/${PR_NUMBER}/reviews" \
    --method POST \
    --input - 2>&1) || {
    echo ""
    echo "Warning: Inline review submission failed."
    echo "  $RESPONSE"
    echo "  Body comment was already posted. All findings are visible there."
    exit 0
}

echo "Posted inline review with ${VALID_COUNT} comment(s)."
