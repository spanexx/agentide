# Agentide

Agent Runtime Platform — an operating system for AI agents. See `docs/architecture/Agentide.md`
for the full architecture book, or `docs/CONTEXT.md` for the condensed glossary and standing
conventions this codebase follows.

## Structure

```
packages/          — workspace packages (populated as features are implemented)
docs/
  architecture/     — the full architecture doc set
  CONTEXT.md        — glossary + conventions, kept current as features land
  Feature_Backlog.md — dependency-ordered feature sequencing list
  drift-issue-log.md — design gaps found and resolved during the architecture pass
  features/<topic>/  — per-feature PRD/EXPLAINED/TRD/FLOW/IMPL docs, created by feature-pipeline
```

## Stack

- Node.js >= 20, TypeScript, npm workspaces
- Tests: Vitest
- Lint: ESLint (flat config)

## Getting started

```
npm install
npm run build
npm test
npm run lint
```

No packages exist yet — `packages/` is populated one feature at a time via the
`feature-pipeline` process, starting with `event-bus` (see `docs/Feature_Backlog.md`, Tier 1).
