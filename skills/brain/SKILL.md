---
name: brain
description: >
  Save to brain, file in the brain, add to brain, record findings, save this plan,
  document this in the brain, write up these findings, put this in the knowledge base.
  Use whenever the user wants to persist a document, plan, or finding into their
  long-term knowledge vault at ~/brain.
version: 0.1.0
---

# brain

Persist documents, plans, and findings to the long-term knowledge vault at `~/brain`.

The vault is an **Obsidian knowledge base** — wiki-style markdown with YAML frontmatter and `[[wiki-links]]` between notes. Treat it as a connected graph, not a flat pile of files.

For proactive capture of what the agent learned or did during a task, use the `memory` skill instead — this skill is for deliberate writes the user has asked for.

## Before doing anything

Read `~/brain/README.md`. It is the authoritative source on directory layout, file format, frontmatter schema, tag conventions, and the git workflow. This skill defers to that file — do not re-derive structure from memory.

```
Read ~/brain/README.md
```

If the README and this skill ever disagree, the README wins.

## Workflow

1. **Read `~/brain/README.md`** to refresh the current structure and link syntax.
2. **Decide the directory** (`findings/`, `plans/`, `documents/`) using the table in the README. If the user explicitly said "memory" or this is a proactive capture, stop and use the `memory` skill instead.
3. **Choose a filename** in kebab-case — descriptive, no date. This becomes the wiki-link target, so pick something other notes would plausibly type: `[[fastapi-middleware-order]]`.
4. **Search for related notes** across the whole vault with `Glob ~/brain/**/*<keyword>*.md` and a `Grep` of the topic. Two goals:
   - If a note on the same topic exists, update it rather than creating a duplicate.
   - If related but distinct notes exist, collect their filenames — you'll link to them with `[[...]]` in the body and in a `## Related` section.
5. **Pull** before writing: `git -C ~/brain pull --rebase`.
6. **Write** the file with the frontmatter schema from the README, matched to the chosen `type`. Use `[[wiki-links]]` to reference other brain notes — never plain paths. End non-trivial notes with a `## Related` section.
7. **Commit and push** using the commit format from the README (`<type>: <action> <slug>`). Stage only the files you touched.

## When the user asks to update or archive

- **Update:** find the file with `Glob`/`Grep`, `Read` it, use `Edit` for targeted changes, bump `date` only if the change is substantive.
- **Archive** (a plan that's `done` or `abandoned`, a `draft` finding that's been superseded): change the frontmatter `status` field instead of moving the file. The vault is small enough that there's no separate Archive directory yet.

## Scope limits

- Don't create new top-level directories. Propose changes to the README first and let the user approve.
- Don't mix multiple topics in one file. Split into separate files and cross-link.
- Don't write to `memories/` from this skill — that path belongs to the `memory` skill.
