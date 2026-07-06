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
- We wait for CI to pass, then squash merge the PR and delete the remote branch ourselves (no need to ask)
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

## Logging Conventions

All code must include logging. Code without logging is not complete.

### Rust
- Use `log` crate macros: `log::trace!`, `log::debug!`, `log::info!`, `log::warn!`, `log::error!`
- Always prefix with a bracketed tag: `log::info!("[player] message")`
- Tag format: `[module]` or `[module:submodule]` — e.g. `[player]`, `[player:cmd]`, `[player:events]`, `[player:host]`, `[downloads]`, `[Proxy]`
- Every `#[tauri::command]` must log entry with key parameters at `info` (state-changing) or `debug` (queries)
- All Win32 API calls (SetWindowPos, CreateWindowExW, PostMessage, etc.) must log at `debug` with HWND and dimensions
- Errors must include the error value: `log::error!("[tag] operation failed: {:?}", e)`
- Dev builds (`cargo tauri dev`) output debug+trace; release builds output info+above

### TypeScript
- Use the `logger` service from `src/services/logger.ts` — **never bare `console.log`**
- API: `logger.info(tag, message, data?)`, `.warn(...)`, `.error(...)`, `.debug(...)`, `.trace(...)`
- Tags must match Rust conventions: `"player"`, `"player:keys"`, `"timeline"`, `"api"`, `"playback"`, `"ws"`
- Every `invoke()` call should log before it with the command name and key args
- Sensitive data (tokens, full URLs with tokens) must be truncated: `url.substring(0, 80)`

### Log Levels

| Level | Use for | Examples |
|-------|---------|---------|
| error | Failures needing investigation | mpv init failed, API 500, unhandled exception |
| warn  | Recoverable problems | mpv quit failed, 401 auth, sync_geometry failed |
| info  | Significant state transitions | player init/destroy, fullscreen toggle, file loaded, download complete |
| debug | Operational details | command args, geometry applied, volume changes, API calls |
| trace | High-frequency noise | time-pos ticks, throttled geometry calls, timeline heartbeats |

### Correlation
- Tauri commands are the Rust/TS boundary. Log the command name on both sides:
  - TS: `logger.info("player", "player_set_fullscreen", { fullscreen: true })`
  - Rust: `log::info!("[player:cmd] set_fullscreen true")`
- Both appear in the same log file via `tauri-plugin-log`, making cross-boundary tracing easy.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
