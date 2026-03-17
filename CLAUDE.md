# CLAUDE.md

Project-specific instructions for Claude Code.

## Commit Rules

- **Never** include `Co-Authored-By` lines referencing Claude, Anthropic, or any AI in commit messages.
- **Never** include any attribution, credit, or reference to Claude Code, Claude, or Anthropic in commits, code comments, or generated files.
- Commit messages should be concise and focus on the "why" of the change.

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
