#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_check-deps.sh"

# triage: Show untriaged/unassigned issues for a team
# Usage: triage.sh [OPTIONS] TEAM
#   --json       Output as JSON
#   --since DAYS Only show issues created in last N days (default: 7d)
#   --help       Show this help

DEFAULT_TEAM="LLE"

JSON_OUTPUT=false
SINCE="--since -7d"
TEAM=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) JSON_OUTPUT=true; shift ;;
        --since) SINCE="--since $2"; shift 2 ;;
        --help|-h)
            echo "Usage: triage.sh [OPTIONS] TEAM"
            echo ""
            echo "Show untriaged/unassigned issues for a team."
            echo ""
            echo "Options:"
            echo "  --json         Output as JSON"
            echo "  --since DAYS   Only issues created in last N (default: -7d)"
            echo "  --help         Show this help"
            exit 0
            ;;
        -*) echo "Unknown option: $1" >&2; exit 1 ;;
        *) TEAM="$1"; shift ;;
    esac
done

if [ -z "$TEAM" ]; then
    TEAM="$DEFAULT_TEAM"
fi

COMMON_FLAGS=(--no-pager --quiet)
if [ "$JSON_OUTPUT" = true ]; then
    COMMON_FLAGS+=(--output json --compact)
fi

echo "=== Triage Inbox ===" >&2
linear-cli triage inbox -t "$TEAM" "${COMMON_FLAGS[@]}" 2>/dev/null || {
    echo "(No triage inbox items)" >&2
}

echo "" >&2
echo "=== Unassigned Issues (last ${SINCE#--since }) ===" >&2
linear-cli issues list -t "$TEAM" \
    --filter "assignee.name=" \
    --filter "state.type!=completed" --filter "state.type!=cancelled" \
    $SINCE \
    "${COMMON_FLAGS[@]}" 2>/dev/null || {
    echo "(No unassigned issues found)" >&2
}
