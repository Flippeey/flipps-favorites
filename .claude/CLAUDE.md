# Project: Flipp's Favorites

# Memory Bank: flipps-favorites

The tracked root [`CLAUDE.md`](../CLAUDE.md) is the source of truth for project summary,
critical rules, tech stack, layout, commands, and workflow. Read it first — it is not
duplicated here, to avoid drift between the two files.

This file, plus `structure.md`, `architecture.md`, `conventions.md`, `testing.md`, and `settings.json`, are tracked in git.
Local-only files (`settings.local.json`, `memory.db`, `skills/`, and runtime data) stay gitignored.

## Detailed References

Load when relevant to current work:

- @structure.md — full file tree, module responsibilities, key file index
- @architecture.md — message pipeline, state ownership, interaction/state hooks, theming, selection scope, icon pipeline
- @conventions.md — naming for files / identifiers / CSS / data attributes, TS style
- @testing.md — Playwright + Vitest layers, fixtures, global setup, spec organization
