# ADR: Native (libmpv) player on Linux via the mpv render API

## Status

**Accepted (Linux).** Supersedes the **Linux** decision in
`docs/adr-native-player-cross-platform.md` ("No-go for the current
architecture; defer any native player"). That NO-GO was scoped to the
Windows-style `--wid` foreign-window-embedding design, which mpv does not
support on Wayland — **not** to a native player on Linux in general. This ADR
records the architecture that does work on Wayland, proven on hardware.

- **Linux:** native libmpv via the **render API**, default engine, with HTML5
  `<video>` fallback. (this ADR)
- **macOS:** still deferred (no Apple-Silicon hardware) — separate later epic.
- **Windows:** unchanged — keeps the shipped `wid`/HWND player; a later epic
  migrates it to this same render-API path so all platforms converge.

Tracked as beads epic `prexu-axj4`. Evidence: spike `prexu-axj4.1`
(`spike/wayland-render-compositing/`, `FINDINGS.md` + `evidence/`). Codec scope:
`prexu-duna.3`. Supersedes-context: the `native-player-cross-platform-direction`
project memory.

## Context

Prexu's HTML5 `<video>` + hls.js engine on Linux/WebKitGTK direct-plays only a
narrow codec set; HEVC 8/10-bit, AV1, and AC3/E-AC3/TrueHD/DTS force a Plex
**transcode** (prexu-duna.3 measured ~17% of the movie library transcoding on
video, ~170 titles on audio). A native libmpv engine direct-plays all of these.

The shipped **Windows** player is a foreign-window-embedding design: a sibling
top-level `HWND` is handed to mpv as `wid`, mpv renders into it with
`vo=gpu-next`, and the transparent WebView2 is z-ordered on top with **manual
Win32 geometry synchronisation** (`SetWindowPos` on every resize/move/DPI
change). mpv's `--wid` embedding is supported on x11/win32/cocoa but **not on
Wayland** (the default session on current KDE/GNOME), which is what made the
prior ADR call Linux a NO-GO.

mpv itself recommends the **render API** (`libmpv/render.h` — a caller-owned
GL/Vulkan/Metal surface) over `wid` embedding. The open question this ADR
answers was whether render-API frames can be composited **underneath** Prexu's
transparent Tauri/wry webview on Wayland, where there is no window to embed
under. Spike `prexu-axj4.1` answered it: **yes.**

### What the spike proved (on hardware)

Verified box: Nobara/Fedora 43, KDE Plasma **Wayland**, NVIDIA RTX 5090 (driver
595.71.05), libmpv 2.5.0, webkit2gtk-4.1 2.52.3, GTK 3.24.52, wry 0.54.2.

The premise behind "Wayland needs a wl_subsurface we can't get" was wrong. On
Linux the Tauri/wry webview is **not a separate OS window** — wry builds it as a
`WebKitWebView` **GTK widget** packed into a `gtk::Box` inside a
`gtk::ApplicationWindow`, and sets its background to `RGBA(0,0,0,0)` when
transparent (`wry-0.54.2/src/webkitgtk/mod.rs:290`). The whole window is **one
`wl_surface`**; GTK composites its child widgets into it. So there is no `wid`
to embed under and **no wl_subsurface is required** — compositing reduces to GTK
widget stacking, which is identical on Wayland and X11.

The spike stacked an mpv-rendered GL widget under the transparent webview in one
`GtkOverlay` and direct-played both a synthetic source and a real **HEVC 10-bit**
library file via **NVDEC** (`[vd] Trying hardware decoding via hevc-nvdec`),
with the HTML/React overlay composited on top with true alpha.

## Decision

Adopt the **render-API + GtkGLArea-under-transparent-WebKitWebView via
GtkOverlay** architecture as the Linux player. Native libmpv is the **default
engine on Linux**, with graceful HTML5 `<video>` fallback (libmpv missing /
render path unsupported on a given compositor-GPU / user toggle) exposed as a
Settings toggle, mirroring how Windows degrades.

### Widget tree

```
GtkApplicationWindow                     (Tauri/tao toplevel — one wl_surface)
  └─ GtkOverlay
       ├─ (base)    GtkGLArea            ← mpv_render_context_render() target
       └─ (overlay) WebKitWebView        ← wry's webview, background RGBA(0,0,0,0)
```

GTK draws the GLArea, then the transparent webview over it. The compositor sees a
single committed buffer containing both.

### Render integration (prexu-axj4.3)

- mpv via `libmpv/render.h`, **OpenGL** backend (`MPV_RENDER_API_TYPE_OPENGL`).
  GL entry points resolved through `eglGetProcAddress` (NVIDIA exposes core GL
  via `EGL_KHR_get_all_proc_addresses`); GtkGLArea on Wayland is EGL-backed.
- In the GLArea `render` handler: `attach_buffers()`, read the bound FBO with
  `glGetIntegerv(GL_FRAMEBUFFER_BINDING /* 0x8CA6 */)`, hand it to mpv as an
  `mpv_opengl_fbo` with `flip_y=1`, then `mpv_render_context_render`.
- **Tauri wiring:** Tauri exposes the GTK window (`window.gtk_window()`) and the
  default container (`default_vbox()`); wry packs its `WebKitWebView` into a
  `gtk::Box`. To put video underneath, reparent at startup: create a
  `GtkOverlay`, move wry's webview widget in as the overlay child, add our
  `GtkGLArea` as the base child, set the overlay as the window's child.
- Frame driving: a ~60 Hz `glib::timeout_add_local` → `queue_render()` is the
  reliable driver; mpv's `set_update_callback` (marshalled to the main thread via
  a `glib` channel) supplements it. (In the spike the update callback alone did
  not reliably pump redraws.)
