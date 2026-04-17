---
name: memory
description: >
  Capture and recall durable memories in ~/brain/memories. MUST be invoked
  proactively (without being asked) whenever any of these happen in a
  conversation: (1) the user reveals a role, preference, responsibility, or
  workflow detail about themselves; (2) the user corrects your approach OR
  validates a non-obvious choice you made ("yes, exactly", "keep doing that");
  (3) you learn a non-obvious fact about a codebase, system, tool, or external
  resource; (4) you finish non-trivial work that produced a decision with
  rationale, a solved problem, or an outcome worth referring back to; (5) the
  user mentions an ongoing project, initiative, incident, deadline, or
  stakeholder context not derivable from code. Also invoke to retrieve past
  memories when the user says "do you remember", "earlier", "last time",
  "we did", "did we", or references prior conversations, or when current work
  overlaps a topic likely covered before. A SessionStart hook injects
  ~/brain/memories/INDEX.md into context — consult that injected index first
  to decide which full memory files to read.
version: 0.2.0
---

# memory

Persist and recall durable memories in `~/brain/memories/`.

`~/brain` is an **Obsidian knowledge vault** — wiki-style markdown with frontmatter and `[[wiki-links]]`. This skill handles the `memories/` subtree specifically: short, cheap-to-write notes that accumulate into a useful memory system over time. Memories should link out to `[[related-finding]]` or `[[related-plan]]` notes whenever possible — a well-connected memory is worth far more than an isolated one. For deliberate documents, plans, or research writeups use the `brain` skill instead.

## Read the brain README first

`~/brain/README.md` is authoritative on file format, frontmatter, tag conventions, and the git workflow. Read it before writing or searching so you use current conventions.

```
Read ~/brain/README.md
```

## When to save a memory (proactive)

Save without being asked when any of the following happens during a task. These mirror the categories the old auto-memory system tracked — all of them now live here as memory files with appropriate tags:

- **User detail** (tag `kind/user`) — role, responsibilities, expertise, tools they use, how they prefer to collaborate. e.g. "works at lleverage.ai on X", "deep Go background, new to frontend".
- **Feedback** (tag `kind/feedback`) — a correction ("don't do X") OR a validation ("yes, that was the right call"). Record *both* the rule and the `Why:` / `How to apply:` context so a future session can judge edge cases. Watch for quiet confirmations, not just loud corrections.
- **Project context** (tag `kind/project`) — who's doing what, why, by when. Deadlines, incidents, stakeholder asks, motivation behind work that isn't obvious from code. Convert relative dates to absolute ISO dates.
- **Reference** (tag `kind/reference`) — pointers to external systems: Linear project keys, Grafana dashboards, Slack channels, runbook URLs, where a team tracks X.
- **Non-obvious fact** about a codebase, system, or tool — e.g. "repo X's migrations run in Y order", "service Z requires header W".
- **Solved problem** where the cause or fix wasn't immediately obvious. Capture the symptom, the cause, and the fix.
- **Decision with rationale** that might be revisited — "chose X over Y because Z".

Skip the memory if:

- It's fully derivable from the code or git history.
- It's already covered by an existing memory — update that one instead.
- It's ephemeral in-conversation state (current TODOs, scratch work).
- It's sensitive (credentials, tokens, private personal data).

Bias toward saving. A slightly redundant memory is cheaper than a missing one. We are explicitly trying to accumulate data.

## When to search memory

The SessionStart hook injects `~/brain/memories/INDEX.md` into context at the start of every conversation — so a lightweight scan of that index has already happened by the time you're reading this. Use it as your first stop.

Search before answering when:

- The user says "remember", "earlier", "last time", "we did", "did we", "what did I/we…".
- The task overlaps a topic likely to have been encountered before (same repo, same tool, similar bug).
- You're about to give advice that depends on how a particular system/repo works.

Check the injected INDEX first — if an entry's one-liner hook looks relevant, `Read` that full memory file. Fall back to `Glob`/`Grep` across `~/brain/memories/` only if the index doesn't surface anything useful (e.g. the memory predates the index or uses unexpected keywords).

