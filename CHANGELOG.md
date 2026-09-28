# Changelog

All notable changes to Prexu are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No changes since 0.8.0.

## [0.8.0] - 2026-09-28

Windows release. Linux support is **experimental**: the native player compiles and
runs on Linux, but release packaging does not provision libmpv and AppImage/rpm
runtime operation is unverified (`prexu-axj4.7`). macOS remains HTML5 only.

Windows installer acceptance for this release was run unattended on hosted GitHub
runners and is recorded in [docs/windows-candidate.md](docs/windows-candidate.md).
Read **Known untested on Windows** below before deploying: hosted runners have no
GPU and no audio device, so video output and audio playback were not verified for
this release.

### Added

- Linux native libmpv render-API playback under WebKitGTK, with engine selection,
  HTML5 fallback, mini-player subtitle compensation, and Linux popout support.
- Integration coverage for watch-state surfaces, startup, postplay, browser
  player chrome, Linux/Windows headless mpv, and hardware-probe verdicts.
- Semi-automated Linux hardware probes and advisory Xvfb process-lifecycle CI.
- macOS codec/compositing spike evidence and an accepted native opt-in ADR;
  production macOS native playback remains unimplemented.

### Changed

- Tauri upgraded to 2.11.5 and the composition-hosting fork re-vendored on Wry 0.55.1.
- Faster startup, Linux mpv warmup, streaming file proxy, library/detail caching,
  hover prefetch, virtualized grids, and narrower React updates.
- Dependency remediation, a local High/Critical vulnerability scan gate, and
  report-only security scanning in GitHub Actions.

### Fixed

- Linux first-frame reveal, mini-player/restore and popout transitions,
  compositor idle work, and diagnostic-mode explicit-sync handling.
- Stale resume/watch-state surfaces and early-stop handling for already-watched media.
- Resize-driven frontend churn; added resize-latency diagnostics. The remaining
  WebKitGTK presentation stall is still tracked in `prexu-41cw` / `prexu-v6pr`.

- Relay invites now use authenticated identity, session membership/metadata,
  and an operator-configured endpoint. Offline invite queues are bounded and
  deduplicated; WebSockets expire after 90 seconds without inbound activity.
- TMDb external-ID lookup rejects path/query injection before proxying.
- Relay session lifecycle: a reconnecting client is no longer evicted from its own
  session when the previous socket finally errors, and switching sessions no longer
  leaves a ghost participant holding the old session open.
- Watch Together client lifecycle: a healthy socket is no longer torn down on every
  reconnect-backoff interval, joining no longer gates on the wrong readiness flag,
  and relay payloads are typed at the boundary.
- Player teardown converges when mpv does not answer `quit`: the event pump is
  stopped instead of joined indefinitely, so a failed shutdown no longer leaves the
  previous player alive underneath a new one.

### Deployment notes

- The relay now requires `--public-url ws(s)://host[:port]/ws` to send invites.
  If omitted, invites fail closed; other relay features remain available.

### Verified for this release

Unattended Windows acceptance on hosted `windows-latest` runners, harness revision
`735a2f9` against candidate build `707e865`
([run 36390510490](https://github.com/nwilliams22/prexu/actions/runs/36390510490)):
fresh NSIS and MSI install, actionable login screen, native first-paint handshake,
clean exit, 0.7.1 → 0.8.0 upgrade retaining preferences, and uninstall cleanup.
The same harness correctly **fails** both formats when a runtime DLL is removed
([run 36390513402](https://github.com/nwilliams22/prexu/actions/runs/36390513402)).

### Known untested on Windows

A hosted GitHub runner has no graphics card and no audio device, so the checks below
were not performed for 0.8.0. The repository owner reviewed this and chose to ship
with the limitation recorded (decision 2026-09-28); acceptance work continues under
`prexu-0828` and the beads named here.

- **Visible video output.** Native playback frames reaching the screen through
  libmpv → ANGLE/D3D11 → DirectComposition are unverified on real hardware. This is
  the code most affected by this release's Tauri 2.11.5 upgrade and the re-vendored
  composition-hosting fork on Wry 0.55.1.
- **Audible playback**, including multichannel → stereo downmix behavior
  (`prexu-wiyy`).
- **Window, DPI and fullscreen transitions** at real display scale: resize,
  minimize/restore, mini-player, popout, fullscreen (`prexu-6p8k`).
- **Authenticated-media and multi-client journeys.** The acceptance run only reached
  the unauthenticated login screen; no library or Watch Together session was played
  (`prexu-vbb2.6`).
- **Updater signature and key matching.** The release workflow signs with the
  production key, but no signed end-to-end update from 0.7.1 to 0.8.0 has been
  exercised.

### Remaining acceptance outside Windows

- Linux libmpv release provisioning, AppImage/rpm runtime verification and build
  provenance (`prexu-axj4.7`), plus remaining hardware/codec checks. The release
  workflow's Linux leg is expected to be unreliable until `axj4.7` lands.
- Deploy and verify the relay security fixes; other `prexu-9f4s` review findings
  remain open.
- macOS platform-aware HTML5 direct-play gate (`prexu-ttz9`).

## [0.7.1] - 2026-06-26

Cross-platform build groundwork. No user-facing app changes on Windows; this
release makes non-Windows targets build and adds a Linux release.

### Added

- Linux release builds: the CI release now produces Linux **AppImage** and
  **rpm** artifacts alongside the Windows installers. Linux uses the HTML5
  `<video>` engine (the native libmpv player remains Windows-only).

### Changed

- The native player module and `libmpv2` are gated to Windows, so macOS/Linux
  compile and link without libmpv (previously failed at `-lmpv`).
- A Linux `src-tauri` build runs in CI to guard the non-Windows build.

## [0.7.0] - 2026-06-26

First release with the native Windows video player. WebView2/Chromium on
Windows cannot decode HEVC Main 10 in real time without a paid Store codec;
the native libmpv engine removes that limit.

### Added

- Native libmpv-backed video player on Windows for broad codec support,
  notably HEVC 10-bit, replacing the HTML5 `<video>` + hls.js engine on that
  platform (#10, #11).
- In-surface mpv rendering via DirectComposition, so video appears in alt-tab
  and taskbar previews instead of a black tile (#12, #13, #16).
- Cross-platform builds: Linux and macOS now compile by gating the
  Windows-only libmpv player; those platforms keep the HTML5 `<video>` engine
  (#15).
- `README.md` with a platform support matrix and known-limitations section
  (#20).

### Fixed

- "Now Playing" session lingered in Plex after an early stop (<60s watched):
  the stop now sends a `state=stopped` timeline report so the session ends
  promptly instead of waiting for the server idle timeout (#20).
- Watch Together relay: keepalive first tick delayed so a `Pong` no longer
  races the first broadcast (#17).
- Player taskbar preview now shows live video at the correct aspect ratio
  (#13).

### Changed

- Modernization pass: tooling gaps and structural debt remediation (#14).
- CI: relay-server tests run in the Ubuntu job; Linux `src-tauri` build added
  to CI (#18, #19).

## Earlier releases

See the [git tags](https://github.com/nwilliams22/prexu/tags) for the history
prior to 0.7.0 (0.5.x–0.6.x).

[Unreleased]: https://github.com/nwilliams22/prexu/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/nwilliams22/prexu/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/nwilliams22/prexu/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/nwilliams22/prexu/compare/v0.6.3...v0.7.0