- Threading: all GL + `mpv_render_context_render` run on the GTK main thread
  inside the `render` signal (the only place the GLArea context is current).
  Never touch GTK objects off-thread.
- Resize/HiDPI: the render handler reads `allocated_{width,height} * scale_factor`
  each frame and rebuilds the FBO descriptor — handled by GTK allocation with
  **no Win32-style geometry-sync plumbing**.
- Lifecycle: `setlocale(LC_NUMERIC, "C")` before `mpv_create()`; free the render
  context in the GLArea `unrealize` handler before the GL context is destroyed.

### Hardware decode (prexu-axj4.6)

NVDEC confirmed on the spike box. VAAPI (Intel/AMD) and the full hwdec matrix are
gated work; `hwdec=auto` selects per platform. AV1 / TrueHD / DTS direct-play
through the same path are expected from libmpv's codec support but are
**verified per-codec in prexu-axj4.8**, not assumed here.

### Engine selection + fallback (prexu-axj4.4)

Native libmpv default on Linux. Fall back to HTML5 `<video>` when `libmpv.so` is
absent, the render path fails to initialise on the running compositor/GPU, or the
user toggles it off in Settings.

### Distribution + licensing (prexu-axj4.7)

Dynamically link an **LGPL**-configured libmpv (avoid GPL prebuilts to retain
dynamic-linking rights). AppImage bundles `libmpv.so`; the rpm declares the
distro `libmpv` dependency. Linux CI provisions libmpv analogously to the
existing Windows leg.

## Consequences

**Easier / lower risk than the Windows `wid` path:**

- **One render path for Wayland and X11.** GTK abstracts the windowing system;
  `GtkGLArea` uses EGL/GLX transparently and `GtkOverlay` compositing is the same
  widget operation on both. (X11 not yet run on the spike box — low risk, a
  checkbox in axj4.3.)
- **No manual geometry synchronisation.** Resize/move/DPI are handled by GTK's
  widget allocation — eliminating the entire class of `SetWindowPos`
  throttling / fullscreen-suppression / DPI-inset bugs that the Windows player
  fought through.
