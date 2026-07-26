# Roavia Codex Cloud Setup

## Current state

- Linear project exists: https://linear.app/wwonderland/project/roavia-abc76648eb5b
- Existing executable roadmap: WDL-19 through WDL-55, plus parent workstreams
- First ready issue: WDL-19
- GitHub repository: `DJPajares/roavia`
- Recommended Codex Cloud environment name: `roavia`

## Configure Codex Cloud

1. Open Codex settings.
2. Connect GitHub and authorize `DJPajares/roavia`.
3. Enable Codex Cloud Tasks.
4. Create environment `roavia` for the repository's default branch.
5. For the current planning-only repository, no install command is required.
6. After WDL-19 creates the workspace, use `pnpm install --frozen-lockfile` as the setup command.

## Install Codex in Linear

1. From Codex settings, install the Codex agent in the `wonderland` Linear workspace.
2. Ensure the agent has access to team `wonderland` and project `Roavia`.
3. In Linear, connect GitHub repository `DJPajares/roavia`.
4. Configure status automation:
   - work or branch starts -> In Progress
   - PR ready -> In Review
   - PR merged -> Done

## Verify the cloud environment

Run a read-only Codex task:

```text
Read AGENTS.md, PRD.md, README.md, and SKILL.md.
Do not modify files.

Report:
1. detected architecture
2. expected setup commands
3. missing environment variables
4. whether the repository is ready for WDL-19
```

## Start WDL-19

Post on WDL-19:

```text
@Codex implement this issue using the `roavia` Codex Cloud environment for `DJPajares/roavia`.

Follow AGENTS.md. Confirm there are no blockers, move WDL-19 to In Progress and verify the mutation before editing. Implement only this issue, run its verification, post the results here, create a PR containing WDL-19, and move the issue to In Review. Leave Done to merge automation.
```

## ChatGPT mobile prompts

### Choose the next issue

```text
Use the connected Roavia Linear project. Show issues in progress, blocked issues, and the three highest-priority ready executable issues. Recommend one. Do not change anything.
```

### Delegate

```text
Delegate WDL-19 to Codex Cloud for DJPajares/roavia using environment roavia. Confirm it is executable and unblocked. Ask for approval before the Linear write action.
```

### Monitor

```text
Review WDL-19 using Linear and GitHub. Summarize status, latest Codex update, changed areas, verification, linked PR, CI, blockers, and my next action. Do not merge or change status.
```
