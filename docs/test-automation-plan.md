# Test automation — coverage matrix and enforceability

Audited 2026-09-20; expanded 2026-11-11 into the journey-by-journey coverage
matrix required by `prexu-vbb2.7` (BAD-373). The original `prexu-pd1x`
automation epic is **closed**; its
[July audit](archive/test-automation-audit.md) is historical, not an open plan.

## What this document is

This is the maintained regression-coverage matrix and the enforceability
record. Every **supported journey** is mapped to the command that drives it,
the environment it runs in, the output it asserts and the artifact it leaves
on failure. Tier 1 (unit/browser) and Tier 2 (real-service) run on a **hosted
runner with mocked or seeded boundaries**. Tiers 3–4 (real app, installed
artifact) and the residual list require **provisioned** GPU, display, audio,
or a second QA identity, so they are tracked as beads or human decisions —
not as hosted checks.

This is a coverage reference, **not a claim of universal automation**. The
matrix names what is automated, what is automated in CI, what is still manual,
and what still needs a person or hardware.

## Journey coverage matrix

Journey columns:

- **Command** — the exact invocation a developer or CI runs.
- **Environment** — hosted runner (no GPU/audio/display) or provisioned box.
- **Asserts** — the specific output the run checks.
- **Failure artifact** — what is left to inspect when the run fails.
- **CI-gated** — `yes` means a required gate blocks a merge on failure;
  `advisory` means the run executes but its failure does not block (see
  [continue-on-error audit](#continue-on-error-audit)); `manual`/`residual`
  means it is not in an unattended gate today.

### Tier 1 — unit / browser (hosted; mocked or seeded service boundaries)

| Journey | Command | Environment | Asserts | Failure artifact | CI-gated |
| --- | --- | --- | --- | --- | --- |
| Boot/startup waterfall | `npx vitest run` (file `src/__tests__/integration/bootWaterfall.test.tsx`) | Hosted | Boot state reaches the expected settled shape after the startup waterfall | Vitest reporter summary + test name | yes |
| Postplay/queue chain | `npx vitest run` (file `postPlayChain.test.tsx`) | Hosted | Postplay and queue-advance seams fire in the recorded order | Vitest reporter summary | yes |
| Watch-state resume label | `npx vitest run` (file `watchStateResumeLabel.test.tsx`) | Hosted | Resume label text matches the watch-state input | Vitest reporter summary | yes |
| Login (UI, seeded auth) | `npm run test:e2e -- --project=chromium` (file `e2e/login-flow.spec.ts`) | Hosted | Login flow renders; credential screen and PIN entry paths mount | Playwright screenshot on failure + trace on first retry | yes |
| Library browse | `npm run test:e2e -- --project=chromium` (file `e2e/library-view.spec.ts`) | Hosted | Library page lists the expected sections | Playwright screenshot + trace | yes |
| Dashboard | `npm run test:e2e -- --project=chromium` (file `e2e/dashboard.spec.ts`) | Hosted | Dashboard surfaces mount with expected content | Playwright screenshot + trace | yes |
| Item detail | `npm run test:e2e -- --project=chromium` (file `e2e/item-detail.spec.ts`) | Hosted | Detail page shows the expected metadata for a seeded item | Playwright screenshot + trace | yes |
| Search | `npm run test:e2e -- --project=chromium` (file `e2e/search-flow.spec.ts`) | Hosted | Search results update for a seeded query | Playwright screenshot + trace | yes |
| Settings (device / preferences / search) | `npm run test:e2e -- --project=chromium` (files `e2e/settings-*.spec.ts`) | Hosted | Settings controls render and persist in-memory | Playwright screenshot + trace | yes |
| Accessibility | `npm run test:e2e -- --project=chromium` (file `e2e/accessibility.spec.ts`) | Hosted | axe violations reported on the audited views are zero | Playwright screenshot + trace + axe output | yes |
| Responsive layout | `npm run test:e2e -- --project=chromium` (file `e2e/responsive-layout.spec.ts`) | Hosted | Layout reflow holds at the tested viewports | Playwright screenshot + trace | yes |
| Player-chrome (real player UI, stubbed engine) | `npm run test:e2e -- --project=player-chrome` (file `e2e/player-chrome.spec.ts`) | Hosted | Player chrome mounts and dispatches the expected UI state transitions | Playwright screenshot + trace | yes (separate CI step from the chromium project) |
| Type check | `npx tsc --noEmit` | Hosted | No TypeScript diagnostics | tsc output | yes |
| Lint | `npm run lint` (oxlint over `src/`) | Hosted | No oxlint findings | oxlint output | yes |
| Production bundle | `npm run build` | Hosted | `dist/` produced and the player-chrome stub marker is absent from it (see linux-build) | dist tree + the grep result | yes |
| Relay-server (Rust) integration | `mise run test-relay` (WS/tokio/axum; no libmpv) | Hosted | Relay unit + WS integration suite pass | cargo test output | yes |
| src-tauri library (excluding real-libmpv) | `mise run test-tauri` (runs `cargo test --lib --test probe_script` + `probe_environment` release-gate tests) | Hosted, needs `npm run build` first | probe-signal library tests and the release-gate environment tests pass | cargo test output | yes |
| hw-probe verdict core (pure) | `mise run hw-probe:selftest` (nushell; mutation-checked) | Hosted (nushell 0.116.1, installed with a retry pattern — see continue-on-error audit) | Log-invariant + luminance + probe verdicts pass on the fixtures | nushell script output | yes (attempt 3 is unguarded) |
| Probe-driver contract (pure Rust) | `mise run probe-driver:selftest` (python unittest) | Hosted | Scripted-session schema + negative controls pass | python unittest output | yes |

### Tier 2 — real-service (real Plex QA server; no routing/player mocks)

Driven by `scripts/real-journeys/run.mjs`. Any row that is `FAIL`, `BLOCKED`,
`NOT_RUN` or `UNSUPPORTED` causes the runner to **exit 1**. Missing
credentials fail **before startup** (exit 1); `--allow-missing-service`
records `SKIP` and exits 0 but never permits a failed request. The runner
discovers only **Prexu QA Test Server** and requires rating key `2` to be
**Prexu QA Pattern** — it never falls back to a personal movie. Credentials
and account responses stay in memory; the JSON report contains only fixed
scenario labels and diagnostic stages.

| Journey | Command | Environment | Asserts | Failure artifact | CI-gated |
| --- | --- | --- | --- | --- | --- |
| Session restore | `PREXU_JOURNEY_REPORT=<path> node scripts/real-journeys/run.mjs` → session-restore step | Hosted + **protected env value** `PREXU_QA_PLEX_AUTH` (never committed, per AGENTS.md line 187) + Playwright Chromium | The seeded auth store recovers the session and the `Prexu QA Pattern` heading is present on the recovered library and detail views | The JSON report row `session-restore` (FAIL reason); no browser trace saved by design | **No — gated only through credential-free negative controls** (see prexu-vbb2.8) |
| Browse → search → detail (identity) | same runner → browse-search-detail step | as above | Search results and the detail heading match the service fixture (rating key 2) | the JSON report row `browse-search-detail` | **No — same as above** |
| Settings persistence across reload | same runner → settings-persistence step | as above | A preference changed before reload is still set after a full reload | the JSON report row `settings-persistence` | **No — same as above** |
| Credential-free negative controls (gated in CI) | `node --test scripts/real-journeys/run.test.mjs` + `node --check scripts/real-journeys/run.mjs` | Hosted (no credentials used) | The fail-closed and explicit-skip paths behave as documented; the script parses | node `--test` summary | **yes** (`.github/workflows/real-journeys.yml`) |

The residual real-service journeys (each named explicitly, not silently
omitted) are:

- **Login (desktop PIN):** desktop shell opens the real PIN flow; the
  seeded browser auth does not prove it.
- **Playback / resume / watch-state:** desktop driver + service assertions +
  restoration of synthetic-fixture state.
- **Queue / postplay:** real playback completion and queue advancement.
- **Downloads / offline:** Tauri download backend unavailable in a browser;
  requires the desktop driver.
- **Two-client relay:** a second distinct authorized QA Plex account bound
  as `PREXU_QA_PLEX_GUEST_AUTH`, then a local production relay and two app
  clients. As of 2026-11-11 `PREXU_QA_PLEX_GUEST_AUTH` is **not provisioned**
  and the runner does not consume it. Provisioning is a spend/identity
  decision (see [Residual needs](#residual-needs)).

### Tier 3 — real app (native desktop player, libmpv)

Hosted jobs below run **headless** with stubbed or null outputs — they verify
the Rust signal chain and process behaviour, **not** visible video or audible
sound. The provisioned-box columns are what the acceptance scenario catalog
(`linux-on-hardware-test-plan.md`) requires.

| Journey | Command | Environment | Asserts | Failure artifact | CI-gated |
| --- | --- | --- | --- | --- | --- |
| mpv signal chain (init → FileLoaded → duration → eof-reached) | `cd src-tauri && cargo test --test headless_mpv -- --nocapture --ignored` | Hosted (Windows: vendored `libmpv-2.dll`; Linux: system `libmpv` 2.x on ubuntu-24.04) | Signal-chain state machine transitions recorded in expected order; no hang past the 3-minute step timeout | `cargo test` output (RUST_LOG=debug); no screen/audio evidence by design | yes (windows `headless-mpv` job + ubuntu `headless-mpv-linux` job) |
| Generated-fixture seek / track / error / teardown | same job, step "Generated fixture signal tests (null outputs)" (`cargo test --test probe_fixture -- --ignored --nocapture`) + fixture-hash `--verify` | Hosted, `PREXU_TEST_FIXTURE` set to the CI-generated `av-cues-v1.mkv` | Playback reaches each scripted cue, tracks the expected stream, tears down without a zombie; fixture SHA-256 matches the `probe-fixtures` artifact | `cargo test` output; `probe-fixtures/` GitHub artifact (7-day retention) | yes |
| Real-libmpv teardown tests (player::events) | `mise run test-tauri-mpv` / `cargo test --lib -- --ignored --nocapture` | Hosted (Windows vendored DLL; ubuntu-24.04 system 2.x). **Not run** on ubuntu-22.04, whose system libmpv is API 1.x and aborts with `VersionMismatch` | Teardown creates a real mpv handle and releases it cleanly | `cargo test` output | yes |
| ANGLE runtime DLL integrity (SHA-256 pin + Authenticode) | `player::angle_loader` (inside the `--lib` run) | **Provisioned real Windows box** — skipped explicitly in the headless Windows CI job (`--skip angle_dlls_match_sha256_pins --skip angle_dlls_authenticode_valid`) because that job stubs the DLLs to satisfy the tauri_build resource-path check | The runtime loader rejects a tampered or mis-signed ANGLE pair | `cargo test` output on the real box | **No — residual (real Windows box required; see `linux-on-hardware-test-plan.md`)** |
| Desktop boot under Xvfb (launch, liveness, frontend handshake, clean exit, no zombie) | `.github/workflows/ci.yml` → `desktop-smoke-linux` job (`xvfb-run -a ... prexu` under `dbus-run-session`) | Hosted ubuntu-22.04 (soft-GL, no GPU/DRM device) | React completes the `app_ready — frontend signalled first paint` handshake; process survives 18 s; exits within 15 s of SIGTERM; no defunct `prexu`/`mpv` remains | `smoke-attempt-N.log`, `smoke-diagnostics-N.log`, `smoke-state-N/data/com.prexu.client/logs/*.log` → `xvfb-desktop-smoke-logs` GitHub artifact | **Advisory** — `continue-on-error: true` at job level; does not block a merge (see prexu-vbb2.9) |

### Tier 4 — installed artifact (distribution)

| Journey | Command | Environment | Asserts | Failure artifact | CI-gated |
| --- | --- | --- | --- | --- | --- |
| Linux AppImage build + launch | `npm run build` → `cargo build --features tauri/custom-protocol` → AppImage → `"$appimage" --appimage-extract` → launch under Xvfb (expected timeout-exit 124) | Hosted ubuntu-22.04 via `.github/workflows/release.yml` (`build` job) | glibc-2.39+ target builds; AppImage extracts to the expected file set; launch survives a bounded window | `extraction.log`; launch exit status | **Not a PR gate** — release workflow only (triggered by tag/manual). Treat as release evidence |
| Windows installer (NSIS + MSI) acceptance | `.github/workflows/windows-acceptance.yml` (`format: [nsis, msi]`, `workflow_dispatch`, optional `fault: missing-dll` negative control) | Hosted `windows-latest` | Both installers extract; each launch path is validated; the `missing-dll` fault control **must fail** the acceptance | PowerShell step logs + GH artifact | **Not a PR gate** — `workflow_dispatch` only. The two CI jobs above are the in-PR gates for the same code |
| macOS (HTML5) | — (player module is not compiled on macOS) | Provisioned macOS | Browser-only HTML5 acceptance — distinct evidence requirement from native playback. There is no Tauri build on macOS today. | — | **No** — residual decision (see [Residual needs](#residual-needs)) |

## continue-on-error audit

The matrix must prove no required evidence can silently skip. `ci.yml`
contains three `continue-on-error` declarations. Each is audited here.

| Location | Scope | What it protects | Does required evidence sit behind it? |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml:84` (step `Install Nushell (attempt 1)`) | step-level | One of three retries of the `hustcer/setup-nu@v3` action | **No.** If attempt 1 fails the workflow retries (attempt 2, line 96) and then attempt 3, which has **no** `continue-on-error`. Line 119 `test "$(nu --version)" = "0.116.1"` then hard-fails if nushell is not present. The hw-probe verdict-core selftest (a required Tier-1 row) therefore cannot run over a silent-skip: a final-install failure fails the job. |
| `.github/workflows/ci.yml:96` (step `Install Nushell (attempt 2)`) | step-level | One of the same three retries | **No.** Same chain: attempt 3 (line 106, ungated) and the version check at line 119 close the gate. |
| `.github/workflows/ci.yml:463` (job `desktop-smoke-linux`) | job-level | The Xvfb smoke run (launch, liveness, frontend `app_ready` handshake, clean exit, no zombie) | **Yes — this is the one site that actually hides required evidence.** The job is advisory (`continue-on-error: true`), so every assertion it makes (including the frontend `app_ready` handshake, which the step explicitly calls out as not just liveness) can fail without blocking a merge. **Action: prexu-vbb2.9** (decide the gate policy and enforce it). Recorded as a residual human decision below. |

The retry pattern for Nushell is the safe case: the *final* attempt is gated
and a version probe closes the loop. The desktop-smoke job is not: that is an
explicitly chosen advisory posture (see the comment at `ci.yml:452`), not an
accident, but it must be re-decided once the frontend handshake has become a
reliable assertion. That decision is prexu-vbb2.9.

## CI changes required for gating

These are the only two CI/enforcement changes the 2026-11-11 matrix calls
for, and they are named as beads so the matrix is the source of truth for
what is and is not yet enforced. Both are code changes to
`.github/workflows`, so they are owned by Chani or Duncan per the ticket —
this document does not edit a workflow file.

| Change | Bead | Owner | Scope |
| --- | --- | --- | --- |
| Gate the real-service tier in unattended CI with the QA credential | `prexu-vbb2.8` | Chani or Duncan | Add a job to `.github/workflows/real-journeys.yml` (or `ci.yml`) that sets `PREXU_QA_PLEX_AUTH` from a protected repo secret, installs Playwright Chromium, runs `node scripts/real-journeys/run.mjs`, and fails the gate. The runner already exits 1 on any `FAIL/BLOCKED/NOT_RUN/UNSUPPORTED` row. No credential is committed; it stays a protected environment value per AGENTS.md line 187. |
| Decide the Xvfb desktop-smoke gate policy and enforce it in CI | `prexu-vbb2.9` | Chani or Duncan | Either promote `desktop-smoke-linux` to a required gate (remove `continue-on-error: true` at `ci.yml:463`) now that it asserts the frontend `app_ready` handshake, or keep it advisory and record the residual-risk decision on a bead. The matrix is only accurate once this decision is written down. |

`prexu-vbb2.7` (this ticket) does not include those code changes — it records
the matrix and the evidence below.

## Residual needs, human decisions, and spend

The following can be evidenced on a provisioned box or require a person; they
are **not** part of the hosted PR gate. Each names the decision or the
resource it needs, so a ticket exists instead of a silent gap.

- **HDR / color.** Provisioned display with the target's colour pipeline and
  a calibration reference. Human decision: which target is the reference for
  "looks right".
- **Physical audio routing / passthrough.** Provisioned audio hardware and a
  measured loudness/latency readout (the probe runbook covers some of this; a
  calibrated target is required for the rest). Human decision: the
  pass/fail threshold.
- **Multi-monitor / DPI.** Provisioned desktop with the declared multi-monitor
  and DPI configurations. Human decision: which combinations are declared
  supported.
- **Subjective-quality calibration.** Human judgment. This is never an
  automated gate.
- **Real-Windows ANGLE Authenticode.** Provisioned real Windows box (see the
  Tier 3 row already marked residual). Already tracked.
- **macOS HTML5.** Either provision a macOS box, or record the decision that
  macOS is shipped browser-only with no Tauri build. Decision owner: Bad Dong.
- **Second QA Plex identity for two-client relay.** Not yet provisioned
  (`PREXU_QA_PLEX_GUEST_AUTH`). Provisioning is an identity + spend decision —
  the ticket text says "list it and do not buy it". Owner: Bad Dong (spend
  gate) plus the engineer who wires it (Chani or Duncan) once provisioned.
- **Provisioned GPU / display / audio hardware for the full real-app and
  real-hardware acceptance catalog.** The `prexu-vbb2` harness work builds on
  the debug-only scripted driver. Infrastructure is a spend decision, named
  here and not bought by this ticket.

## Baseline and injected-failure evidence (2026-11-11)

The matrix must show that no required evidence can silently skip or
`continue-on-error`. Two repeated baseline runs and one injected-failure run
were executed locally on the current tree, against `main`.

### Baseline — two consecutive green runs (identical)

Command: `npx vitest run`

| Run | Test files | Tests | Duration | Exit |
| --- | --- | --- | --- | --- |
| Run 1 | 214 passed | 2415 passed | 279.27 s | 0 |
| Run 2 | 214 passed | 2415 passed | 366.23 s | 0 |

Logs: `/tmp/baseline-vitest-1.log`, `/tmp/baseline-vitest-2.log` (kept only on
the box; the summary table is the durable record).

Also green across both runs:

- TypeScript type check (`npx tsc --noEmit`) — CI step.
- Relay-server unit + WS integration suite (`mise run test-relay`) — CI step.
- Real-service credential-free negative controls
  (`node --test scripts/real-journeys/run.test.mjs`) — both the fail-closed
  and the explicit-skip paths: `tests 2 / pass 2 / fail 0`, exit 0. The
  negative-control test itself asserts the runner exits non-zero when the
  credential is missing, so the fail-closed behaviour of the real-service tier
  is itself covered by a CI-required check (`.github/workflows/real-journeys.yml`).

### Injected failure — a real failure must block, it cannot be hidden

A temporary test file (`src/__tests__/injected-failure.test.tsx`) was added
that intentionally fails (`expect(42).toBe(41)`), the suite was run, and the
file was **deleted before this commit**. Nothing injected is in this tree.

| With injected failure | Test files | Tests | Exit |
| --- | --- | --- | --- |
| `npx vitest run` | 1 failed \| 214 passed (215 total) | 1 failed \| 2415 passed (2416) | **1** |

Log: `/tmp/injected-failure.log`. The failure line is
`FAIL src/__tests__/injected-failure.test.tsx > intentionally fails to prove the gate exits non-zero`.
The non-zero exit confirms that a real failure surfaces as a non-zero exit —
a failure cannot be masked by `continue-on-error` because the only
`continue-on-error` that hides evidence on a required journey is the desktop-smoke
job (see the [continue-on-error audit](#continue-on-error-audit) row at
`ci.yml:463`), and that decision is prexu-vbb2.9.

## Local validation table (unchanged since 2026-09-20)

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

## GitHub checks configured in the repository

| Job | Coverage and limits |
| --- | --- |
| `ci` | Frontend checks, probe self-tests, relay clippy/tests, Chromium and player-chrome E2E |
| `probe-fixtures` | Generate the credential-free 15-second video, dual-tone audio and subtitle corpus with SHA256 manifest |
| `headless-mpv` (Windows) | Desktop clippy/lib tests and real mpv signal-chain plus generated-fixture seek/track/error/teardown integration; ANGLE runtime DLL integrity tests skipped because this job uses stubs |
| `headless-mpv-linux` (Ubuntu 24.04) | Real libmpv API 2.x signal-chain and generated-fixture seek/track/error/teardown integration, plus the `#[ignore]`d real-libmpv lib tests |
| `linux-build` (Ubuntu 22.04) | Frontend production build, desktop clippy/build/tests with system libmpv, check that the player-chrome stub is absent from production assets; its libmpv is API 1.x, so the real-libmpv lib tests are `#[ignore]`d here |
| `desktop-smoke-linux` | Advisory Xvfb process launch/liveness/exit/zombie check; `continue-on-error` advisory (prexu-vbb2.9 will decide the gate policy) |
| `real-journeys::credential-gates` | Credential-free negative controls only (`node --check` + `node --test`). The credential-bearing slice is local/manual until prexu-vbb2.8 lands |
| Separate `security-scan.yml` | Report-only SBOM/Grype scanning; findings do not fail this workflow |
| `release.yml` | Linux AppImage build + launch on tag/manual; not a PR gate |
| `windows-acceptance.yml` | NSIS + MSI installer acceptance on `workflow_dispatch`; `missing-dll` negative control; not a PR gate |

If a headless runtime test is needed after provisioning libmpv and frontend
assets:

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