## Saving a memory

Delegate the mechanical parts (frontmatter, vault-link hunting, INDEX update, git) to the `save-memory` helper script. It shells out to a cheap/fast model internally, so this keeps the main agent's context clean and is much quicker than doing it step-by-step here.

### The fast path (default)

1. **Compose a rough note** — a paragraph or two that captures:
   - The takeaway (what a future session should know).
   - The "why" / surrounding context, so a future reader can judge whether it still applies.
   - Any specific entities, slugs, or related notes you already know about — mention them by name in the note. The helper will pick them up as links/entities.
   - If the note is really about updating an existing memory, say so explicitly ("update the [[existing-slug]] memory to add…") so the helper chooses the update path.
2. **Invoke the script** via Bash:
   ```
   ~/.claude/skills/memory/bin/save-memory [--entity NAME]... [--tag NAME]... "<rough note>"
   ```
   `--entity` / `--tag` are optional hints for required entries in frontmatter — only pass them if you know something the note doesn't make obvious. The note itself can be passed as the final argument or piped on stdin.
3. **Run it in the background** (`run_in_background: true` on the Bash call) whenever the user isn't waiting on the confirmation — i.e. almost always for proactive saves. On success the script prints `<action> <slug>` and writes `OK <timestamp>: <action> <slug>` to `~/brain/.save-memory.last`.
4. **If you ran in background**, glance at `~/brain/.save-memory.last` at the end of your turn (or next time you're idle) to confirm the save succeeded. Full transcript of every run is in `~/brain/.save-memory.log`.

The script handles: pulling the vault, picking a slug, writing frontmatter per `~/brain/README.md`, finding genuinely related notes to wiki-link, updating `memories/INDEX.md`, and committing + pushing. It uses a file lock so concurrent invocations don't race.

### Fallback path (script unavailable or failing)

Only fall back if `save-memory` exits non-zero twice in a row or the `claude` CLI isn't on PATH. In that case, do the work manually: read `~/brain/README.md`, `Glob`/`Grep` for an existing memory on the topic, write `memories/<slug>.md` with the frontmatter schema from the README, add a line to `memories/INDEX.md` (remove `_No memories yet._` if present), then `git -C ~/brain add <files> && git commit -m "memory: add <slug>" && git push`.

Keep memories short. If a note wants to grow past a page, it's probably a finding — use the `brain` skill and save it to `findings/` instead, and optionally leave a short memory pointing to it.

## Searching memory (v1)

No CLI yet — search the filesystem directly:

- **Skim filenames first:** `Glob ~/brain/memories/*.md` or filter with a keyword pattern. Filenames are chosen to be searchable.
- **Content search:** `Grep` (ripgrep) across `~/brain/memories/` for keywords, repo names, tool names, error messages.
- **Tag search:** `Grep` for `topic/<area>` or `repo/<name>` in the frontmatter.
- **Entities:** `Grep` for a specific file path, person, or project name — memories include these in the `entities` field deliberately to aid retrieval.
- **Broaden, don't narrow:** try two or three different searches before concluding nothing relevant exists. Synonyms matter.

Once a relevant memory is found, `Read` it in full before using it. Memories are snapshots — verify anything load-bearing against the current code before acting on it.

## Updating memories

If a memory turns out to be wrong, outdated, or superseded:

- **Update** it in place with `Edit`. Bump `date` to today.
- If the underlying truth has changed, say so explicitly in the body (e.g. "As of YYYY-MM-DD this changed — …") rather than silently overwriting.
- **Update the entry in `INDEX.md`** if the one-line hook is now misleading.
- Commit both files with `memory: update <slug>`.

If a memory is simply obsolete and should not be recalled:

- Delete the memory file.
- **Remove the entry from `INDEX.md`** so future sessions don't try to read a missing file.
- Commit both changes with `memory: archive <slug>`.

## Future

A retrieval CLI (likely `brain query "<text>"` with embeddings) is planned. When it ships, prefer it over `rg`. Until then, the habit of saving well-tagged, entity-rich memories is what makes that future CLI useful — so don't skimp on tags and entities now.
