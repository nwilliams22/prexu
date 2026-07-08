# Spike prexu-ia6w.2 — mpv render-API video under a transparent WKWebView (macOS)

**Verdict: GO.** mpv's render API (libmpv/render.h, OpenGL backend) composites
decoded video frames UNDERNEATH a transparent `WKWebView` inside ONE `NSWindow`
on Apple Silicon — proven on hardware, playing a real HEVC 10-bit sample, with
VideoToolbox hardware decode confirmed in the mpv log. No child OS window, no
`--wid`. This is the macOS analog of the Linux `GtkOverlay` finding in
`spike/wayland-render-compositing/FINDINGS.md` (prexu-axj4.1): the two sibling
`NSView`s are composited by AppKit's layer-backed `contentView` into the
window's single surface, exactly as GTK composites `GtkOverlay` children into
one `wl_surface`.

Verified box: macOS 26.5.2 (build 25F84), Apple **M3 Pro**, mpv v0.41.0 /
libmpv (pkg-config) 2.5.0 (Homebrew), FFmpeg 8.1.2, libplacebo v7.360.1, Rust
1.96.1. Source: `spike/macos-render-compositing/evidence/environment.txt`.

The user visually confirmed correct composited video (color-bar test pattern
+ alpha-blended HTML overlay: title bar, centered badge, scrubber, play
button) on screen during the live run.

## What was proven

- `mpv_render_context_render()` (OpenGL API type) draws into an
  `NSOpenGLView`'s default framebuffer (FBO 0), and a sibling `WKWebView`
  with `drawsBackground = NO` stacked above it in the same `contentView`
  composites with true alpha over the live video — no separate window, no
  private embedding API (`main.rs:1-20` module doc; view hierarchy built at
  `main.rs:310-384`).
- Real hardware decode: VideoToolbox hevc-videotoolbox path selected and used
  for a 1920x1080 **10-bit** (`p010`/`yuv420p10le`) sample (see hwdec verdict
  below), not software fallback.
- HiDPI backing-pixel rendering: the render loop reads `convertRectToBacking`
  each frame and only calls `[gl_ctx update]` on a resolution change
  (`main.rs:585-597`) — window is 1280x720 points, backing surface came out
  2560x1440 px (2x Retina scale on the M3 Pro build display).
- Sustained frame pump: 457 render callbacks over 8.0s run window = **57.1
  fps**, driven off a ~60 Hz `CFRunLoopTimer` on the main thread
  (`main.rs:449-468`, log line below).
- Clean, deterministic teardown (render context freed before the GL context,
  explicit mpv `quit`, window close, then unwinding `[NSApp run]`) with no
  crash and an observed `MPV_EVENT_SHUTDOWN` (`run.log:157-168`).
- Two composited screenshots captured directly from the live window via
  `CGWindowListCreateImage` (100.0% non-black pixels, 2560x1504 px) — see
  Evidence below.

## Architecture actually built

```
NSWindow
  └─ contentView (setWantsLayer: true)
       ├─ (base)    NSOpenGLView   ← mpv_render_context_render() draws here (FBO 0)
       └─ (overlay) WKWebView (drawsBackground = NO) ← HTML overlay, added AFTER
                                                         the GL view so it stacks on top
```
(`main.rs:1-11` doc comment; `addSubview:` calls at `main.rs:354` and
`main.rs:379` — WKWebView added second, so it renders above per AppKit
subview ordering.)

Key implementation details, with line references into `src/main.rs`:

- **GL context type**: `NSOpenGLContext` from an `NSOpenGLView`, not a CAOpenGLLayer
  or Metal-backed CALayer. Pixel format requests GL 3.2 core profile,
  double-buffered, accelerated, 24-bit color + 8-bit alpha
  (`main.rs:317-352`, `NSOPENGL_PROFILE_VERSION_3_2_CORE` etc.). mpv itself
  reported `GL_VERSION='4.1 Metal - 90.5'` — Apple's OpenGL-on-Metal
  translation layer, not a raw legacy GL driver.
- **`get_proc_address` source**: `dlopen()` of
  `/System/Library/Frameworks/OpenGL.framework/OpenGL`, then `dlsym()` per
  symbol name (`main.rs:166-181`, `main.rs:230-238`). No EGL/GLX — macOS
  exports core GL symbols directly from the framework, so this is simpler
  than the Linux spike's `eglGetProcAddress` path.
