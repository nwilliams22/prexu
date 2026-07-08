# ADR: Native (libmpv) player on macOS via the mpv render API

## Status

**Accepted (macOS)** — ratified by the maintainer 2026-07-07 (default engine:
HTML5 with native opt-in; sequencing: prexu-ttz9 lands first). Supersedes the **macOS DEFER** in
`docs/adr-native-player-cross-platform.md`: all three of its blockers are
resolved — (a) Apple-Silicon hardware is available and both spikes ran on it;
(b) CI cost is contained by gating distribution (prexu-ia6w.9, aarch64-only);
(c) WebKit codec coverage is now **measured**, not assumed (prexu-ia6w.1).

- **macOS:** native libmpv via the **render API**, as an **opt-in engine**
  behind the existing Settings toggle, with **HTML5 `<video>` as the default**.
  (this ADR)
- **Linux:** unchanged — native render-API player, default engine
  (`docs/adr-native-player-render-api.md`).
- **Windows:** unchanged — render-API over ANGLE/DirectComposition.

Tracked as beads epic `prexu-ia6w`. Evidence: spikes `prexu-ia6w.1`
(`spike/macos-webkit-codec-gap/FINDINGS.md`) and `prexu-ia6w.2`
(`spike/macos-render-compositing/FINDINGS.md` + `evidence/`).

## Context

The native player exists because of platform codec gaps: Windows WebView2
cannot real-time-decode HEVC Main 10; Linux WebKitGTK direct-plays only
H.264+AAC-stereo (~17% of the movie library forced video transcodes,
~170 titles audio transcodes — prexu-duna.3).

**macOS is different.** Spike prexu-ia6w.1 measured the real WKWebView
capability on Apple Silicon (M3 Pro, macOS 26.5.2, WebKit 21624.2.5.11.8) via
probes *and* actual playback:

| Codec | WKWebView verdict |
|---|---|
| H.264, HEVC 8-bit, HEVC 10-bit (Main 10) | Decodes (real playback confirmed) |
| AV1 | Decodes on M3+ (hardware-gated; untested on M1/M2) |
| AAC, AC3, E-AC3 | Decodes |
| TrueHD, DTS / DTS-HD MA | **Does not decode** (all containers) |

Re-applying the duna.3 library distribution: the macOS HTML5 engine is
*capable* of direct-playing **100% of the video gap** (562/3240 HEVC/AV1
titles) and all but **28 audio titles** (TrueHD 10 + DTS 18, ~0.9%).

None of that capability is exploited today: `canDirectPlay()` in
`src/services/plex-playback.ts` is a platform-blind H.264-only allow-list.
That fix is **prexu-ttz9** (platform-aware codec gate) — pure HTML5-engine
work, independent of this ADR, and it captures ~95% of the user-visible win.

Meanwhile spike prexu-ia6w.2 proved the native architecture ports cleanly:
mpv render-API (OpenGL) frames composited **under** a transparent WKWebView
in one NSWindow at 57 fps, with confirmed VideoToolbox hardware decode of
HEVC Main 10 (`videotoolbox[p010]`), clean teardown, and no fork changes
needed for webview transparency (stock wry 0.54 supports it on macOS).

## Decision

1. **Build the macOS native player** (proceed with the gated epic tasks
   ia6w.4–.8, .10): the compositing spike is a GO, the code is a third
   backend beside `linux_compositor.rs` / `composition_host.rs`, and it
   completes cross-platform engine convergence.
2. **HTML5 stays the default engine on macOS.** With prexu-ttz9 landed, the
   HTML5 engine direct-plays ~99% of the library on this platform. The native
   engine is exposed through the existing Settings `playerEngine` toggle
   (`native` opt-in; `auto` resolves to HTML5 on macOS for now). This inverts
   the Linux default because the platform data inverts: on Linux HTML5 covers
   almost nothing; on macOS it covers almost everything.
3. **What native buys on macOS** (why build it at all): TrueHD/DTS(-HD MA)
   direct-play (the 28 uncodable titles), zero-transcode consistency across
   platforms, libass subtitle parity with Windows/Linux, and one converged
   render-API architecture to maintain.
4. **Revisit the default** if: the ttz9 gate proves unreliable against real
   Plex behavior; AV1 on M1/M2 (software decode) turns out to matter; or user
   demand for TrueHD/DTS grows. Flipping the default is a one-line
   `resolveEngineChoice` change once the native engine has soak time.

