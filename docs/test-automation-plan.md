# Test automation — current coverage

Audited 2026-09-20 against `mise.toml`, `.github/workflows/ci.yml`, tests, and
Beads. The original `prexu-pd1x` automation epic is **closed**; its
[July audit](archive/test-automation-audit.md) is historical, not an open plan.

## Local validation

| Command | Coverage |
| --- | --- |
| `npm run test:run` | Vitest unit and integration suites, including real watch-state surfaces, boot, and postplay seams |
| `npx tsc --noEmit` | TypeScript checking |
| `npm run lint` | Frontend oxlint |
| `npm run build` | Type checking and production frontend bundle |
| `npm run test:e2e -- --project=chromium` | Browser application flows against mocked service boundaries |
| `npm run test:e2e -- --project=player-chrome` | Actual player UI with a test-mode player hook; not native graphics |
| `mise run hw-probe:selftest` | Pure hardware-probe verdict tests and known-bad fixtures |
| `mise run ci` | Lint, TypeScript, Vitest, relay and src-tauri clippy/tests, frontend build, Chromium E2E, probe self-test |

The local `ci` task runs `cargo test --lib` for src-tauri; it does not include
headless-mpv integration, the player-chrome Playwright project, GitHub's Xvfb
smoke job, or `mise run scan`. Run those relevant checks separately. `mise run scan` fails on High/Critical;
the GitHub security workflow currently does not. Local
E2E provisioning invokes Playwright browser/system dependency installation.

Review snapshot on 2026-09-20: 198 Vitest files / 2,314 tests passed;
TypeScript passed; oxlint completed with two warnings. These numbers are a
point-in-time local result, not a permanent expected count or current CI claim.

## GitHub checks configured in the repository

| Job | Coverage and limits |
| --- | --- |
| `ci` | Frontend checks, probe self-tests, relay clippy/tests, Chromium and player-chrome E2E |
| `headless-mpv` (Windows) | Desktop clippy/lib tests and real mpv signal-chain integration; ANGLE runtime DLL integrity tests skipped because this job uses stubs |
| `headless-mpv-linux` (Ubuntu 24.04) | Real libmpv API 2.x signal-chain integration |
| `linux-build` (Ubuntu 22.04) | Frontend production build, desktop clippy/build/tests with system libmpv, check that the player-chrome stub is absent from production assets |
| `desktop-smoke-linux` | Advisory Xvfb process launch/liveness/exit/zombie check; not authenticated dashboard or visual validation |
| Separate security workflow | Report-only SBOM/Grype scanning; findings do not fail this workflow |

For headless runtime tests after provisioning libmpv and frontend assets:

```bash
cd src-tauri
cargo test --test headless_mpv -- --nocapture --ignored
```

Windows additionally needs the DLL beside the test executable; see
[CI native artifacts](../src-tauri/ci/mpv/README.md). CI configuration does not
prove the latest remote run passed; inspect that run when preparing a release.

## Test boundaries

- Integration tests mount real hooks, state, and consumer surfaces while mocking
  service boundaries. See `src/__tests__/integration/`.
- Browser E2E cannot see native video/compositor output. The player-chrome Vite
  mode substitutes `src/hooks/usePlayer.playwright-stub.ts` only for UI testing.
- Do not add `window.__TAURI_INTERNALS__` to the general E2E mock: it changes
  storage/runtime detection and has previously produced misleading login-only passes.
- Keep the jsdom localStorage polyfill in `src/__tests__/setup.ts`.
- Hardware verdict self-tests exercise parsers and failure cases; they do not
  substitute for collecting fresh logs/captures on hardware.

## Real hardware coverage and next investment

The [hardware plan](linux-on-hardware-test-plan.md) remains the acceptance
scenario catalog. The [probe runbook](hw-probe-runbook.md) automates log,
luminance, timing, resource and some X11 checks. Several transitions still
need an operator; Wayland cannot use the X11 input/geometry probes.

The immediate pickup is relay lifecycle `prexu-9f4s.5`, then client lifecycle
`prexu-9f4s.3`; work is currently paused. The later testing investment is
`prexu-vbb2`: full-app visual regression on the real
native app. Its first child, `prexu-331f`, is **not implemented**: a debug-only
in-app script driver with cue markers, followed by screen recording and
per-step verdicts. The proposed `PREXU_PROBE_SCRIPT` variable is not a current
launch option. Performance ceiling calibration (`prexu-xxct`), capture retry
hardening (`prexu-s83x`), and the hover-prefetch E2E flake (`prexu-xnbl`) remain
tracked separately. Use Beads for live status and dependencies.