- **Frame-driving mechanism**: a `CFRunLoopTimerCreate` at `1.0/60.0` s
  interval added to `CFRunLoopGetMain()` in `kCFRunLoopCommonModes`
  (`main.rs:449-468`), calling `pump_cb` every tick. The mpv render-context
  update callback (`main.rs:417-423`) only flips an `AtomicBool`
  (`needs_render`); the code explicitly does **not** rely on it alone to
  decide whether to render — `pump_cb` renders on every tick regardless
  (`main.rs:490-494`, comment: "mirrors the Linux finding that the update
  callback alone does not reliably pump"). This is the same gotcha the
  Wayland spike hit (item 3 in its Gotchas list).
- **Threading**: rendering and all AppKit/GL calls happen on the main thread
  inside the `CFRunLoopTimer` callback — the sole place the `NSOpenGLContext`
  is made current (`main.rs:582-584`). mpv's own event/log-message pump runs
  on a **separate** dedicated thread (`spawn_event_thread`, `main.rs:745-777`)
  that only calls `mpv_wait_event`/logs — it never touches AppKit objects.
  The `Spike` struct's doc comment (`main.rs:189-191`) is explicit that
  `needs_render` is the only field touched cross-thread.
- **HiDPI**: `render_one` reads `[gl_view bounds]` then
  `convertRectToBacking:` every frame to get physical pixel dimensions, and
  only calls `[gl_ctx update]` when the backing size actually changes
  (`main.rs:585-597`), logged as `backing size now 2560x1440 px (GL context
  updated)` (`run.log:72`).
- **Teardown order** (`main.rs:506-554`, executed at `run.log:157-168`):
  1. Free the mpv render context **while the GL context is still current/valid**
     (`main.rs:517-522`) — mirrors the mission rule and the Linux GLArea
     `unrealize` pattern.
  2. Explicitly send mpv `quit` via `mpv_command_string` (`main.rs:530-533`)
     — see the audio-lingering section below for why this step is load-bearing.
  3. Close the `NSWindow` (releases the `NSOpenGLContext`/GL surface).
  4. `[NSApp stop:]` **plus** a posted dummy `NSEvent` to unwind `[NSApp run]`
     — the code notes `CFRunLoopStop` alone does *not* make `[NSApp run]`
     return; AppKit's run loop ignores it (`main.rs:541-545`,
     `post_wakeup_event`, `main.rs:559-575`).
- **Transparency method**: KVC `setValue:forKey:"drawsBackground"` set to
  `NSNumber(bool: false)` on the `WKWebView` instance, combined with a
  transparent `<body>` background in the loaded HTML (`main.rs:368-381`,
  `OVERLAY_HTML` at `main.rs:780-811`). Comment notes there is no public
  `setOpaque` on `WKWebView`; this private-ish KVC key is "the
  documented-by-community route" (`main.rs:368-370`).
- **Locale**: `setlocale(LC_NUMERIC, "C")` called before `Mpv::with_initializer`
  (`main.rs:249-250`), same libmpv hard requirement the Linux spike documented.

## Evidence

- `evidence/composited-hevc10-under-webview-macos.png` (2560x1504, captured
  at ~3s elapsed) and `evidence/composited-hevc10-under-webview-macos-late.png`
  (same resolution, captured at ~60% of the run) — both show a SMPTE-style
  color-bar HEVC 10-bit test pattern (with a moving crosshair/scope and a
  moving diagonal gradient line, confirming live playback, not a static
  frame) rendered by mpv, with the transparent WKWebView HTML overlay
  (`PREXU — WKWebView overlay (transparent, drawsBackground=NO)` title bar,
  a centered `↑ WKWebView (alpha) · mpv video below ↓` badge with
  translucent background and backdrop blur, and a bottom scrubber/play-button
  control bar) composited on top with visible alpha — the video colors show
  through the badge and control-bar gradients, and the window titlebar/traffic
  lights are native AppKit chrome, confirming a single real `NSWindow`. Both
  captures log `100.0% non-black pixels` (`run.log:151`, `run.log:154`),
  i.e. not a blank/permission-denied capture.
- Captured via `CGWindowListCreateImage` of the app's own `windowNumber`
  (`main.rs:627-671`), with a `screencapture -l` fallback that was not needed
  this run.

## hwdec verdict: VideoToolbox, confirmed

