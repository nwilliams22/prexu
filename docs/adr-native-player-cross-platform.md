# ADR: Native (libmpv) player — cross-platform extension to macOS + Linux

## Status

Proposed (recommendation only — the maintainer makes the final call).

Decision per platform:
- **macOS:** Defer.
- **Linux:** No-go for the current architecture; defer any native player.
- **Windows:** Unchanged — remains the sole supported native-player target.

Tracked as beads epic `prexu-efy` (Phase 5). Companion status:
`docs/native-player-status.md` (Phase 5 findings section).

## Context

Prexu ships a native libmpv-backed video player on Windows (Phases 0–4).
It exists because WebView2/Chromium on Windows cannot real-time-decode HEVC
Main 10 without a paid Store codec, so HEVC-10bit Plex sources Direct Play
into MSE at ~0.5 fps. The native player swaps the HTML `<video>` + hls.js
engine for libmpv.

The shipped Windows architecture (`src-tauri/src/player/`):

- A **sibling top-level native window** (`host_window.rs`, `WS_POPUP +
  WS_EX_NOACTIVATE`) is created via `CreateWindowExW`. Its `HWND` is handed
  to mpv as the **`wid`** property *before* `mpv_initialize`. mpv creates
  its own child window inside that HWND and renders with `vo=gpu-next`,
  `hwdec=auto-safe`.
- The Tauri main window is `transparent: true`; the WebView (all React UI +
  overlays) is composited **on top** of the video, z-order-anchored so the
  host sits directly behind it.
- Geometry is **manually synchronised**: every `WindowEvent::Resized /
  Moved / ScaleFactorChanged` recomputes the host rect and calls
  `SetWindowPos`, with throttling, fullscreen-transition suppression, DPI
  scaling, and pop-out/minimize insets layered on (`mod.rs`).

This is fundamentally a **foreign-window-embedding** design. The
cross-platform question is therefore: *(a)* can mpv embed into a foreign
window handle on macOS and Linux, and *(b)* can Tauri v2 hand us that
handle? Secondary questions: hardware decode, library distribution +
licensing, and CI cost.

Verified environment: `tauri 2.10.2`, `wry 0.54.2`, `libmpv2` crate v4,
`windows` crate `0.61` (`src-tauri/Cargo.toml` / `Cargo.lock`). No macOS or
Linux hardware was available during this research; all platform-behaviour
claims below are from documentation/issue trackers and are marked where
they **need verification** on real hardware.

### Cross-cutting finding: `wid` embedding is platform-limited

Per the mpv project's libmpv guidance, mpv's `--wid` foreign-window
embedding is supported on **x11, win32, and cocoa (macOS)** and is **not
supported on Wayland**. mpv additionally **recommends the render API**
(`libmpv/render.h` — caller-owned OpenGL/Vulkan/Metal surface) *over* raw
window embedding because of platform-specific problems, called out
specifically for macOS. (Sources at end.)

