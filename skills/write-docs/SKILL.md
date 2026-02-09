---
name: write-docs
description: >
  Write a note, document this, save research, create a project spec,
  draft a plan, add to the vault, update the docs, archive a note
version: 1.0.0
---

# write-docs

Write, update, and manage notes in the personal Obsidian vault.

## Vault Path

The vault path is configured via the `DOCS_VAULT_PATH` environment variable. Always use absolute paths so the skill works regardless of the current working directory.

- **Vault root:** `$DOCS_VAULT_PATH` (defaults to `/home/tvd/dev/tvdavies/docs`)
- **Git remote:** `git@github.com:tvdavies/docs.git` (branch: `main`)

Before any operation, resolve the vault path:

```bash
DOCS_VAULT_PATH="${DOCS_VAULT_PATH:-/home/tvd/dev/tvdavies/docs}"
```

## Directory Routing

Route content to the correct top-level directory based on its type:

| Content type | Directory | Description |
|---|---|---|
| Research | `$DOCS_VAULT_PATH/Research/` | Notes, articles, findings, technology deep-dives, reading summaries |
| Projects | `$DOCS_VAULT_PATH/Projects/` | Project ideas, specs, technical designs, implementation docs |
| Plans | `$DOCS_VAULT_PATH/Plans/` | Roadmaps, goals, OKRs, strategic planning, decision records |
| Archive | `$DOCS_VAULT_PATH/Archive/` | Completed or inactive items moved from other directories |
| Templates | `$DOCS_VAULT_PATH/Templates/` | Reusable note templates (managed separately, not for direct content) |

If the content doesn't clearly fit one category, default to **Research**.

## Note Creation Workflow

Follow these steps every time you create a new note:

1. **Determine the target directory** using the routing table above.
2. **Choose a filename** in kebab-case (e.g. `kubernetes-pod-networking.md`). Be descriptive. Do not include dates in the filename — dates belong in frontmatter.
3. **Check for existing notes** using `Glob` to search the target directory. If a note on the same topic already exists, update it instead of creating a duplicate.
4. **Read the appropriate template** from `assets/templates/` in this skill directory. Fill in placeholders (`{{PLACEHOLDER}}`), remove any unused optional sections, and add content.
5. **Write the file** to the target directory using the `Write` tool with the absolute path.
6. **Commit and push** following the git integration workflow below.

## Required Note Structure

Every note must have this structure:

```markdown
---
title: Note Title
date: YYYY-MM-DD
tags:
  - tag-one
  - tag-two
status: draft
type: research | project | plan
---

# Note Title

Body content here.

## Related Notes

- [[other-note-name]]
```

### Frontmatter Rules

- `title` — Human-readable title, title-cased.
- `date` — Creation date in ISO format (`YYYY-MM-DD`). Use today's date for new notes.
- `tags` — Lowercase, hyphenated. Use hierarchical tags with `/` for categorisation (e.g. `lang/typescript`, `tool/docker`, `topic/networking`).
- `status` — One of: `draft`, `active`, `complete`, `archived`. New notes start as `draft`.
- `type` — One of: `research`, `project`, `plan`. Must match the target directory.
- Additional type-specific properties are defined in `references/frontmatter-schemas.md`.

### Body Rules

- Start with a level-1 heading (`# Title`) matching the frontmatter `title`.
- Use level-2 headings (`##`) for major sections and level-3 (`###`) for subsections.
- End every note with a `## Related Notes` section containing wiki-links to related notes in the vault.

## Formatting Conventions

### Links

- **Internal references:** Use wiki-links — `[[note-name]]` or `[[note-name|display text]]`. Link to heading with `[[note-name#Heading]]`.
- **External URLs:** Use standard markdown links — `[text](https://example.com)`.

### Callouts

Use Obsidian callout syntax for emphasis:

```markdown
> [!note] Optional title
> Callout body text.
```

Available types: `note`, `tip`, `warning`, `important`, `example`.