Raw mpv log lines (via `mpv_request_log_messages(... , "v")`, tagged
`[mpv/HWDEC]` by the spike's own filter at `main.rs:760-764`):

```
[mpv/HWDEC] libmpv_render v: Loading hwdec driver 'videotoolbox'
[mpv/HWDEC] vd v: Looking at hwdec hevc-videotoolbox...
[mpv/HWDEC] vd v: Trying hardware decoding via hevc-videotoolbox.
[mpv/HWDEC] vd v: Pixel formats supported by decoder: videotoolbox_vld yuv420p10le
[mpv/HWDEC] vd v: Requesting pixfmt 'videotoolbox_vld' from decoder.
[mpv/HWDEC] vd info: Using hardware decoding (videotoolbox).
[mpv/HWDEC] vd v: Decoder format: 1920x1080 videotoolbox[p010] auto/auto/auto/limited/auto CL=mpeg2/4/h264 crop=1920x1080+0+0 A=none
[mpv/HWDEC] cplayer info: VO: [libmpv] 1920x1080 videotoolbox[p010]
```
(`run.log:15,48-49,69,71,83-84,126`; corroborated by the standalone
`evidence/mpv-hwdec-gl-excerpt.txt`.)

`vd v: Codec profile: Main 10 (0x2)` (`run.log:70`) plus the `p010` decoder
output format confirm this was genuinely the **10-bit** HEVC path, not an
8-bit fallback — matching the source sample's `pix_fmt=yuv420p10le`
(`evidence/environment.txt:29`). `hwdec=auto-safe` was set pre-init
(`main.rs:257`), and mpv resolved it to VideoToolbox automatically; no
manual `hwdec=videotoolbox` override was needed.

One transient, non-fatal warning during the reconfig from the initial 1x1
placeholder surface to the real 1920x1080 stream: `libmpv_render error:
after creating texture: OpenGL error INVALID_FRAMEBUFFER_OPERATION.`
(`run.log:136`), immediately followed by `Using FBO format rgba16f.` and
`first video frame after restart shown` (`run.log:137-138`). Playback and
capture succeeded afterward (100% non-black captures), so this did not block
the PoC, but it should be watched for in ia6w.5 during the initial
reconfig/resize path.

## Audio-lingering observation

During the run the user heard audio continue after the video portion looked
done. `main.rs:524-533` contains the previous agent's explicit engineering
note on this, written as the rationale for teardown step 2/4:

> `// (2) Explicitly tell mpv to QUIT. CRITICAL: closing the video window /`
> `//     freeing the render context does NOT stop mpv playback — mpv keeps`
> `//     decoding and HOLDS the CoreAudio output device (+ a power assertion)`
> `//     until the mpv core itself is stopped. Without this, audio plays on`
> `//     forever (worse here with loop-file=inf). Production teardown MUST`
> `//     command mpv quit/stop, not just tear down the GL/view layer.`

This is the explanation found in the source: freeing the render context or
closing the `NSWindow` alone does not stop mpv's internal decode/playback
loop or release the CoreAudio output device — only an explicit mpv `quit`
command does (`main.rs:530-533`, executed via `mpv_command_string(ctx,
"quit")`). The committed `run.log` for this run already includes that
explicit `quit` call (`run.log:161`, immediately followed by `EOF code: 5` /
`finished playback, success` at `run.log:163-164`), so the *final* run's log
does not itself show audio lingering — it shows the fix already in place.

**Open question for ia6w.5**: the log has no distinct "CoreAudio device
released" line separate from the `quit` command being issued, so there is no
direct log-timestamp proof of exactly when the audio device is released
relative to `quit`, nor confirmation that `quit` releases it synchronously.
Given `loop-file=inf` was set for this spike (`main.rs:259`), it's also
plausible the lingering audio the user heard was simply the looped media
continuing to play *before* any teardown was triggered, rather than a
teardown-ordering bug per se — the log alone can't disambiguate these two
causes. Production teardown in `macos_compositor.rs` should (a) always issue
an explicit mpv `stop`/`quit` before or as part of teardown (not just tearing
down GL/view state), and (b) add explicit logging around the CoreAudio
device release (or poll `core-idle`/`ao-*` properties) so this is directly
observable in production logs, per this project's logging conventions.

## wry-transparency finding for ia6w.4

`main.rs:368-381` achieves WKWebView transparency by raw `msg_send!` KVC:
`setValue:forKey:@"drawsBackground"` set to `false` on the `WKWebView`
instance, plus a transparent HTML `<body>`.

Checking the vendored wry fork (`src-tauri/vendor/wry`, wry 0.54.2) shows
**stock wry already implements the identical technique** for macOS, gated
behind the `transparent` feature — this is not something the project's fork
added:

- `src-tauri/vendor/wry/src/wkwebview/mod.rs:353-369` (webview creation):
  `#[cfg(feature = "transparent")] if attributes.transparent || ...` sets
  `NSNumber(false)` via `setValue_forKey(..., ns_string!("drawsBackground"))`
  on the `WKWebViewConfiguration`, on macOS 10.14+, exactly mirroring the
  spike's runtime KVC call.
- `src-tauri/vendor/wry/src/wkwebview/mod.rs:936-945` (runtime background
  color update) re-applies the same `drawsBackground` KVC key on the live
  `webview` instance for dynamic changes, plus `setUnderPageBackgroundColor`
  (macOS 12+, public API) for the overscroll-area color.

`src-tauri/Cargo.toml`'s own comments corroborate this: the documented
reasons for vendoring/forking wry are **Windows** (`set_pending_composition_hosting`
for a WebView2 DirectComposition visual, Cargo.toml:86-92,118-124) and
**Linux** (`set_pending_webview_transparency`, Cargo.toml:112-116) — no
macOS-specific fork addition is mentioned or found. This strongly suggests
**stock wry 0.54 (crates.io, `features = ["transparent"]`, `WindowBuilder::transparent(true)` /
equivalent `WebViewBuilder` attribute) can already do WKWebView transparency
on macOS without the vendored fork** — ia6w.4's Tauri integration likely
only needs to turn the `transparent` attribute on for the webview (same as
Linux) and does not need a new macOS-specific patch to the fork, unlike the
Windows and Linux paths which did require one. This should be verified
directly against the running Tauri app in ia6w.4 rather than assumed, since
the spike used a bare `WKWebViewConfiguration`/`WKWebView`, not wry's actual
`WebViewBuilder` call path.

## objc2 vs cocoa crate choice

The spike uses **`objc2` core only** (`objc2 = "0.6"` in
`spike/macos-render-compositing/Cargo.toml:38`) — `msg_send!`/`class!` against
runtime-looked-up AppKit/WebKit classes — and deliberately bypasses the typed
`objc2-app-kit` / `objc2-web-kit` wrapper crates, per the Cargo.toml comment:
`"We deliberately bypass the typed objc2-app-kit / objc2-web-kit wrappers for
this throwaway (see FINDINGS.md 'objc2 vs cocoa')."`

Friction this produced, visible directly in `main.rs`:

- All AppKit/WebKit constants had to be hand-declared as raw `u64`/`u32`
  values (`NS_WINDOW_STYLE_TITLED`, `NSOPENGL_PFA_*`,
  `NS_APP_ACTIVATION_POLICY_REGULAR`, etc., `main.rs:82-99`) instead of using
  typed enums a wrapper crate would provide.
- `CGPoint`/`CGSize`/`CGRect` had to be hand-defined as `#[repr(C)]` structs
  with manual `unsafe impl Encode` blocks (`main.rs:34-79`) so objc2's
  `msg_send!` knows their Objective-C type encoding — a typed wrapper crate
  normally supplies this.
- Every AppKit/WebKit call site is an untyped `msg_send![obj, selector: args]`
  returning `*mut AnyObject` or raw scalars, with no compile-time checking of
  selector names or argument/return types (e.g. `main.rs:294-304`,
  `main.rs:359-380`) — errors like a wrong selector name only surface at
  runtime.
- `objc2` core *did* still require CoreFoundation run-loop and CoreGraphics
  window-capture functions to be declared as raw `extern "C"` FFI
  (`main.rs:117-136`, `main.rs:145-161`) since those aren't Objective-C
  messages at all.

For production `ia6w.5`, using the typed `objc2-app-kit`/`objc2-web-kit`
crates (already implicitly pulled in via wry's own dependency on them, per
`src-tauri/vendor/wry/src/wkwebview/mod.rs`'s use of
`objc2_app_kit::NSColor`/`objc2_ui_kit::UIColor`) would remove most of this
hand-rolled boilerplate and add compile-time safety — worth doing for the
real compositor rather than reusing the spike's raw `msg_send!` style
wholesale.

## What this means for ia6w.5 (production `macos_compositor.rs`)

Invariants extracted from the working code:

1. **View hierarchy**: base `NSOpenGLView`/GL surface added first, webview
   subview added second (later `addSubview:` = higher z-order) inside a
   `setWantsLayer: true` `contentView` — no child window, no private
   embedding API needed (`main.rs:310-384`).
2. **Threading**: all GL calls and `mpv_render_context_render()` must happen
   on the thread that owns the `NSOpenGLContext` — in this PoC, the main
   thread, driven by a `CFRunLoopTimer` on `CFRunLoopGetMain()`. mpv's
   event/log pump must live on its own thread and must never touch AppKit
   objects. The render-context update callback fires on an mpv-internal
   thread and must only flag work (e.g. an `AtomicBool`), not touch GL/AppKit
   directly (`main.rs:417-423`, `main.rs:745-777`).
3. **Frame pump**: do not rely solely on mpv's render-context update callback
   to decide whether to render; drive a steady ~60 Hz timer and render every
   tick regardless of the callback flag (`main.rs:490-494`) — this mirrors
   the Linux GLArea finding and should be treated as a cross-platform
   invariant, not a macOS quirk.
4. **HiDPI**: recompute physical pixel size via
   `convertRectToBacking:[view bounds]` every frame; only call `[glContext
   update]` when the backing size actually changes (`main.rs:585-597`).
5. **Teardown order is load-bearing** and must be, in this order: (a) make
   the GL context current and free the mpv render context while it is still
   valid; (b) explicitly command mpv `quit`/`stop` — closing the window or
   freeing the render context alone does **not** stop decoding or release
   the CoreAudio device (see audio-lingering section); (c) close the
   `NSWindow`; (d) `[NSApp stop:]` plus a posted wakeup `NSEvent` to actually
   unwind `[NSApp run]` (`CFRunLoopStop` alone does not do it) —
   `main.rs:506-554`.
6. **Locale**: `setlocale(LC_NUMERIC, "C")` before `mpv_create`
   (`main.rs:249-250`), same as every other platform spike in this epic.
7. **GL proc-address resolution**: `dlopen`+`dlsym` against
   `/System/Library/Frameworks/OpenGL.framework/OpenGL` is sufficient on
   macOS — no EGL/GLX/WGL layer needed (`main.rs:166-181`, `230-238`).
8. **Transparency**: reuse wry's existing `drawsBackground` KVC mechanism
   (already stock in the vendored fork, see wry-transparency finding above)
   rather than re-implementing the spike's raw KVC call — ia6w.4 should only
   need to enable the `transparent` webview attribute, not patch wry further,
   pending direct verification against the real `WebViewBuilder` path.
9. **hwdec**: `hwdec=auto-safe` is sufficient to get VideoToolbox
   hardware-accelerated HEVC 10-bit decode automatically; no manual hwdec
   override needed (see hwdec verdict above).

## Open questions

- **Audio-device release timing**: no log line directly proves when/whether
  mpv `quit` synchronously releases the CoreAudio device vs. the observed
  lingering audio being caused by `loop-file=inf` continuing playback before
  teardown was triggered. Needs explicit logging around this in ia6w.5 (see
  audio-lingering section).
- **wry `WebViewBuilder` transparency path on macOS**: confirmed only that
  stock wry's internal `WKWebView` creation code has the `drawsBackground`
  mechanism gated behind the `transparent` feature/attribute; not verified
  end-to-end against a real Tauri `WebViewBuilder::new().transparent(true)`
  call composited over an `NSOpenGLView` sibling in this repo's actual Tauri
  window — that integration test belongs to ia6w.4.
- **`INVALID_FRAMEBUFFER_OPERATION` warning during reconfig**
  (`run.log:136`): transient and non-blocking in this run, but not
  root-caused; worth a closer look if it recurs or worsens under real
  window-resize conditions in ia6w.5.
- **Non-Apple-Silicon / Intel Mac**: this PoC only ran on Apple Silicon (M3
  Pro) with `hwdec=auto-safe` resolving to VideoToolbox; Intel Mac / eGPU /
  non-Metal-backed OpenGL behavior is untested and out of scope here.
- **Typed `objc2-app-kit`/`objc2-web-kit` migration**: the spike intentionally
  used raw `objc2` core `msg_send!` calls for speed; ia6w.5 should decide
  whether to port to the typed wrapper crates (recommended, see objc2 vs
  cocoa section) rather than carry the raw-selector style into production.

## Files

- `src/main.rs` — the PoC (AppKit `NSOpenGLView` + `WKWebView` overlay + mpv
  render-API FFI via `objc2` core). Throwaway; `DO NOT SHIP` per its own
  header comment.
- `build.rs` — links Homebrew system libmpv (2.5.0) and the AppKit/WebKit/GL
  frameworks used via raw FFI.
- `evidence/` — `run.log`, `mpv-hwdec-gl-excerpt.txt`, `environment.txt`, and
  the two composited screenshots referenced above.
