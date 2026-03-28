# Flipp's Favorites — Claude Reference

The full project reference is in [.claude/CLAUDE.md](.claude/CLAUDE.md).

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary
- ALWAYS prefer editing an existing file to creating a new one
- NEVER save working files or tests to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- After every code change, run both `npm run typecheck` AND `npm run build` — never just typecheck alone

## Session Memory

At the start of any non-trivial session, run `/qmd-sessions refresh` to recall past work.

## Decisions

- [2026-03-27]: Replaced claude-flow/RuFlo V3 with ECC (Everything Claude Code) plugin — claude-flow was not working well for this project.