### Architecture (proven in spike/macos-render-compositing/)

```
NSWindow                                (Tauri/tao toplevel)
  └─ contentView
       ├─ (base)    GL-backed NSView    ← mpv_render_context_render() target
       └─ (overlay) WKWebView           ← wry's webview, transparent
```

- **Render:** `MPV_RENDER_API_TYPE_OPENGL` into an `NSOpenGLContext`-backed
  view (OpenGL is deprecated on macOS but fully functional on Apple Silicon;
  mpv has no Metal render backend). GL proc addresses via
  `dlopen("/System/Library/Frameworks/OpenGL.framework/...")` + `dlsym` — no
  EGL/GLX.
- **Frame pump:** ~60 Hz main-thread tick driving redraw + mpv update
  callback setting an atomic (callback alone does not reliably pump — same
  invariant as Linux). Measured 57.1 fps in the PoC.
- **Threading:** all AppKit/GL on the main thread; mpv event pump on its own
  thread; update callback only sets a flag. `setlocale(LC_NUMERIC, "C")`
  before `mpv_create`.
- **HiDPI/resize:** `convertRectToBacking` each frame (physical-pixel FBO) —
  no geometry-sync plumbing, same as Linux.
- **Teardown (load-bearing order):** free render context while the GL context
  is valid → explicit mpv `quit` → close window → stop the app run loop.
  **Window close alone does not stop decode or release the CoreAudio
  device** — observed live during the spike (audio continued after video).
  Production (`ia6w.5`) must log CoreAudio release explicitly.
- **Bindings:** the spike used raw `objc2`; production should use typed
  `objc2-app-kit`/`objc2-web-kit` wrappers.
- **Transparency:** stock wry 0.54 `transparent` attribute suffices on macOS
  (`vendor/wry/src/wkwebview/mod.rs:353-369`) — the vendored fork needs **no
  macOS-specific change** (fork exists for Windows composition-hosting and
  Linux transparency only). ia6w.4 verifies in-app.

### Engine selection (ia6w.4/.6)

`IS_NATIVE_PLAYER_PLATFORM` extends to macOS; `resolveEngineChoice` maps
`auto → html5` on macOS (the inversion point vs Linux); `native` pref opts
in. Fallback triggers unchanged: dylib absent, render-init failure
(`engine_failure_reason` → `player://engine-failed`), user toggle.

### Distribution (ia6w.9 — gated, unchanged by this ADR)

Dev builds link Homebrew libmpv (`PKG_CONFIG_PATH=/opt/homebrew/lib/pkgconfig`,
libmpv 2.5.0 verified). Release: LGPL-clean bundled `libmpv.dylib` with
`@rpath` fixup, codesign + notarize, aarch64-only CI leg. Remains gated on a
proven player; nothing in this ADR front-loads it.

## Consequences

**Easier than feared:** no wry fork changes; no geometry-sync; the frontend
contract needs only the UA/capability extension; minimize likely ports
near-verbatim (mpv `video-margin-ratio-*`).

**New surface:** a third platform compositor (deprecated-but-functional
OpenGL — if Apple ever removes it, the fallback is a Metal texture bridge or
IOSurface interop, a contained rewrite of the view layer, not the player);
AV1 on M1/M2 unverified; TrueHD/DTS remain transcodes until users opt into
native.

**Sequencing note:** prexu-ttz9 (codec gate) is the higher-value, lower-cost
item and should land **before or alongside** ia6w.4 — it improves the default
engine every macOS user gets, whether or not they ever enable native.

## Open questions (carried into gated tasks)

- In-app transparency + engine wiring under real Tauri (ia6w.4).
- CoreAudio release logging + audio-teardown proof (ia6w.5).
- Popout on macOS: second window + render context vs capability-gate
  (ia6w.7 decides, mirroring axj4.10).
- AV1 behavior on M1/M2 hardware (ia6w.8 notes; no such hardware here).

## Sources

- `spike/macos-webkit-codec-gap/FINDINGS.md` (+ `probe-results.json`).
- `spike/macos-render-compositing/FINDINGS.md` (+ `evidence/`).
- `docs/adr-native-player-render-api.md` (Linux architecture mirrored).
- `docs/adr-native-player-cross-platform.md` (macOS DEFER superseded).
- prexu-duna.3 library-impact distribution (beads notes).
