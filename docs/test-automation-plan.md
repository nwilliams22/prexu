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
| `mise run probe-driver:selftest` | Strict scripted-session schema/trace validation, failing CLI controls and fixture hash checks; no desktop |
| `mise run ci` | Lint, TypeScript, Vitest, relay and src-tauri clippy/tests, frontend build, Chromium E2E, probe self-test |

The local `ci` task runs `cargo test --lib` for src-tauri; it does not include
headless-mpv integration, the `#[ignore]`d real-libmpv lib tests
(`mise run test-tauri-mpv`), the player-chrome Playwright project, GitHub's Xvfb
smoke job, or `mise run scan`. Run those relevant checks separately. `mise run scan` fails on High/Critical;
the GitHub security workflow currently does not. Local
E2E provisioning invokes Playwright browser/system dependency installation.
On a machine whose Playwright system libraries are already provisioned, run
`PREXU_E2E_SYSTEM_DEPS_INSTALLED=1 mise run ci` to avoid privileged system
package installation. This still installs the required Chromium browser and runs
all checks; missing runtime libraries still fail the browser tests.

Review snapshot on 2026-09-20: 198 Vitest files / 2,314 tests passed;
TypeScript passed; oxlint completed with two warnings. These numbers are a
point-in-time local result, not a permanent expected count or current CI claim.

## GitHub checks configured in the repository

| Job | Coverage and limits |
| --- | --- |
| `ci` | Frontend checks, probe self-tests, relay clippy/tests, Chromium and player-chrome E2E |
| `probe-fixtures` | Generate the credential-free 15-second video, dual-tone audio and subtitle corpus with SHA256 manifest |
| `headless-mpv` (Windows) | Desktop clippy/lib tests and real mpv signal-chain plus generated-fixture seek/track/error/teardown integration; ANGLE runtime DLL integrity tests skipped because this job uses stubs |
| `headless-mpv-linux` (Ubuntu 24.04) | Real libmpv API 2.x signal-chain and generated-fixture seek/track/error/teardown integration, plus the `#[ignore]`d real-libmpv lib tests |
| `linux-build` (Ubuntu 22.04) | Frontend production build, desktop clippy/build/tests with system libmpv, check that the player-chrome stub is absent from production assets; its libmpv is API 1.x, so the real-libmpv lib tests are `#[ignore]`d here |
| `desktop-smoke-linux` | Blocking CI gate: Xvfb launch, 18-second liveness, frontend `app_ready` handshake, SIGTERM exit within 15 seconds, and no defunct prexu/mpv processes; not authenticated dashboard or visual validation |
| Separate security workflow | Report-only SBOM/Grype scanning; findings do not fail this workflow |

### Desktop smoke gate policy (2026-11-12, prexu-vbb2.9)

`desktop-smoke-linux` is blocking at the workflow level: it has no job-level
`continue-on-error`. Both allowed attempts must fail before the smoke step
fails CI. This does not configure GitHub branch protection; merge enforcement
also depends on the repository requiring the CI check.

The promotion is based on the latest 20 `main` CI runs inspected on 2026-11-12,
from [42958787651](https://github.com/nwilliams22/prexu/actions/runs/42958787651)
through [43167082189](https://github.com/nwilliams22/prexu/actions/runs/43167082189).
All 20 desktop-smoke jobs **and their smoke steps** concluded `success`:
0/20 observed terminal failures (0%). This is a short, two-day sample, not a
long-term flake guarantee. Attempt-level logs were unavailable through
`gh run view --log` during the audit, so first-attempt flakiness is unknown;
the existing two-attempt retry remains in place. Reproduce the job-level
sample with `gh run list --workflow ci.yml --branch main --limit 20` and
`gh run view <run-id> --json jobs`, inspecting the smoke step as well as the
job rather than relying on the overall workflow conclusion.

The job embeds production assets with `tauri/custom-protocol` and requires
React's `app_ready` IPC handshake in a fresh profile. Failure logs are saved
as `xvfb-desktop-smoke-logs`. Software GL under Xvfb still does not establish
GPU rendering, audible sound, authenticated playback, or installed-artifact
acceptance. Those remain separate acceptance boundaries.

For headless runtime tests after provisioning libmpv and frontend assets:

```bash
cd src-tauri
cargo test --test headless_mpv -- --nocapture --ignored
```

The `player::events` teardown tests create a real mpv handle, so they are
`#[ignore]`d too and are not in `cargo test --lib` or the local `ci` task. They
need libmpv API 2.x; against API 1.x they abort with
`VersionMismatch { linked: 131074, loaded: 65645 }`. Run them with
`mise run test-tauri-mpv`, or:

```bash
cd src-tauri
cargo test --lib -- --ignored --nocapture
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

The `prexu-vbb2` harness work builds on the debug-only scripted driver in
`prexu-331f`. `PREXU_PROBE_SCRIPT` is now implemented with isolated startup,
serial real-handler execution, native observations and Rust-written markers.
The Linux launcher generates a verdict from the trace and process exit.
Screen recording and per-step visual/audio verdicts remain follow-up work.
Performance ceiling calibration (`prexu-xxct`), capture retry
hardening (`prexu-s83x`), and the hover-prefetch E2E flake (`prexu-xnbl`) remain
tracked separately. Use Beads for live status and dependencies.

## Scripted-driver foundation

The [v1 contract verifier and fixture recipe](../scripts/hw-probe/driver/README.md)
are implemented. The fixture tests use real libmpv with null video/audio outputs;
their success does not prove display or speaker output. The pure verifier runs
in both `mise run ci` and hosted CI. Generated-fixture native tests are explicit
ignored tests in the Windows/Linux hosted jobs, with an external step timeout.
A real Linux desktop transport scenario and a deliberate timeout have produced
passing and failing harness verdicts respectively. These establish control/state
and fail-closed behavior only: software GL and null audio do not establish visible
video or audible sound. See the driver README for launcher commands and limits;
Beads records acceptance and links to the run evidence.
