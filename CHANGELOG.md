# Changelog

All notable changes to Prexu are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.2] - 2026-10-29

**A Linux repair release, and nothing else.** 0.8.2 exists because the Linux
AppImage and rpm published in 0.8.1 could not run the native player at all —
*Linux bundles are broken* under 0.8.1 states both faults. No feature waited for
this release; Windows is unchanged from 0.8.1 apart from the version number, and
macOS remains HTML5 only and is not distributed.

**If you downloaded a 0.8.1 AppImage or rpm, replace it with this one.** Nothing
you could install or configure repaired the 0.8.1 files: the wrong libmpv
travelled inside the AppImage, so a correct `libmpv.so.2` on your machine was
never consulted, and the rpm named none of the libraries the binary links.

### Fixed

- **The AppImage runs the native player.** The Linux leg of the release build no
  longer uses Ubuntu's `libmpv-dev`. It builds LGPL-mode mpv 0.39.0 and FFmpeg
  7.1.5 from SHA-256-pinned sources into the bundle, so the executable links
  `libmpv.so.2` and the matching API 2.x library ships beside it; no
  `libmpv.so.1` is present anywhere in the file. The silent fall back to HTML5
  playback on Linux is gone because the native player now initialises
  (`prexu-axj4.7`).
- **The rpm declares the libraries it actually needs.** `libmpv.so.2`,
  `libssl.so.3`, `libcrypto.so.3`, `libdbus-1.so.3` and the GTK/WebKit runtime
  sonames are now listed, so a distribution that cannot satisfy them refuses the
  install instead of installing cleanly and then launching nothing. The release
  build fails if any direct ELF dependency of the binary lacks an rpm provider.
- **Playback starts against system mpv builds older than 0.38.** `loadfile` is
  issued with or without the insertion-index argument according to mpv's own
  `command-list` metadata, instead of assuming the newer signature. This matters
  for the rpm, which links the distribution's libmpv rather than a bundled one.
