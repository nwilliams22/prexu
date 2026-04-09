# CLAUDE.md

Project-specific instructions for Claude Code.

## Commit Rules

- **Never** include `Co-Authored-By` lines referencing Claude, Anthropic, or any AI in commit messages.
- **Never** include any attribution, credit, or reference to Claude Code, Claude, or Anthropic in commits, code comments, or generated files.
- Commit messages should be concise and focus on the "why" of the change.

## Release Process

- When creating a release, **always bump the version** in all three files before tagging:
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- The CI workflow (`.github/workflows/release.yml`) triggers on `v*` tag pushes and uses `tauri-action` which reads the version from `tauri.conf.json` to name the release. If the version doesn't match the tag, artifacts will attach to the wrong release.
- Always create a **draft** GitHub release so the user can review and publish.

---

# MANDATORY RESPONSE PROTOCOL

Every response that involves code, infrastructure, implementation, or investigation MUST begin with:

## 1. Skill Analysis (explicit text before any tool use)

```
Skills needed for this work:
- skill-name: one-line reason why needed
- skill-name: one-line reason why needed
```

## 2. Skill Activation (tool calls - execute immediately after declaration)

Call Skill() tool for EACH skill listed above. No discussion, just call them.

## 3. Workflow Validation (for implementation work)

**For non-trivial work:** Run `bd ready` and show output
**For small fixes/hotfixes:** State "✓ Hotfix exception - [brief reason]"

## 4. Confirmation (explicit statement)

```
✓ Skills loaded: [comma-separated list]
✓ Workflow validated: [status or exception]
✓ Ready to proceed
```

**If you skip these steps, your response is incomplete and non-compliant.**

---

## Response Pattern Examples

❌ **WRONG:**
```
User: "Fix the alert padding"
Assistant: "Let me fix that. [writes code]"
```

✅ **CORRECT:**
```
User: "Fix the alert padding"
Assistant: "Skills needed for this work:
- core:git - Will commit UI changes
- react:react - Working with React components

[Loads both skills with Skill() tool]

✓ Skills loaded: core:git, react:react
✓ Hotfix exception - small UI padding fix
✓ Ready to proceed

[Then proceeds with fix]"
```

---

# Project Workflow

Before starting any work, make sure you have used `bd ready` (/core:beads).
Load our /core:bees or /core:beads skills to help depending on which you find.
All epics should be aware of claude-code teams, and have teams defined in the epic with models assigned by complexity of the task. All epics should have
tasks that are claude skills aware. The primary library of skills available is here: https://github.com/mimic-core/claude-skills/blob/main/.claude-plugin/marketplace.json
If the task needs a skill you don't have, suggest or ask the user for this new skill.

## Phase 1: Pre-flight checks
- Use `bd ready` to look for open work items
- Make sure the epic you are working has a team defined with the relevant models for each team member
- A member's model should attempt to use haiku first if possible based on the complexity of their task
- All tasks must have relevant skills for the work, e.g. elixir skill when working with elixir
- Ensure all the core skills are loaded: /core:*
- Instruct team members/tasks to always load these core skills first:
    - /core:anti-fabrication
    - /core:git
    - /core:documentation
    - /core:security
    - /core:mise
    - /core:nushell
- All tasks must use the claude task-list tool to work their items
- Check that we are working on a feature branch per epic
- Label all team members with their model

## Phase 2: Working the items
- Ask clarifying questions to the user
- Spawn team members for all tasks including simple ones, like research or running tests
- Instruct team members to use the claude task-list tool for all their work items
- Instruct team members to load their task's labels/skills on start
- Instruct team members that code without tests is not complete /core:tdd
- If a team member fails in a task twice, collect the member's summary, then spawn the agent with the summary and promote the model it is using: haiku -> sonnet -> opus

## Phase 3: Validation
- Assign a haiku agent by default to run the strictest linting and validation possible for each language
    - e.g. for this project: `npx vitest run`, `npx tsc --noEmit`, `cd relay-server && cargo check`
- Have the agent pass each test run's results to another agent to address fixes and issues
- This validation group should work in concert to address all issues found
- If the project doesn't have a `mise run ci` command, we should use the /core:mise skill to make one
- Code without tests is not complete /core:tdd

## Phase 4: Submit loop
- We never commit or PR with attribution
- We give summary PRs without a changes section as git has the diff
- We wait for CI to pass then ask the user to squash merge and delete the merged branch
- Once merged, we checkout main, pull and delete our merged feature branch
- We go back to Phase 1 to work a new epic

---

## Tech Stack

- **Frontend:** React 19 + TypeScript, Vite
- **Desktop:** Tauri v2 (Rust backend)
- **Relay Server:** Rust + Axum (WebSocket relay for Watch Together)
- **Testing:** Vitest + React Testing Library (unit), Playwright (E2E)
- **Storage:** `tauri-plugin-store` for sensitive data, `localStorage` for non-sensitive

## Project Structure

- `src/` — React frontend (components, hooks, pages, services, types)
- `src-tauri/` — Tauri desktop shell (Rust)
- `relay-server/` — Watch Together relay server (Rust/Axum)
- `e2e/` — Playwright E2E tests

## Commands

- `npm run dev` — Start Vite dev server
- `npx vitest run` — Run all unit tests
- `npx tsc --noEmit` — TypeScript type check
- `cd relay-server && cargo check` — Check relay server compiles
- `npm run tauri dev` — Run the full Tauri desktop app

## Testing

- Always run `npx vitest run` and `npx tsc --noEmit` after making changes to verify nothing is broken.
- Test files live alongside source files (`*.test.ts`, `*.test.tsx`).
- jsdom v28+ requires a localStorage polyfill (see `src/__tests__/setup.ts`).