Consequence: the Windows `wid` design ports **conceptually** to macOS
(NSView) and Linux/**X11**, but is a **dead end on Wayland** (the default
session on current GNOME and KDE). Supporting Wayland requires the
render-API path, which shares little code with what is shipped.

## Options considered

### macOS

| Option | Summary | Risk |
|---|---|---|
| **M1. `wid` / NSView embedding** | Mirror the Windows design: host an `NSView` (or sibling `NSWindow`), hand its pointer to mpv as `wid`, composite the transparent WebView over it. | Closest to existing code. Layer-backed-view compositing + transparent-window focus glitches (Tauri #8255) *need verification*. |
| **M2. Render API (Metal/OpenGL)** | mpv renders into a caller-owned context; app drives frame callbacks + input simulation. mpv-recommended. | Materially different integration; no `host_window.rs` reuse; more code. Most robust per mpv docs. |
| **M3. No native player on macOS** | Keep WebView `<video>`. | Viable *iff* WebKit on macOS decodes the problem codecs (VideoToolbox-backed) — *needs verification*. |

Handle access: Tauri v2 exposes `WebviewWindow::ns_window()` and
`with_webview()` → `PlatformWebview` (macOS `ns_window()`/`inner()`); the
`NSView` derives from the window `contentView`. `HasWindowHandle` is also
implemented. HW decode: mpv supports **VideoToolbox** on Apple platforms
(*needs verification on Apple Silicon*).

### Linux

| Option | Summary | Risk |
|---|---|---|
| **L1. `wid` embedding, X11 only** | Mirror the Windows design on X11 via `gtk_window()` / `default_vbox()`. | Strands **Wayland** users (modern default). mpv notes X11 focus-policy mismatch with toolkits. |
| **L2. Render API (covers X11 + Wayland)** | mpv renders into an FBO/surface the app composites. Only path that works on Wayland. | Largest build; least shared code; webkit2gtk/Mesa/NVIDIA variance. |
| **L3. No native player on Linux** | Keep WebView `<video>`. | Many WebKitGTK builds decode HEVC via system codecs — *needs verification*. |

Handle access: Tauri exposes `gtk_window()` + `default_vbox()` on Linux;
wry's child-webview embedding is documented "**X11 only**." Wayland has no
`wid` embedding in mpv.

### libmpv distribution + licensing (all platforms)

libmpv is **LGPL** (an LGPL-configured build — some prebuilt binaries are
GPL and must be avoided to retain dynamic-linking rights; exact LGPL
version *needs verification* per binary).

- **Windows (today):** ship `libmpv-2.dll` beside the exe (dynamic link) —
  LGPL-clean.
- **macOS:** ship `libmpv.dylib` inside the `.app`, fix install names;
  source via Homebrew or a community Apple build (MPVKit,
  karelrooted/libmpv). Must codesign + notarize the bundled dylib. LGPL
  cleanliness of the chosen build *needs verification*.
- **Linux:** bundle `libmpv.so` in an **AppImage** (portable, large), or
  declare a `.deb` dependency on the distro `libmpv` package (smaller,
  version-fragile). Static linking complicates LGPL compliance (relink
  materials) — prefer **dynamic** everywhere.

### CI cost (GitHub-hosted runners)

- Runner multipliers: **Linux 1×, Windows 2×, macOS 10×** of base
  per-minute cost. Absolute rates *need verification* against GitHub
  billing docs before budgeting (public figures seen in research:
  ~$0.008/min Linux, ~$0.016 Windows, ~$0.08 macOS, with a reduction
  effective 2026-01-01).
- `release.yml` **already declares** macOS (aarch64 + x86_64) and Linux
  matrix legs, but only the **Windows** leg provisions libmpv (download +
  `dumpbin`/`lib` to generate `mpv.lib` + `MPV_SOURCE`). Each new platform
  needs an analogous per-OS libmpv provisioning step, plus macOS
  codesign/notarization of the dylib. macOS (10× + two arch legs) is the
  cost driver; Linux is near-free.

## Decision

**Recommendation (maintainer decides):**

1. **macOS — DEFER.** Technically the most viable port (option M1 mirrors
   the Windows `wid` design; M2 is the mpv-preferred fallback), but blocked
   on: (a) no Apple-Silicon hardware to verify VideoToolbox decode + the
   layer-backed transparent-overlay composition; (b) 10× CI cost plus
   codesign/notarization work; (c) unverified whether macOS WebKit already
   decodes the problem codecs, which could make a native player
   unnecessary (option M3). Revisit when Mac hardware **and** demonstrated
   user demand exist.

2. **Linux — NO-GO for the current architecture; DEFER any native player.**
   The Windows-style `wid` port (L1) works only on X11 and would strand
   Wayland users (the modern default). Full coverage requires the render
   API (L2), a substantially larger build sharing little with the shipped
   code. Linux is the cheapest CI but the highest engineering variance and
   lowest code reuse. Prefer option L3 (keep WebView `<video>`) until/unless
   demand justifies the render-API investment.

3. **Windows — UNCHANGED.** Remains the sole supported native-player
   target; the motivating HEVC-10bit defect is WebView2-specific.

This keeps the native player a **Windows-only** feature for now and avoids
committing to a render-API rewrite or recurring macOS CI cost without
hardware to validate against or evidence of demand.

## Consequences

**Easier / lower risk:**
- No new platform-specific Win32-equivalent geometry-sync, compositing, or
  teardown code to maintain (the Windows path was itself a long bug-hunt —
  see the "hard-won lessons" in `native-player-status.md`).
- CI stays cheap: no 10× macOS legs running libmpv builds on every tag.
- No LGPL dylib/.so bundling, macOS notarization, or Wayland render-API
  surface to support.

**Harder / deferred:**
- macOS and Linux users keep the WebView `<video>` engine and whatever
  codec limits their platform's WebKit/WebKitGTK imposes (*needs
  verification* per platform — may already be a non-issue there).
- Re-opening macOS later means building the NSView/`wid` host **plus**
  validating VideoToolbox + layer compositing on real hardware — work not
  done here for lack of a Mac.
- A future Linux native player almost certainly means the **render API**
  (to cover Wayland), i.e. a second rendering backend distinct from the
  Windows `wid` path — a larger maintenance surface than "port the
  existing code."

**Revisit triggers:**
- Acquisition of Apple-Silicon hardware **and** macOS user demand → revisit
  macOS (option M1 first, M2 if compositing fails).
- mpv lands `--wid` Wayland embedding (issues #1242 / #9654) → re-evaluate
  Linux option L1 as a single-path port.
- Evidence that macOS/Linux WebKit cannot decode the target Plex codecs →
  raises native-player urgency on that platform specifically.

## Sources

- mpv-examples — libmpv embedding vs render API, platform support
  (x11/win32/cocoa for `wid`; render API recommended):
  <https://github.com/mpv-player/mpv-examples/blob/master/libmpv/README.md>
- mpv — Wayland GUI embedding limitation (`--wid` not supported on
  Wayland): <https://github.com/mpv-player/mpv/issues/1242> and
  <https://github.com/mpv-player/mpv/issues/9654>
- mpv — win32 detached-window-with-`wid` quirk:
  <https://github.com/mpv-player/mpv/issues/10189>
- Tauri v2 — `WebviewWindow` native handle accessors (`gtk_window`,
  `default_vbox`, `with_webview`, raw-window-handle traits):
  <https://docs.rs/tauri/2.10.2/tauri/webview/struct.WebviewWindow.html>
- wry — child webview embedding ("X11 only" on Linux), raw window handle:
  <https://github.com/tauri-apps/wry>
- Tauri — macOS transparent-window focus glitch:
  <https://github.com/tauri-apps/tauri/issues/8255>
- mpv — LGPL relicensing / license terms:
  <https://github.com/mpv-player/mpv/issues/2033>,
  <https://github.com/mpv-player/mpv/blob/master/LICENSE.LGPL>
- macOS libmpv build sources: <https://github.com/mpvkit/MPVKit>,
  <https://github.com/karelrooted/libmpv>
- GitHub Actions runner pricing / multipliers (Linux 1× / Win 2× /
  macOS 10×):
  <https://docs.github.com/en/billing/reference/actions-runner-pricing>
- Tauri distribution (AppImage bundles deps; .deb declares deps):
  <https://v2.tauri.app/distribute/appimage/>,
  <https://v2.tauri.app/distribute/debian/>
