# AGENTS.md

## Project

- Name: Roavia
- Stack: pnpm/Turborepo, Next.js PWA, Hono, PostgreSQL/Drizzle, provider-neutral AI and travel-data adapters
- Repository: https://github.com/DJPajares/roavia
- Linear project: https://linear.app/wwonderland/project/roavia-abc76648eb5b
- Linear team: `wonderland`
- Statuses: `In Progress`, `In Review`, `Done`
- Completion mode: `pr-created` — mark Done after verified implementation and PR creation; the user reviews and merges manually

## Sources of Truth

- Task scope, blockers, priority, status, and model guidance: Linear
- Product and architecture: `PRD.md`
- Commands and setup: `README.md`
- UI/UX rules: `SKILL.md`

Do not create local task files or duplicate Linear state.

## Lean Issue Startup

1. Fetch the target Linear issue once, including its relations.
2. Trust blocker statuses included in the response. Fetch a blocker separately only when its status is missing, unclear, reopened, not Done, or its implementation details are required.
3. Do not read issue comments unless the issue is reopened, references a decision in comments, contains conflicting scope, or has a prior failed attempt.
4. Do not list all team statuses during routine startup. Use the stored status names above; resolve them only when a mutation fails or the workflow changed.
5. Move the issue to `In Progress` and verify the mutation before editing code. Stop if it fails.
6. Run only `git status --short --branch` initially. Preserve unrelated changes and inspect them only when they overlap required files.
7. Read this file once, then load only necessary context:
   - `PRD.md`: relevant headings or searched passages only
   - `README.md`: required commands or setup sections only
   - `SKILL.md`: only for UI, UX, visual, responsive, motion, or accessibility work
   - nested `AGENTS.md`: only inside directories being changed
8. Search for likely files before opening them. Prefer targeted files and ranges over whole directories or repeated document reads.

Do not narrate routine successful reads, commands, or status changes. Report only blockers, ambiguity, conflicts, authorization failures, risky decisions, and the final handoff.

## Implementation Rules

- Implement only the selected Linear issue.
- Do not silently expand scope or start the next issue.
- AI output must be schema-validated, grounded, and source-aware.
- Never expose provider or AI credentials to clients.
- Treat travel dates and precise locations as sensitive personal data.
- Do not silently mutate itineraries from live recommendations.
- Preserve the Roavia UI system and package boundaries in `SKILL.md`.
- Verify a dependency exists before importing it, or include installation in scope.

## Verification

Run the narrowest relevant checks first:

1. focused test or command for the changed behavior
2. affected package typecheck/lint/tests
3. affected app integration/build checks
4. full-repository checks only for cross-cutting changes, shared configuration, release work, or when explicitly required by the issue

Do not rerun successful expensive checks without a relevant change. Record exact commands and results in Linear.

## Completion

1. Summarize the diff without rereading every changed file.
2. Suggest a commit message: `type(WDL-<number>): imperative summary`.
3. Push a branch containing the Linear issue ID and create a GitHub PR.
4. Post one concise Linear completion comment with changes, verification, risks, commit message, and PR URL.
5. Move the issue to `Done` only after verification and successful PR creation. Verify the mutation. If verification or PR creation fails, keep it `In Progress` and comment with evidence.
6. Fetch the next ready, unblocked issue once. Copy its existing `Suggested AI` recommendations; do not re-analyze or start it.

Final handoff must include:

- what changed
- verification results
- completed Linear issue URL and status
- GitHub PR URL
- next Linear issue URL, title, and blocker state
- next issue's Codex/OpenAI model and reasoning
- next issue's Claude/Anthropic model and reasoning

If the next issue has no recommendation, choose the smallest capable current model for each provider, add the recommendation to Linear, and state the brief rationale. If none is ready, link the Linear project and list the blockers.

## Blocked or Unsure

Add or verify the blocker relation, comment with the exact missing decision or dependency, move the issue to the appropriate blocked/backlog state, and stop rather than inventing scope.

## Mobile and VS Code

Codex runs on the local development machine through the Codex app, CLI, or VS Code extension. ChatGPT mobile Remote may control the same thread. All execution modes use this workflow and the same Linear roadmap.
