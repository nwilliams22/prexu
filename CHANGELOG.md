# Changelog

All notable changes to Prexu are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Changes present in the source tree since 0.7.1; this is not a release announcement.

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

### Deployment notes

- The relay now requires `--public-url ws(s)://host[:port]/ws` to send invites.
  If omitted, invites fail closed; other relay features remain available.

### Remaining release acceptance

- Linux libmpv release provisioning, AppImage/rpm runtime verification and build
  provenance (`prexu-axj4.7`), plus remaining hardware/codec checks.
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

[Unreleased]: https://github.com/nwilliams22/prexu/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/nwilliams22/prexu/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/nwilliams22/prexu/compare/v0.6.3...v0.7.0
