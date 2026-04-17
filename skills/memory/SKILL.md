---
name: memory
description: >
  Capture and recall durable memories in ~/brain/memories. Use PROACTIVELY at the
  end of non-trivial work to save what was learned, what was done, decisions made,
  user preferences revealed, and non-obvious facts about systems, repos, or
  workflows. Also use to retrieve past memories when the user asks "do you
  remember", "what did we do", references prior conversations, or when current
  work might relate to past findings.
version: 0.1.0
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

Save without being asked when any of the following happens during a task:

- **Learned a non-obvious fact** about a codebase, system, or tool — e.g. "repo X's migrations run in Y order", "service Z requires header W".
- **Solved a problem** where the cause or fix wasn't immediately obvious. Capture the symptom, the cause, and the fix.
- **Discovered a user preference** not already recorded — e.g. "prefers tests alongside source, not in a tests/ dir".
- **Completed meaningful work** worth referring back to — a migration, a refactor, an investigation outcome.
- **Made a decision with rationale** that might be revisited — "chose X over Y because Z".

Skip the memory if:

- It's fully derivable from the code or git history.
- It's already covered by an existing memory — update that one instead.
- It's ephemeral in-conversation state (current TODOs, scratch work).
- It's sensitive (credentials, tokens, private personal data).

Bias toward saving. A slightly redundant memory is cheaper than a missing one. We are explicitly trying to accumulate data.

## When to search memory

Search before answering when:

- The user says "remember", "earlier", "last time", "we did", "did we", "what did I/we…".
- The task overlaps a topic likely to have been encountered before (same repo, same tool, similar bug).
- You're about to give advice that depends on how a particular system/repo works.

## Saving a memory

1. **Read `~/brain/README.md`** if you haven't already this session — it's the source of truth for frontmatter and link syntax.
2. **Check for an existing memory** on the same topic:
   ```
   Glob ~/brain/memories/*<keyword>*.md
   Grep <topic> in ~/brain/memories/
   ```
   If one exists and is close enough, update it instead of adding a new file.
3. **Search the rest of the vault for notes to link to** — `Glob ~/brain/**/*<keyword>*.md` across `findings/`, `plans/`, `documents/`. Collect filenames to wiki-link from the body.
4. **Pick a filename** — kebab-case, descriptive, no date. Aim for a name that a future search would actually type (it's also the wiki-link target).
5. **Pull** before writing: `git -C ~/brain pull --rebase`.
6. **Write** the file using the memory frontmatter from the README:
   ```yaml
   ---
   title: Short Human-Readable Title
   date: YYYY-MM-DD
   type: memory
   source: one line on the task or conversation that produced this
   entities:
     - repo/name
     - some/file/path
     - person-name
   tags:
     - topic/area
     - repo/name
   ---

   # Short Human-Readable Title

   Body — a few sentences. Lead with the takeaway. Include the "why" or
   surrounding context, not just the fact, so a future reader can judge
   whether it still applies. Use [[wiki-links]] to connect to related
   findings, plans, or earlier memories.

   ## Related

   - [[related-finding]]
   - [[related-memory]]
   ```
7. **Commit and push** following the README's git workflow. Commit message: `memory: add <slug>` or `memory: update <slug>`.

Keep memories short. If it wants to grow past a page, it's probably a finding — use the `brain` skill and save it to `findings/` instead, and optionally leave a one-line memory pointing to it.

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
- Commit with `memory: update <slug>`.

If a memory is simply obsolete and should not be recalled:

- Delete the file.
- Commit with `memory: archive <slug>`.

## Future

A retrieval CLI (likely `brain query "<text>"` with embeddings) is planned. When it ships, prefer it over `rg`. Until then, the habit of saving well-tagged, entity-rich memories is what makes that future CLI useful — so don't skimp on tags and entities now.
