# Frontmatter Schemas

YAML frontmatter schemas for each note type in the vault. Every note must include the common properties. Type-specific properties are added based on the note's `type` field.

## Common Properties

These properties are required on every note:

```yaml
---
title: string       # Human-readable title, title-cased
date: YYYY-MM-DD    # Creation date in ISO format
tags:                # List of lowercase, hyphenated tags
  - string
status: string      # One of: draft, active, complete, archived
type: string        # One of: research, project, plan
---
```

### Property Details

#### title

The display title for the note. Use title case.

- Good: `Kubernetes Pod Networking`
- Bad: `kubernetes pod networking`, `KUBERNETES POD NETWORKING`

#### date

ISO 8601 date of creation. Use the current date (`YYYY-MM-DD`) when creating a new note. Only update this if the content changes substantially — minor edits keep the original date.

#### tags

A YAML list of lowercase, hyphenated strings. Use hierarchical tags with `/` to create categories.

**Tag categories:**
- `lang/<language>` — Programming languages (e.g. `lang/typescript`, `lang/rust`)
- `tool/<tool>` — Tools and software (e.g. `tool/docker`, `tool/nix`)
- `topic/<topic>` — Subject areas (e.g. `topic/networking`, `topic/security`)
- `platform/<platform>` — Platforms (e.g. `platform/linux`, `platform/aws`)
- `project/<name>` — Project association (e.g. `project/homelab`)
- Simple tags without hierarchy are also fine for general topics (e.g. `performance`, `architecture`)

**Rules:**
- Lowercase only
- Hyphens for multi-word tags (e.g. `machine-learning`, not `machine_learning`)
- Prefer specific over generic (e.g. `lang/typescript` over `programming`)
- Reuse existing tags where possible — search the vault for established tags before inventing new ones

#### status

The lifecycle stage of the note:

| Status | Meaning |
|---|---|
| `draft` | Initial creation, content may be incomplete |
| `active` | Being actively worked on or referenced |
| `complete` | Content is finished and stable |
| `archived` | Moved to Archive/, no longer actively maintained |

Lifecycle: `draft` -> `active` -> `complete` -> `archived`

#### type

Must be one of: `research`, `project`, `plan`. This should match the directory the note lives in.

## Research-Specific Properties

Additional properties for notes with `type: research`:

```yaml
---
title: string
date: YYYY-MM-DD
tags:
  - string
status: draft
type: research
source: string        # optional — Where the information came from
url: string           # optional — URL of the source material
author: string        # optional — Author of the source material
summary: string       # optional — One-line summary of the note
---
```

### Example

```yaml
---
title: WebAuthn Authentication Flow
date: 2026-02-09
tags:
  - topic/security
  - topic/authentication
  - web
source: MDN Web Docs
url: https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API
author: MDN Contributors
summary: How WebAuthn works for passwordless authentication in browsers
status: draft
type: research
---
```

## Project-Specific Properties

Additional properties for notes with `type: project`:

```yaml
---
title: string
date: YYYY-MM-DD
tags:
  - string
status: draft
type: project
project_status: string  # optional — Current project phase
tech_stack:             # optional — Technologies used
  - string
repo: string            # optional — Git repository URL
priority: string        # optional — One of: high, medium, low
---
```

### project_status Values

| Value | Meaning |
|---|---|
| `idea` | Initial concept, not yet started |
| `planning` | Designing and scoping |
| `in-progress` | Actively being built |
| `paused` | Temporarily on hold |
| `complete` | Finished |
| `abandoned` | No longer pursuing |

### Example

```yaml
---
title: Home Media Server
date: 2026-02-09
tags:
  - project/homelab
  - tool/docker
  - platform/linux
status: active
type: project
project_status: in-progress
tech_stack:
  - docker
  - jellyfin
  - nginx
repo: git@github.com:tvdavies/media-server.git
priority: medium
---
```

## Plan-Specific Properties

Additional properties for notes with `type: plan`:

```yaml
---
title: string
date: YYYY-MM-DD
tags:
  - string
status: draft
type: plan
timeframe: string       # optional — Time period (e.g. "Q1 2026", "2026", "February 2026")
objective: string       # optional — One-line objective statement
key_results:            # optional — Measurable outcomes
  - string
review_date: YYYY-MM-DD # optional — When to review this plan
---
```

### Example

```yaml
---
title: Q1 2026 Learning Goals
date: 2026-01-05
tags:
  - learning
  - lang/rust
  - topic/systems-programming
status: active
type: plan
timeframe: Q1 2026
objective: Build proficiency in systems programming with Rust
key_results:
  - Complete the Rust Book
  - Build a CLI tool in Rust
  - Contribute to one open-source Rust project
review_date: 2026-04-01
---
```

## Archive-Specific Properties

When a note is archived, add these properties to the existing frontmatter:

```yaml
---
# ... all original properties remain ...
status: archived
archived_date: YYYY-MM-DD  # Date the note was archived
original_path: string       # Directory it came from (e.g. "Research/")
---
```

### Example

```yaml
---
title: Old Reading List
date: 2025-06-15
tags:
  - reading
status: archived
type: research
archived_date: 2026-02-09
original_path: Research/
---
```

## Validation Rules

1. **Required fields:** `title`, `date`, `tags`, `status`, `type` must always be present.
2. **Status values:** Must be one of `draft`, `active`, `complete`, `archived`.
3. **Type values:** Must be one of `research`, `project`, `plan`.
4. **Date format:** Must be valid ISO 8601 (`YYYY-MM-DD`).
5. **Tags format:** Must be a YAML list of lowercase, hyphenated strings.
6. **Type-specific properties:** Are optional but should be included when the information is available.
7. **No extra whitespace:** Keep frontmatter clean with no trailing spaces or blank lines within the YAML block.
