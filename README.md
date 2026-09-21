# Prexu

A Plex desktop client built with React 19, TypeScript, and Tauri v2 (Rust).
It includes native libmpv playback, library browsing, downloads, and a separate
Rust/Axum relay for Watch Together and TMDb requests.

## Current platform support

This table describes the current source tree, audited 2026-09-20. The package
version is 0.7.1; substantial changes since that release are still unreleased.

| Platform | Player | Status |
| --- | --- | --- |
| Windows | Native libmpv via ANGLE/DirectComposition; HTML5 fallback | Implemented, including mini-player and popout; IME and some transition verification remain open |
| Linux | Native libmpv via GtkGLArea/WebKitGTK; HTML5 fallback | Implemented and exercised on Wayland; hardware coverage and native-player release packaging remain incomplete |
| macOS | HTML5 video + hls.js | Native opt-in architecture accepted and spiked, but not integrated; platform-aware HTML5 codec gate remains open |

Linux requires system libmpv for development. Its absence can prevent launch;
the in-app fallback only helps after the process starts. Wayland popout placement
and pinning depend on the compositor. See [implementation status](docs/native-player-status.md)
for acceptance gaps and [Linux setup](docs/linux-dev.md) for prerequisites.

## Development

Use Node 22 (`mise.toml`) and Rust via rustup. Install platform prerequisites
before launching Tauri; Windows also needs the [native binaries](src-tauri/bin/README.md).

```bash
npm ci
npm run dev                 # Browser frontend, HTML5 player
npm run tauri dev           # Desktop application
npm run build               # Type check and frontend production bundle
npm run test:run             # Vitest
npm run lint                # oxlint
npx tsc --noEmit
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=player-chrome
mise run ci                 # Local frontend/Rust/E2E/probe gate; see coverage doc
```

[Validation coverage](docs/test-automation-plan.md) distinguishes automated
checks from [real hardware verification](docs/linux-on-hardware-test-plan.md).
Native graphics cannot be validated by browser tests alone.

## Documentation and work tracking

- [Documentation index](docs/README.md)
- [Current native-player status and pickup guidance](docs/native-player-status.md)
- [Relay configuration](docs/remote-access-setup.md)
- [Release notes](CHANGELOG.md)

Beads is the task source of truth: run `bd prime`, `bd ready`, and
`bd show <id>`. On a fresh clone, `bd bootstrap` initializes the local tracker.
The documentation refresh is complete and the `prexu-9f4s` review-remediation
epic is underway. Relay security fixes (`prexu-9f4s.4`) are implemented locally;
see [relay deployment notes](docs/remote-access-setup.md) for the new
`--public-url` requirement. Work is paused at the user's request. Next pickup
is relay lifecycle `prexu-9f4s.5`, then client lifecycle `prexu-9f4s.3`; see the
[current handoff](docs/native-player-status.md#picking-up-work). Deployment
remains pending; use Git history and remote status to verify source delivery.

## Project structure

- `src/` — React components, hooks, pages, services, and colocated unit tests
- `src-tauri/` — desktop shell and Windows/Linux native player backends
- `src-tauri/vendor/` — patched native dependencies, including Wry
- `relay-server/` — Watch Together WebSocket relay and TMDb proxy
- `e2e/` — Playwright browser and player-chrome tests
- `scripts/hw-probe/` — real-hardware probes and pure verdict self-tests
- `docs/` — maintained guides, architecture decisions, and archived rollout history
- `spike/` — standalone experiments and dated evidence, not production setup guides