### Code

Use fenced code blocks with language identifiers:

````markdown
```typescript
const x = 1;
```
````

### Tables

Use standard markdown tables with header separators:

```markdown
| Column A | Column B |
|---|---|
| value | value |
```

### Task Lists

```markdown
- [ ] Incomplete task
- [x] Completed task
```

### Comments

Use Obsidian comment syntax for notes that shouldn't render: `%% hidden comment %%`.

For full syntax reference, see `references/obsidian-syntax.md`.

## Templates

Templates live in `assets/templates/` within this skill directory. Available templates:

| Template | Use for | File |
|---|---|---|
| Research Note | Articles, findings, deep-dives | `assets/templates/research-note.md` |
| Project Spec | Project ideas, designs, specs | `assets/templates/project-spec.md` |
| Plan | Roadmaps, goals, OKRs | `assets/templates/plan.md` |

### Using Templates

1. **Read** the template file from this skill directory using the `Read` tool.
2. **Replace** all `{{PLACEHOLDER}}` values with actual content.
3. **Remove** any optional sections that are not relevant (marked with `<!-- optional -->`).
4. **Add** content to the body sections.
5. Do not copy templates verbatim — they are starting points. Adapt structure to fit the content.

## Git Integration

The vault is a git repository. Follow this workflow for every write operation:

### Before Writing

```bash
git -C $DOCS_VAULT_PATH pull --rebase
```

Always pull with rebase before making changes to avoid unnecessary merge commits.

### After Writing

```bash
git -C $DOCS_VAULT_PATH add <absolute-path-to-file>
git -C $DOCS_VAULT_PATH commit -m "docs: <action> <note-name>"
git -C $DOCS_VAULT_PATH push
```

**Commit message format:** `docs: <action> <note-name>`

Actions:
- `add` — New note created
- `update` — Existing note modified
- `archive` — Note moved to Archive/

Examples:
- `docs: add kubernetes-pod-networking`
- `docs: update home-server-project`
- `docs: archive old-reading-list`

### Stage Only Specific Files

Always stage the specific file(s) you changed. Never use `git add -A` or `git add .` — only stage the files the skill created or modified.

### Conflict Resolution

If `git pull --rebase` encounters conflicts:

1. For **content conflicts** (body text): accept both changes (`<<<<<<< HEAD` and incoming).
2. For **frontmatter conflicts**: prefer the incoming (remote) version to preserve external edits.
3. After resolving, continue the rebase with `git -C $DOCS_VAULT_PATH rebase --continue`.

## Updating Existing Notes

When the user asks to update or edit an existing note:

1. **Search** for the note using `Glob` (by filename) or `Grep` (by content/title) within the vault.
2. **Read** the current contents with the `Read` tool.
3. **Edit** the note using the `Edit` tool — make targeted changes rather than rewriting the whole file.
4. **Update frontmatter** if needed:
   - Update `date` only if the content changed substantially. Minor edits keep the original date.
   - Update `status` if the note's lifecycle stage has changed.
5. **Commit** with `docs: update <note-name>`.

## Archiving

When the user asks to archive a note:

1. **Read** the note from its current location.
2. **Move** it to `$DOCS_VAULT_PATH/Archive/` by writing it to the new path and deleting the old file.
3. **Update frontmatter:**
   - Set `status: archived`
   - Add `archived_date: YYYY-MM-DD` with today's date
   - Add `original_path` with the directory it came from (e.g. `Research/`)
4. **Stage both** the deletion and the new file:
   ```bash
   git -C $DOCS_VAULT_PATH add <old-path> <new-path>
   ```
5. **Commit** with `docs: archive <note-name>`.

## References

Consult these reference files for detailed guidance:

- **Vault structure and file organisation:** `references/vault-structure.md`
- **Frontmatter schemas per note type:** `references/frontmatter-schemas.md`
- **Obsidian markdown syntax:** `references/obsidian-syntax.md`
