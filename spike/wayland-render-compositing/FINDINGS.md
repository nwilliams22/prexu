# Spike prexu-axj4.1 — mpv render-API video under a transparent webview (Linux)

**Verdict: GO.** mpv's render API (libmpv/render.h, OpenGL backend) composites
decoded video frames UNDERNEATH the transparent Tauri/wry webview on live
Wayland — proven on hardware. No `--wid`, no wl_subsurface required. The same
architecture is windowing-system-agnostic and should carry to X11 unchanged.

Verified box: Nobara/Fedora 43, KDE Plasma **Wayland**, NVIDIA RTX 5090 (driver
595.71.05), system libmpv 2.5.0, webkit2gtk-4.1 2.52.3, GTK 3.24.52.

## The key insight (why the "Wayland NO-GO" framing was wrong)

The ADR's Linux NO-GO came from Win32/HWND thinking: "there's no `--wid` window
to embed under on Wayland, so we'd need a wl_subsurface below the toplevel
surface, and wry doesn't expose it." **That premise does not apply**, because on
Linux Tauri's webview is not a separate OS window at all:

- wry 0.54.2 builds the webview as a **`WebKitWebView` GTK widget** packed into a
  `gtk::Box` inside a `gtk::ApplicationWindow`
  (`wry-0.54.2/src/webkitgtk/mod.rs` — `add_to_container`, and line 290:
  `webview.set_background_color(&gtk::gdk::RGBA::new(0., 0., 0., 0.))` when
  `transparent` is requested).
- The whole window is **one wl_surface**; GTK composites its child widgets into
  it. There is nothing to embed a `wid` under and no second surface to stack.

So the compositing question reduces to a pure GTK-widget-stacking question:

> Can a transparent `WebKitWebView` composite over an mpv-rendered GTK GL widget
> inside the same `GtkWindow`?

**Yes.** Stack them in a `GtkOverlay`: base child = `GtkGLArea` (mpv render API
target), overlay child = the transparent `WebKitWebView`. GTK draws the GLArea,
then the webview over it with true alpha. Because GTK owns the surface, this is
identical on Wayland and X11 — the render API is the cross-platform path mpv
itself recommends over `wid`.

## What was actually built

A throwaway standalone Rust binary using the **exact stack the real app uses**
(`gtk 0.18` + `webkit2gtk-4.1` via the same crate versions as `src-tauri`), so
the compositing behavior is interchangeable with Tauri:

```
GtkApplicationWindow
  └─ GtkOverlay
       ├─ (base)    GtkGLArea     ← mpv_render_context_render() draws here
       └─ (overlay) WebKitWebView (bg RGBA 0,0,0,0) ← HTML/React UI
```

mpv is driven via raw FFI to `render.h` (OpenGL backend). GL entry points are
resolved through `eglGetProcAddress` (dlopen'd libEGL; NVIDIA exposes core GL via
`EGL_KHR_get_all_proc_addresses`). The GLArea's FBO is bound with
`gtk_gl_area_attach_buffers()` and passed to mpv as an `mpv_opengl_fbo`.

Run it: `cargo run -- [media-path-or-url]` (defaults to a synthetic lavfi
testsrc so it needs no media; pass a file to direct-play it).

## Evidence (on hardware, this box)

- `evidence/composited-testsrc-under-webview-wayland.png` — lavfi testsrc bars
  rendered by mpv, with the transparent webkit HTML overlay (title bar, centered
  badge, scrubber/play controls) composited on top with true alpha.
- `evidence/composited-hevc10bit-nosferatu-under-webview-wayland.png` — a **real
  HEVC 10-bit** library file (`Nosferatu.2024.1080p.WEBRip.x265.10bit`)
  direct-playing under the same overlay.
- `evidence/mpv-only-testsrc-glarea.png` — mpv-only control (webview disabled),
  confirming the GLArea render path in isolation.
- mpv's own decoder log proved hardware decode, not software:
  ```
  [vd]     hevc_cuvid (hevc) - Nvidia CUVID HEVC decoder
  [vd] Looking at hwdec hevc-nvdec...
  [vd] Trying hardware decoding via hevc-nvdec.
  [vd] Selected decoder: hevc - HEVC (High Efficiency Video Coding)
  ```
  So the codec-must-cover scope (HEVC 8/10-bit, AV1, …) decodes on NVDEC through
  the render API — exactly what the HTML5 path transcodes today (prexu-duna.3).

