#!/usr/bin/env bash
set -euo pipefail

# my-issues: Show MY assigned issues, defaulting to current cycle
# Usage: my-issues.sh [OPTIONS] [TEAM]
#   --all        Show all my open issues, not just current cycle
#   --json       Output as JSON (for agent consumption)
#   --team TEAM  Filter to a specific team (or pass as positional arg)
#   --help       Show this help

DEFAULT_TEAM="LLE"

SHOW_ALL=false
JSON_OUTPUT=false
TEAM=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all) SHOW_ALL=true; shift ;;
        --json) JSON_OUTPUT=true; shift ;;
        --team) TEAM="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: my-issues.sh [OPTIONS] [TEAM]"
            echo ""
            echo "Show your assigned issues. Defaults to current cycle for $DEFAULT_TEAM."
            echo ""
            echo "Options:"
            echo "  --all        Show all my open issues, not just current cycle"
            echo "  --json       Output as JSON"
            echo "  --team TEAM  Filter to a specific team (default: $DEFAULT_TEAM)"
            echo "  --help       Show this help"
            exit 0
            ;;
        -*) echo "Unknown option: $1" >&2; exit 1 ;;
        *) TEAM="$1"; shift ;;
    esac
done

if [ -z "$TEAM" ]; then
    TEAM="$DEFAULT_TEAM"
fi

if [ "$SHOW_ALL" = true ]; then
    # Show all my open issues (no cycle filter)
    if [ "$JSON_OUTPUT" = true ]; then
        linear-cli issues list --mine -t "$TEAM" \
            --filter "state.type!=completed" --filter "state.type!=cancelled" \
            --output json --compact --no-pager --quiet
    else
        linear-cli issues list --mine -t "$TEAM" \
            --filter "state.type!=completed" --filter "state.type!=cancelled" \
            --group-by state --no-pager --quiet
    fi
else
    # Show my issues in the current cycle only
    # 1. Get current cycle issue identifiers
    # 2. Get my issues
    # 3. Intersect
    python3 - "$TEAM" "$JSON_OUTPUT" << 'PYEOF'
import subprocess, json, sys

team = sys.argv[1]
json_output = sys.argv[2] == "true"
common = ["--output", "json", "--compact", "--no-pager", "--quiet"]

# Get current cycle issues
try:
    r = subprocess.run(
        ["linear-cli", "cycles", "current", "-t", team] + common,
        capture_output=True, text=True, timeout=30
    )
    cycle_data = json.loads(r.stdout)
    cycle = cycle_data.get("activeCycle", {})
    cycle_issues = cycle.get("issues", {}).get("nodes", [])
    cycle_ids = {i["identifier"] for i in cycle_issues}
    cycle_name = cycle.get("name", "Current cycle")
    cycle_ends = cycle.get("endsAt", "")
except Exception as e:
    print(f"Error getting cycle: {e}", file=sys.stderr)
    sys.exit(1)

if not cycle_ids:
    print("No active cycle found." if not json_output else "[]")
    sys.exit(0)

# Get my issues
try:
    r = subprocess.run(
        ["linear-cli", "issues", "list", "--mine", "-t", team,
         "--filter", "state.type!=completed", "--filter", "state.type!=cancelled"] + common,
        capture_output=True, text=True, timeout=30
    )
    my_issues = json.loads(r.stdout) if r.stdout.strip() else []
except Exception as e:
    print(f"Error getting my issues: {e}", file=sys.stderr)
    sys.exit(1)

# Intersect: my issues that are in the current cycle
my_cycle_issues = [i for i in my_issues if i.get("identifier") in cycle_ids]

if json_output:
    print(json.dumps(my_cycle_issues, indent=2))
else:
    if not my_cycle_issues:
        print(f"No issues assigned to you in the current cycle ({team}).")
        # Show cycle summary anyway
        total = len(cycle_issues)
        done = sum(1 for i in cycle_issues if i.get("state", {}).get("type") == "completed")
        print(f"Cycle has {total} total issues ({done} completed).")
    else:
        # Group by state
        by_state = {}
        for i in my_cycle_issues:
            state = i.get("state", {}).get("name", "Unknown")
            by_state.setdefault(state, []).append(i)

        print(f"My issues in current cycle ({team}) — {len(my_cycle_issues)} total:")
        print()
        for state, issues in by_state.items():
            print(f"  {state} ({len(issues)}):")
            for i in issues:
                priority = i.get("priority", 0)
                p_marker = {1: "🔴", 2: "🟠", 3: "🟡", 4: "🔵"}.get(priority, "  ")
                print(f"    {p_marker} {i['identifier']}: {i['title']}")
            print()
PYEOF
fi