- **Linux video is no longer near-black on a valid frame.** Two separate causes:
  GTK could leave GL blending enabled between paints, which corrupted libmpv's
  YUV conversion passes even when `render()` reported success — blending is now
  reset before every draw, including across seeks; and mpv's scaler lookup
  texture left unused lanes uninitialised, so heap NaNs could blacken correct
  decoded video. Prexu's bundled mpv backports the upstream fix
  ([72d43dc](https://github.com/mpv-player/mpv/commit/72d43dc9c999a21d867cdc0f934f3e4cd2195aa9))
  via `scripts/patches/mpv-scaler-lut-padding.patch`. **The rpm path depends on
  the distribution's libmpv carrying that fix**; API 2 compatibility alone does
  not guarantee it.

### Changed

- The release workflow extracts and launches the built AppImage on every push
  that touches Linux packaging, and fails the build unless the bundle links
  API 2.x, reaches mpv initialisation and starts the compositor. 0.8.1's Linux
  leg was green without ever opening the file it published; that is the gap this
  closes.

### Linux is still experimental — but not in the sense 0.8.1 meant it

0.8.1 called Linux experimental while shipping files that could not work. That
is no longer the case: the published AppImage and rpm in this release are
inspected and launched after publication, and the results are recorded in
*Verified for this release* below. What remains unverified for Linux is the same
class of thing that remains unverified for Windows — **visible frames, audio and
window behaviour on real graphics hardware**. Hosted runners have no GPU and no
audio device, so the Linux checks run under Xvfb with software rendering and
prove initialisation, not picture quality. Read *Known untested on Windows*
under 0.8.1; every item there applies to Linux too.

### Verified for this release

Source state: [CI run 40792871651](https://github.com/nwilliams22/prexu/actions/runs/40792871651)
and [Release run 40792871700](https://github.com/nwilliams22/prexu/actions/runs/40792871700)
are both green at `04d98c6`, the last source change before this cut; the cut
itself adds only version metadata and this changelog entry.

The release build is [Release run 40801392023](https://github.com/nwilliams22/prexu/actions/runs/40801392023),
green on both the Windows and the Linux leg at tag `v0.8.2`.

The checks that 0.8.1 failed were then re-run on the **files downloaded from
this release's page**, not on CI artifacts. A green CI leg is not evidence about
a published asset — treating it as evidence is what shipped 0.8.1's broken
bundles. The checks are listed in [docs/linux-bundles.md](docs/linux-bundles.md).
Published-asset results, 2026-10-29:

- **The published AppImage links and carries mpv API 2.x.** `readelf -d
  squashfs-root/usr/bin/prexu` names `libmpv.so.2`; `usr/lib/libmpv.so.2` ships
  beside it and reports client API **2.3**; no `libmpv.so.1*` exists anywhere in
  the file; all six bundled FFmpeg libraries report *LGPL version 2.1 or later*.
  SHA-256 `7746ba75…9ce449`.
- **The published AppImage starts the native player on a machine that is not a
  CI runner.** Launched from `AppRun` under `dbus-run-session` and `xvfb-run`
  with software GL, it logged `[player] mpv created`, `[player:linux] compositor
  installed`, `[player:linux] WebKit DMABUF renderer enabled (default)` and
  `[player:linux] mpv render context created (OpenGL backend); starting 60 Hz
  frame pump`, with no `VersionMismatch`, no HTML5 fallback and no ERROR or WARN
  line from the application.
- **The published rpm declares every library the published binary links.** Its
  29 `REQUIRENAME` entries cover all 18 `NEEDED` sonames, including
  `libmpv.so.2`, `libssl.so.3`, `libcrypto.so.3` and `libdbus-1.so.3`.
  SHA-256 `514dd3a4…e08bc4`.
- **Windows installers.** [Run 40802628345](https://github.com/nwilliams22/prexu/actions/runs/40802628345)
  **passed** both NSIS and MSI against the published 0.8.2 assets: byte digests
  matched the release API, install succeeded, a real WebView2 login screen
  appeared, the pinned ANGLE and libmpv runtime DLL hashes matched, an upgrade
  from 0.7.1 retained preferences, and uninstall left nothing behind.
  [Run 40802644915](https://github.com/nwilliams22/prexu/actions/runs/40802644915)
  **failed** both installers under fault injection, the correct result for a
  negative control. The scope limits recorded for 0.8.1 are unchanged: this is
  evidence of installation and launch, not of a frame on screen.
- **Updater payload.** `releases/latest/download/latest.json` returns 200 with
  version `0.8.2` and all six platform keys, every signature made by key id
  `b196a2228423f32a` — the same key id as the `plugins.updater.pubkey` the
  shipped application verifies against.

## [0.8.1] - 2026-10-27

Windows release, and the first installable Prexu build since 0.7.1. **0.8.0 was
tagged but never published**, so everything listed under 0.8.0 below reaches users
here for the first time, together with the fixes in this section.

Linux **AppImage and rpm bundles are published for the first time since 0.7.1,
and the files in this release are broken — do not expect the native player
from them**. Read *Linux bundles are broken* below before installing one.
macOS remains HTML5 only and is not distributed.

### Fixed

- Starting Prexu without internet access no longer signs you out. Stored
  credentials now survive an unreachable `plex.tv` when the local Plex server
  answers, so an offline start no longer forces a re-login that itself requires
  the internet (`prexu-9f4s.8`).
- Release builds for Linux produce artifacts again: the release job installs
   `libmpv-dev`, fixing the `unable to find library -lmpv` link failure that left
   0.8.0 with no Linux bundles. This fixes build-time linking only — see *Linux
   bundles are broken*.
- CI: the `player::events` mpv-teardown tests are `#[ignore]`d and run in the
  libmpv 2.x jobs instead of the Ubuntu 22.04 `linux-build` job, whose system
  libmpv is API 1.x and aborted them with `VersionMismatch`. `main` had been red
  since 2026-09-28.

### Added

- `scripts/qa-desktop-session.sh`, a desktop QA session runner (Xephyr inside a
  desktop session, Xvfb when headless).

### Verified for this release

[CI run 40180154034](https://github.com/nwilliams22/prexu/actions/runs/40180154034)
is green at `8e0432b`, the last source change before this release; the release cut
itself adds only version metadata and documentation on top of it.

The unattended Windows installer acceptance was re-run against the **published
0.8.1 assets** on 2026-10-27, with the scope limits below. The 0.8.0-era
evidence under candidate build `707e865` stands as recorded there.

- [Run 40561094786](https://github.com/nwilliams22/prexu/actions/runs/40561094786)
  **passed** both the NSIS and the MSI installers. Scope: the release asset
  bytes matched the GitHub release API digests, install succeeded, a real login
  screen appeared, an upgrade from 0.7.1 retained preferences, and uninstall
  left nothing behind. It proves **installation and launch** only — it is not
  evidence of a frame on screen.
- [Run 40561120923](https://github.com/nwilliams22/prexu/actions/runs/40561120923)
  **failed** both installers under fault injection. This is the correct result
  for a negative control: it proves the harness notices a missing runtime DLL,
  and it throws at the static runtime-DLL presence check **before** install and
  launch, so it is not evidence that a failing launch would be caught.

Read the full scope discussion in [docs/windows-candidate.md](docs/windows-candidate.md).

### Known untested on Windows

Carried forward from 0.8.0 and still true here. A hosted GitHub runner has no
graphics card and no audio device, so the checks below were not performed for
0.8.1 either. The repository owner reviewed this and chose to ship with the
limitation recorded (decisions 2026-09-28 and 2026-10-27).

- **Visible video output.** Native playback frames reaching the screen through
  libmpv → ANGLE/D3D11 → DirectComposition are unverified on real hardware. This
  is the code most affected by the Tauri 2.11.5 upgrade and the re-vendored
  composition-hosting fork on Wry 0.55.1 that ship in this release.
- **Audible playback**, including multichannel → stereo downmix behavior
  (`prexu-wiyy`).
- **Window, DPI and fullscreen transitions** at real display scale: resize,
  minimize/restore, mini-player, popout, fullscreen (`prexu-6p8k`).
- **Authenticated-media and multi-client journeys.** The acceptance run only
  reached the unauthenticated login screen; no library playback or Watch Together
  session was exercised (`prexu-vbb2.6`).
- **The signed update path.** The release workflow signs with the production key
  and the update manifest is checked by hand, but no signed end-to-end update
  from 0.7.1 to 0.8.1 has been applied on a real machine (`prexu-0qqd`).

Do not read a shipped 0.8.x release as evidence that any of the above works.

### Linux bundles are broken

Both Linux assets were inspected after publication. They are left available on
purpose, with the faults stated here rather than hidden behind a softer word.

- **The AppImage can never start the native player, on any machine.** The
  bundle ships `usr/lib/libmpv.so.1` — mpv client API 1.x — inside itself,
  while the application is built against API 2.x, which refuses a 1.x handle.
  Because the wrong library travels inside the AppImage, a correct `libmpv.so.2`
  already installed on your machine is never used. The app then falls back to
  HTML5 playback without saying so — you will see video and will not be told
  that the native player failed. Native libmpv playback, the headline Linux
  feature of 0.8.x, is absent from this file.
- **The rpm installs cleanly and then launches nothing on a current Fedora.**
  It declares no libmpv dependency, and no OpenSSL 3 (`libssl.so.3` /
  `libcrypto.so.3`) either, although the binary requires all three libraries.
  On a distribution that ships only `libmpv.so.2` — current Fedora, for
  example — the application does not launch at all.
- **No Linux artifact from this release has been installed or launched**
  successfully (`prexu-axj4.7`). A repair — building against libmpv API 2.x
  and declaring the real runtime dependencies — is in progress and will be
  verified against the built artifacts before any further release. Until then,
  Linux users should build from source: prerequisites are in
  [docs/linux-dev.md](docs/linux-dev.md).

Cause: the Linux leg of the release build ran on Ubuntu 22.04, whose
`libmpv-dev` is API 1.x.

Use the Windows installers if you want the supported path.

## [0.8.0] - 2026-09-28

**Tagged at `39ce2a7` on 2026-09-28 and never published.** The release was held as
a draft so the offline-login fix could ride in the first build a user could
install; GitHub does not serve a draft, so no user ever received 0.8.0. The draft
was removed on 2026-10-27 and the annotated tag is kept for provenance. Everything
below ships in 0.8.1.

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

[Unreleased]: https://github.com/nwilliams22/prexu/compare/v0.8.2...HEAD
[0.8.2]: https://github.com/nwilliams22/prexu/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/nwilliams22/prexu/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/nwilliams22/prexu/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/nwilliams22/prexu/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/nwilliams22/prexu/compare/v0.6.3...v0.7.0