## Gotchas found (carry into the integration task axj4.3)

1. **GL framebuffer enum.** Query `GL_FRAMEBUFFER_BINDING` (`0x8CA6`) for the FBO
   to hand mpv. `0x8CA9` is `GL_DRAW_FRAMEBUFFER` — a bind *target*, not a
   queryable state; `glGetIntegerv` rejects it (`GL_INVALID_ENUM`) and leaves the
   out-value at 0, so mpv renders into FBO 0 (which GtkGLArea discards) → black
   video. This single wrong constant was the whole "video is black" dead-end.
2. **`attach_buffers()`** must be called at the top of the GLArea `render` handler
   to bind its FBO/texture before reading the binding and rendering.
3. **Frame driving.** mpv's `mpv_render_context_set_update_callback` alone did not
   reliably pump redraws here; a ~60 Hz `glib::timeout_add_local` →
   `queue_render()` is a robust driver. (The update callback marshals onto the
   GTK main thread via a `glib` channel — mpv calls it from its own thread.)
4. **`LC_NUMERIC=C`.** libmpv refuses to create a handle under a non-C numeric
   locale; call `setlocale(LC_NUMERIC, "C")` before `mpv_create()`.
5. **`WEBKIT_DISABLE_DMABUF_RENDERER=1`** (already set by the app, prexu-z5mz) is
   compatible with this path — webview transparency over the GLArea still works
   on NVIDIA with it set.
6. GL context reported by mpv: `GL_VERSION='3.3.0 NVIDIA 595.71.05'`, FBO format
   `rgba16f` — desktop GL 3.3, `gpu`/`gpu-next` renderer path.

## Threading / resize notes

- All GL + `mpv_render_context_render` happen on the GTK main thread inside the
  GLArea `render` signal (the only place the GLArea GL context is current).
- mpv's update callback fires on an mpv-internal thread → `glib` channel →
  main-thread `queue_render()`. Never touch GTK objects off-thread.
- Resize: the render handler reads `allocated_width/height * scale_factor` each
  frame and rebuilds the `mpv_opengl_fbo`, so HiDPI and live resize are handled
  by GTK's allocation with no extra geometry plumbing (contrast: the Windows
  `wid`/Win32 player needs manual SetWindowPos geometry sync).
- Teardown: free the render context in the GLArea `unrealize` handler, before the
  GL context is destroyed.

## X11

Not run on an X11 session on this box (the box is Wayland). The approach is
windowing-agnostic by construction — `GtkGLArea` uses GLX/EGL transparently and
`GtkOverlay` compositing is the same widget-tree operation regardless of backend,
and mpv's OpenGL render backend supports both. Risk is low; **verify on an X11
session** as a checkbox during axj4.3, not as a blocker.

## Recommended architecture for the ADR (prexu-axj4.2)

- **Render-API + GtkGLArea-under-webview via GtkOverlay** is the Linux player
  architecture. Default engine on Linux = native libmpv render API; HTML5
  `<video>` remains the graceful fallback (libmpv missing / unsupported / user
  toggle), per the epic.
- **Tauri integration (axj4.3):** Tauri exposes the GTK window
  (`window.gtk_window()`). wry packs its `WebKitWebView` into a `gtk::Box`. To put
  video under it, reparent: create a `GtkOverlay`, move wry's webview widget into
  it as the overlay child, add our `GtkGLArea` as the base child, and set the
  overlay as the window's child. (wry already sets the webview background to
  transparent; ensure Tauri `transparent` is effectively on for the webview even
  though the *toplevel* stays `transparent:false` for the Wayland-bleed reason in
  prexu-duna — those are different surfaces and need re-checking together.)
- Reuse the existing TS player command surface; map it to libmpv (axj4.5).
- hwdec: NVDEC confirmed here; VAAPI/NVDEC matrix is axj4.6.

## Files

- `src/main.rs` — the PoC (GTK overlay + mpv render-API FFI). Throwaway.
- `build.rs` — links system libmpv via pkg-config.
- `evidence/` — on-hardware screenshots + the decoder-log proof.
