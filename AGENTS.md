# AGENTS.md

## Purpose

Guide coding agents working on Roavia.

## Project Snapshot

- Shapes: `full-stack-product + web-ui + ai-system + data-pipeline + automation-integration`
- Stack: pnpm/Turborepo, Next.js PWA, Hono, PostgreSQL/Drizzle, provider-neutral AI and travel-data adapters
- Linear Project: `Roavia` — https://linear.app/wwonderland/project/roavia-abc76648eb5b

## Sources of Truth

- Product and architecture: `PRD.md`
- Setup and commands: `README.md`
- UI/UX constraints: `SKILL.md`
- Task state, dependencies, priority, assignment, and progress: Linear

## Mandatory Linear Lifecycle

1. Fetch the assigned issue, its blockers, and the `wonderland` team statuses.
2. Confirm blockers are resolved.
3. Move the issue to `In Progress` and verify the mutation before editing code.
4. Implement only the issue scope.
5. Run the required verification.
6. Post a Linear completion comment with changes, commands/results, risks, next issue, and suggested commit.
7. Move no-review work to `Done`; move PR-based work to `In Review` and let Git automation mark it `Done` after merge.
8. If the status mutation fails, stop. If verification fails, remain `In Progress` and comment with evidence.

## Project Rules

- Do not create local task files or duplicate Linear state.
- AI output must be schema-validated, grounded, and source-aware.
- Do not expose provider or AI credentials to clients.
- Treat travel dates and precise locations as sensitive personal data.
- Do not silently mutate itineraries from live recommendations.
- Preserve the custom Roavia UI system and package boundaries defined in `SKILL.md`.
- Verify dependencies before import or include installation in scope.

## Verification

Run the narrowest relevant tests first, followed by affected typecheck, lint, integration, and build checks. Record exact evidence in Linear.

## When Blocked or Unsure

Add or verify the Linear blocker relation, comment with the exact missing decision or dependency, move the issue to the appropriate blocked/backlog state, and stop rather than inventing scope.

## Codex Cloud Execution

- GitHub repository: `https://github.com/DJPajares/roavia`
- Codex Cloud environment: `roavia`
- Linear project: `https://linear.app/wwonderland/project/roavia-abc76648eb5b`
- First ready issue: `WDL-19` — Scaffold the Roavia monorepo

### Cloud-first start

1. Start from a ready, unblocked executable Linear issue rather than a parent workstream.
2. Delegate the issue to Codex Cloud from Linear or ChatGPT using the repository and environment above.
3. Confirm Codex moves the issue to `In Progress` before editing code.
4. Use a branch and pull request containing the Linear issue identifier.
5. Move completed PR-based work to `In Review`; let the merged-PR automation move it to `Done`.
6. Keep all task state and progress in Linear. Do not create local Markdown task mirrors.

### Codex Cloud task prompt

```text
Implement the referenced Linear issue in the `roavia` Codex Cloud environment for `DJPajares/roavia`.

Before editing code:
- fetch the issue, parent, blockers, acceptance criteria, and comments
- confirm all blockers are complete
- move the issue to In Progress and verify the mutation
- read AGENTS.md, PRD.md, README.md, and SKILL.md

Then implement only the issue scope, run its verification, post a Linear completion comment, create a PR containing the issue ID, and move the issue to In Review. Leave Done to merged-PR automation.

Stop when blocked, when Linear cannot be updated, when required context is missing, or when verification fails.
```

## Mobile Coordination

ChatGPT mobile is the coordination surface for reviewing Linear, delegating issues, monitoring Codex progress, and checking linked pull requests. Codex implementation runs in Codex Cloud.

Recommended mobile requests:

```text
Review the Roavia Linear project and show the highest-priority ready, unblocked executable issues. Do not change anything.
```

```text
Delegate WDL-19 to Codex Cloud using repository DJPajares/roavia and environment roavia. Confirm blockers first, then ask for approval before the external action.
```

```text
Review WDL-19 using Linear and GitHub. Summarize current status, Codex progress, verification, linked PR, CI, blockers, and my next action. Do not merge or change status.
```
