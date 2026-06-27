# Changelog

All notable changes to Prexu are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/nwilliams22/prexu/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/nwilliams22/prexu/compare/v0.6.3...v0.7.0