- **Window-thumbnail / Alt-Tab / screen-capture parity is free.** Because video
  and UI are composited into a **single `wl_surface` buffer**, KWin window
  thumbnails (Overview/Present-Windows/Alt-Tab) and screencopy/portal capture
  read that one buffer and inherently include both. This is the property the
  Windows build had to engineer (getting mpv + WebView2 into one DirectComposition
  tree so the DWM thumbnail/WGC captured both); here it is the default because
  there is no separate video surface. (Single-buffer compositing verified via
  compositor-level `spectacle` capture; a literal Alt-Tab thumbnail grab is a
  pending checkbox, not a risk.)

**Harder / new surface:**

- A **second rendering backend** distinct from the Windows `wid` path until the
  later Windows→render-API migration converges them.
- libmpv `.so` bundling (AppImage) + rpm dependency + Linux CI provisioning, and
  LGPL-cleanliness verification of the chosen build.
- **Webview transparency vs. the toplevel `transparent:false` decision.** Prexu
  sets `transparent:false` on Linux (prexu-duna, "Wayland bleed"). The webview
  *widget* must still composite transparently over the GLArea even though the
  *toplevel window* is opaque — these are different surfaces, but the interaction
  with `WEBKIT_DISABLE_DMABUF_RENDERER=1` (prexu-z5mz) and the toplevel setting
  must be re-validated together during axj4.3. (Spike ran with
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` and webview transparency worked.)
- Driver/compositor variance (NVIDIA vs Mesa, GTK GL context creation) — the
  HTML5 fallback exists precisely to absorb environments where render init fails.

## Alternatives considered

- **`wid` / X11-only embedding (port the Windows design).** Rejected: strands
  Wayland users (the modern default) and reintroduces manual geometry sync.
- **Offscreen FBO streamed into the page (canvas/WebGL/`<video>` texture).**
  Rejected: extra copies per frame, likely too slow for 4K/HDR; defeats the
  zero-overhead point of the render API.
- **`wl_subsurface` below the toplevel.** Rejected: unnecessary (the webview is a
  GTK widget, not a separate surface) **and** it would split video into a second
  surface — harming the single-buffer thumbnail/capture parity gained above.
- **Vulkan / gpu-next render backend instead of GL.** Deferred: the GL backend is
  proven and simplest to wire into GtkGLArea; Vulkan is a possible later
  optimisation, not a v1 requirement.

## Open questions (carried into gated tasks)

- X11-session verification of the same widget tree (axj4.3).
- Per-codec direct-play confirmation: AV1, TrueHD/DTS passthrough, HEVC 8-bit
  (axj4.8 re-verifies the full duna.3 gap through the native player).
- VAAPI path on Intel/AMD (axj4.6).
- Reconciling webview-widget transparency with toplevel `transparent:false` +
  `WEBKIT_DISABLE_DMABUF_RENDERER` (axj4.3).

## Sources

- Spike prexu-axj4.1 on-hardware findings + evidence:
  `spike/wayland-render-compositing/FINDINGS.md`.
- Prior ADR (superseded for Linux): `docs/adr-native-player-cross-platform.md`.
- mpv — render API recommended over `wid`; `wid` unsupported on Wayland:
  <https://github.com/mpv-player/mpv-examples/blob/master/libmpv/README.md>,
  <https://github.com/mpv-player/mpv/issues/1242>.
- mpv render API headers: `mpv/render.h`, `mpv/render_gl.h` (libmpv 2.5.0).
- wry Linux webview is a GTK widget with transparent background:
  `wry-0.54.2/src/webkitgtk/mod.rs` (`add_to_container`, line 290).
- Tauri v2 native handle accessors (`gtk_window`, `default_vbox`, `with_webview`):
  <https://docs.rs/tauri/2.10.2/tauri/webview/struct.WebviewWindow.html>.
- EGL core-GL proc resolution: `EGL_KHR_get_all_proc_addresses`.
