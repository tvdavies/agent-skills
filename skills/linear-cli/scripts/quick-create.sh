#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_check-deps.sh"

# quick-create: Create a Linear issue with common defaults
# Usage: quick-create.sh [OPTIONS] [TEAM] "Title"
#   -p, --priority N    Priority (1=urgent, 2=high, 3=normal, 4=low) [default: 3]
#   -a, --assignee WHO  Assignee (default: me)
#   -l, --label LABEL   Label to add (can repeat)
#   -d, --description   Description (markdown)
#   --due DATE          Due date (today, tomorrow, +3d, +1w, YYYY-MM-DD)
#   -e, --estimate N    Estimate in points
#   --project NAME      Add to a project
#   --json              Output as JSON
#   --dry-run           Preview without creating
#   --help              Show this help

DEFAULT_TEAM="LLE"

JSON_OUTPUT=false
DRY_RUN=false
TEAM=""
TITLE=""
PRIORITY="3"
ASSIGNEE="me"
LABELS=()
POSITIONAL=()
DESCRIPTION=""
DUE=""
ESTIMATE=""
PROJECT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--priority) PRIORITY="$2"; shift 2 ;;
        -a|--assignee) ASSIGNEE="$2"; shift 2 ;;
        -l|--label) LABELS+=("$2"); shift 2 ;;
        -d|--description) DESCRIPTION="$2"; shift 2 ;;
        --due) DUE="$2"; shift 2 ;;
        -e|--estimate) ESTIMATE="$2"; shift 2 ;;
        --project) PROJECT="$2"; shift 2 ;;
        --json) JSON_OUTPUT=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --help|-h)
            echo "Usage: quick-create.sh [OPTIONS] TEAM \"Title\""
            echo ""
            echo "Create an issue with common defaults (priority=normal, assignee=me)."
            echo ""
            echo "Options:"
            echo "  -p, --priority N    Priority 1-4 (default: 3=normal)"
            echo "  -a, --assignee WHO  Assignee (default: me)"
            echo "  -l, --label LABEL   Label (repeatable)"
            echo "  -d, --description   Description (markdown)"
            echo "  --due DATE          Due date"
            echo "  -e, --estimate N    Estimate in points"
            echo "  --project NAME      Add to project"
            echo "  --json              Output as JSON"
            echo "  --dry-run           Preview without creating"
            echo "  --help              Show this help"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2; exit 1 ;;
        *)
            POSITIONAL+=("$1")
            shift
            ;;
    esac
done

# Parse positional args: [TEAM] "Title"
# If one arg: it's the title, use default team
# If two args: first is team, second is title
if [ ${#POSITIONAL[@]} -eq 0 ]; then
    echo "Error: Title is required." >&2
    echo "Usage: quick-create.sh [TEAM] \"Title\"" >&2
    exit 1
elif [ ${#POSITIONAL[@]} -eq 1 ]; then
    TEAM="$DEFAULT_TEAM"
    TITLE="${POSITIONAL[0]}"
elif [ ${#POSITIONAL[@]} -eq 2 ]; then
    TEAM="${POSITIONAL[0]}"
    TITLE="${POSITIONAL[1]}"
else
    echo "Error: Too many positional arguments." >&2
    echo "Usage: quick-create.sh [TEAM] \"Title\"" >&2
    exit 1
fi

COMMON_FLAGS=(--no-pager --quiet)
if [ "$JSON_OUTPUT" = true ]; then
    COMMON_FLAGS+=(--output json --compact)
fi

CMD=(linear-cli issues create "$TITLE" -t "$TEAM" -p "$PRIORITY" -a "$ASSIGNEE")

for label in "${LABELS[@]}"; do
    CMD+=(-l "$label")
done

if [ -n "$DESCRIPTION" ]; then
    CMD+=(-d "$DESCRIPTION")
fi

if [ -n "$DUE" ]; then
    CMD+=(--due "$DUE")
fi

if [ -n "$ESTIMATE" ]; then
    CMD+=(-e "$ESTIMATE")
fi

if [ "$DRY_RUN" = true ]; then
    CMD+=(--dry-run)
fi

CMD+=("${COMMON_FLAGS[@]}")

"${CMD[@]}"
