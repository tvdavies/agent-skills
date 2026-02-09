# Vault Structure

Detailed guide to the directory layout, naming conventions, and file organisation patterns in the docs vault.

## Vault Root

```
/home/tvd/dev/tvdavies/docs/
├── Research/
├── Projects/
├── Plans/
├── Templates/
├── Archive/
└── README.md
```

## Directory Descriptions

### Research/

Notes, articles, and findings on topics of interest. This is the default directory when content doesn't clearly fit elsewhere.

**What belongs here:**
- Technology deep-dives (e.g. `kubernetes-pod-networking.md`)
- Reading summaries and article notes (e.g. `distributed-consensus-algorithms.md`)
- Language and framework explorations (e.g. `rust-ownership-model.md`)
- Tool evaluations and comparisons (e.g. `nix-vs-guix-package-managers.md`)
- Concept explanations (e.g. `event-sourcing-patterns.md`)
- Learning notes from courses or books (e.g. `designing-data-intensive-applications.md`)

### Projects/

Project ideas, specifications, and technical documentation for things being built or considered.

**What belongs here:**
- Project specifications (e.g. `home-media-server.md`)
- Technical design documents (e.g. `cli-tool-architecture.md`)
- Implementation notes for active projects (e.g. `dotfiles-migration.md`)
- Project retrospectives (e.g. `blog-platform-retrospective.md`)

### Plans/

Roadmaps, goals, OKRs, and strategic planning documents.

**What belongs here:**
- Personal or professional goals (e.g. `q1-learning-goals.md`)
- Strategic plans (e.g. `homelab-infrastructure-plan.md`)
- Decision records (e.g. `choosing-a-note-taking-system.md`)
- Weekly/monthly/quarterly reviews (e.g. `monthly-review-process.md`)

### Archive/

Completed or inactive items moved from other directories. Notes are never created directly in Archive — they are moved here from their original directory.

**What belongs here:**
- Completed projects that no longer need active attention
- Outdated research superseded by newer findings
- Plans that have been executed or abandoned
- Any note the user explicitly asks to archive

### Templates/

Reusable note templates maintained in the vault itself. These are Obsidian-native templates for use within the Obsidian app. The skill's own templates (in `assets/templates/`) are separate and used for programmatic note creation.

## Filename Conventions

### Rules

1. **Always kebab-case** — lowercase words separated by hyphens.
   - Good: `kubernetes-pod-networking.md`
   - Bad: `Kubernetes_Pod_Networking.md`, `kubernetespodnetworking.md`

2. **Descriptive names** — the filename should convey the topic at a glance.
   - Good: `distributed-consensus-algorithms.md`
   - Bad: `notes.md`, `research-1.md`, `stuff.md`

3. **No dates in filenames** — dates are stored in frontmatter. The filesystem sorts by modification time; Obsidian sorts by metadata.
   - Good: `quarterly-review.md` (with `date: 2026-01-15` in frontmatter)
   - Bad: `2026-01-15-quarterly-review.md`

4. **No special characters** — only lowercase letters, numbers, and hyphens.
   - Good: `react-server-components.md`
   - Bad: `react_(server)_components.md`

5. **Extension** — always `.md`.

### Naming Patterns by Type

| Type | Pattern | Example |
|---|---|---|
| Research | `<topic>.md` | `webauthn-authentication-flow.md` |
| Project | `<project-name>.md` | `home-media-server.md` |
| Plan | `<plan-topic>.md` | `infrastructure-migration-plan.md` |

## Subdirectory Patterns

Top-level directories can contain subdirectories for organisation when the number of notes in a category grows large.

### When to Create Subdirectories

- When a top-level directory has **more than 15-20 notes** on distinct subtopics.
- When there is a **natural grouping** (e.g. `Research/languages/`, `Projects/homelab/`).
- When the user explicitly requests a subdirectory.

### Subdirectory Naming

Follow the same kebab-case convention as filenames:

```
Research/
├── networking/
│   ├── kubernetes-pod-networking.md
│   └── wireguard-vpn-setup.md
├── languages/
│   ├── rust-ownership-model.md
│   └── zig-comptime-features.md
└── distributed-consensus-algorithms.md
```

### When Not to Create Subdirectories

- Do not create a subdirectory for a single note.
- Do not nest more than one level deep (e.g. `Research/networking/` is fine, `Research/networking/kubernetes/` is not).
- When in doubt, keep notes in the top-level directory.

## File Discovery Patterns

### Finding Notes by Name

Use `Glob` to search for files by name pattern:

```
Glob pattern: **/*.md
Path: /home/tvd/dev/tvdavies/docs/Research/
```

Or search for a specific filename across the entire vault:

```
Glob pattern: **/kubernetes*.md
Path: /home/tvd/dev/tvdavies/docs/
```

### Finding Notes by Content

Use `Grep` to search for content within notes:

```
Grep pattern: "kubernetes"
Path: /home/tvd/dev/tvdavies/docs/
Glob: *.md
```

### Finding Notes by Tag

Search frontmatter tags:

```
Grep pattern: "^  - networking"
Path: /home/tvd/dev/tvdavies/docs/
Glob: *.md
```

### Finding Notes by Status

```
Grep pattern: "^status: active"
Path: /home/tvd/dev/tvdavies/docs/
Glob: *.md
```

### Checking for Duplicates Before Creating

Always search before creating a new note:

```
Glob pattern: **/*<key-term>*.md
Path: /home/tvd/dev/tvdavies/docs/
```

If a match is found, read it and decide whether to update the existing note or create a new one with a more specific name.
