# Windows candidate installers (testing only)

[Windows candidate](../.github/workflows/windows-candidate.yml) is a manual,
non-publishing build for Windows x86_64. It builds NSIS `.exe` and MSI `.msi`
installers with the real SHA256-checked libmpv and ANGLE DLLs. It uses the same
vendor pins as `release.yml` (and `ci.yml` for libmpv); keep those values and the
ANGLE loader hashes aligned when changing dependencies. libmpv repository variable
overrides follow the release workflow; record any overrides with test results.
ANGLE is extracted from the SHA256-pinned existing v0.7.1 installer without
executing it. The extracted DLLs must match the unchanged runtime pins and pass
Authenticode verification. No separate ANGLE vendor release is needed.

The workflow has only `contents: read` permission, does not retain checkout
credentials, and does not create tags, releases, registry packages, updater
signatures, or `latest.json`. A temporary config sets
`bundle.createUpdaterArtifacts` to `false`; `--no-sign` skips code signing.
No production signing secrets are passed. The app's updater endpoint/public key
remain unchanged, so these installers cannot certify production updater signing.
See [Tauri configuration](https://v2.tauri.app/reference/config/) for config merge
and updater artifact settings.

## Build and download

1. Ensure the workflow is on the default branch so its
   manual trigger is available ([GitHub manual workflow guide](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)).
2. In GitHub **Actions → Windows candidate → Run workflow**, select the approved
   branch and start the build. Do not tag a release to obtain a candidate.
   CLI equivalent, after delivery: `gh workflow run windows-candidate.yml --ref main`.
3. Open the successful run, check its source commit, and download
   `windows-candidate-<full-commit-SHA>-<run-attempt>` from **Artifacts**.
   CLI equivalent: `gh run download <run-id> --dir windows-candidate`.
4. Extract the artifact ZIP. It contains both installers, `SHA256SUMS.txt`, and
   `BUILD.txt` with source commit, run URL/attempt, and vendor hashes. Verify each
   installer's hash with `Get-FileHash <installer-path> -Algorithm SHA256` against
   `SHA256SUMS.txt`. The artifact expires after 14 days; save it and the run URL
   with the acceptance record if testing will happen later.

A missing NSIS or MSI output fails the job. A green build proves artifact
production, not installation or GPU playback. The initial Windows runs failed at the now-replaced ANGLE download source.
A successful run of the repaired workflow is still required. Linux validation
cannot exercise MSVC import-library generation, WiX/NSIS packaging, Windows DLL
loading, or the Windows UI. No installer or Windows UI was observed locally.

## Acceptance once Windows hardware exists

Beads `prexu-nrqw` owns artifact production; `prexu-0828` owns acceptance.
Bad Dong coordinates access to a Windows x86_64 machine (or a suitable Windows
VM with working GPU acceleration); the owner must provide that access. Record
Windows build, GPU/driver, WebView2 version, installer type, source SHA, run URL,
and observed pass/fail results. Use a disposable test profile or backed-up
installation: this is the same application identity/version as the pending
release, not a separately installed preview edition.

1. Test **each** installer on a clean system/profile. Check install, launch,
   WebView2 setup, initial 1280×800 logical window (subject to screen size/DPI),
   login/library visibility, and absence of a black or transparent startup UI.
2. Confirm installed `libmpv-2.dll`, `libEGL.dll`, and `libGLESv2.dll` are present.
   Play representative media with the native engine, seek/pause/resume, select
   audio/subtitles, and stop. Observe video, audio, controls, and clean exit.
   Follow [playback smoke scenarios](phase2-smoke-test.md).
3. Check resize, minimize/restore, mini-player, popout, and fullscreen transitions
   at the test display scale. Record results against existing `prexu-6p8k`
   fullscreen acceptance instead of opening a duplicate task.
4. Select HTML5 and play compatible media; separately exercise a controlled
   native failure to verify runtime fallback. Record the cause and the observed
   fallback, not just the engine preference setting.
5. Test upgrade from the prior installation and uninstall for each installer,
   recording retained settings and any running-process/DLL replacement errors.
6. Keep updater signature/key matching **pending**: these unsigned candidates
   intentionally omit updater artifacts. Production-key validation requires a
   separately authorized signed test path. Do not publish or load production
   secrets into this workflow to satisfy that check.

Attach redacted observations to `prexu-0828`. Build failures stay with
`prexu-nrqw`; lack of Windows hardware stays with the owner. Neither this job nor
a successful candidate install authorizes a release tag or publication.
