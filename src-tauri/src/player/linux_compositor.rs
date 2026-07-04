//! Linux render-API compositor (prexu-axj4.3).
//!
//! Implements the architecture proven by the `prexu-axj4.1` spike and recorded
//! in `docs/adr-native-player-render-api.md`: composite decoded mpv frames
//! UNDERNEATH the transparent WebKitWebView on Wayland/X11, with no `--wid`
//! embedding and no `wl_subsurface`.
//!
//! Widget tree after [`install`] reparents wry's webview:
//! ```text
//! GtkApplicationWindow                 (Tauri/tao toplevel — one wl_surface)
//!   └─ GtkOverlay
//!        ├─ (base)    GtkGLArea        ← mpv_render_context_render() target
//!        └─ (overlay) WebKitWebView    ← moved OUT of wry's vbox, bg RGBA(0,0,0,0)
//! ```
//!
//! The WebKitWebView is placed DIRECTLY in the overlay, NOT inside wry's vbox:
//! `tauri-runtime-wry`'s `undecorated_resizing::attach_resize_handler` connects
//! button-press/touch handlers on the webview that do
//! `webview.parent().parent().downcast::<gtk::Window>().unwrap()`. With the vbox
//! nested inside the overlay, the webview's grandparent was the GtkOverlay and
//! EVERY left-click aborted the process (the panic cannot unwind across the GTK
//! signal trampoline → SIGABRT). With the webview as a direct overlay child its
//! grandparent is the GtkApplicationWindow again, the downcast succeeds, and the
//! handler no-ops (our window is decorated). wry's now-empty vbox is left
//! unparented; Prexu adds no GTK menus to it.
//!
//! ## Threading rules
//! - ALL GTK/GL work (reparent, render-context create/free, `render`,
//!   `queue_render`) runs on the GTK main thread. The compositor state lives in
//!   a `thread_local!` and is only touched there.
//! - Tauri commands run on tokio worker threads and only touch the thread-safe
//!   `Mpv` handle. [`attach_mpv`] / [`detach_mpv`] marshal onto the main thread
//!   via `run_on_main_thread`.
//! - mpv's render update-callback fires on an mpv-internal thread; it only flips
//!   a `Send` atomic that the main-thread 60 Hz pump polls (no widget access
//!   off-thread, and no deprecated `glib::MainContext::channel`).
//!
//! ## Fail-soft — GTK signal closures are panic-free by construction
//! A panic inside a GTK signal handler cannot unwind across the `extern "C"`
//! trampoline and aborts the whole process, so every closure here is written
//! like `extern "C"` code: no `unwrap`/`expect`, `try_borrow*` with a logged
//! early-return instead of `borrow*`, and no assumption that state exists.
//! Any GL / render-context / EGL failure is logged, recorded for
//! [`engine_failure_reason`], and emitted as `player://engine-failed` so the TS
//! side falls back to the HTML5 `<video>` engine.

use std::cell::{Cell, RefCell};
use std::ffi::{c_char, c_void, CString};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use gtk::glib;
use gtk::prelude::*;
use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2::Mpv;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use webkit2gtk::WebViewExt;

use crate::player::PlayerState;

// ── GL constants / fn-pointer types ───────────────────────────────────────────

/// `GL_FRAMEBUFFER_BINDING` — the *queryable* enum for the currently bound
/// framebuffer. NOT `0x8CA9` (`GL_DRAW_FRAMEBUFFER`, a bind target), which
/// `glGetIntegerv` rejects with `GL_INVALID_ENUM`, leaving fbo=0 → mpv renders
/// into a framebuffer GtkGLArea discards → black video. (spike gotcha #1)
const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
const GL_FRAMEBUFFER: u32 = 0x8D40;
const GL_COLOR_BUFFER_BIT: u32 = 0x0000_4000;
const GL_SCISSOR_TEST: u32 = 0x0C11;

type GlGetIntegervFn = unsafe extern "C" fn(u32, *mut i32);
type GlClearColorFn = unsafe extern "C" fn(f32, f32, f32, f32);
type GlClearFn = unsafe extern "C" fn(u32);
type GlColorMaskFn = unsafe extern "C" fn(u8, u8, u8, u8);
type GlBindFramebufferFn = unsafe extern "C" fn(u32, u32);
type GlDisableFn = unsafe extern "C" fn(u32);
type EglGetProcFn = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type GlxGetProcFn = unsafe extern "C" fn(*const u8) -> *mut c_void;

/// The handful of core-GL entry points the render handler drives around mpv's
/// draw. Resolved once (when the render context is created, with the GLArea
/// context current) and cached — `Copy` so it lives in a `Cell`.
#[derive(Clone, Copy)]
struct GlFns {
    get_integerv: GlGetIntegervFn,
    clear_color: GlClearColorFn,
    clear: GlClearFn,
    color_mask: GlColorMaskFn,
    bind_framebuffer: GlBindFramebufferFn,
    disable: GlDisableFn,
}

impl GlFns {
    /// Resolve all entry points; `None` (with a log) if any is missing.
    fn resolve() -> Option<Self> {
        // SAFETY: each pointer is non-null (checked) and transmuted to the
        // canonical prototype of the core-GL function it names.
        unsafe {
            Some(Self {
                get_integerv: std::mem::transmute::<*mut c_void, GlGetIntegervFn>(
                    non_null_proc("glGetIntegerv")?,
                ),
                clear_color: std::mem::transmute::<*mut c_void, GlClearColorFn>(non_null_proc(
                    "glClearColor",
                )?),
                clear: std::mem::transmute::<*mut c_void, GlClearFn>(non_null_proc("glClear")?),
                color_mask: std::mem::transmute::<*mut c_void, GlColorMaskFn>(non_null_proc(
                    "glColorMask",
                )?),
                bind_framebuffer: std::mem::transmute::<*mut c_void, GlBindFramebufferFn>(
                    non_null_proc("glBindFramebuffer")?,
                ),
                disable: std::mem::transmute::<*mut c_void, GlDisableFn>(non_null_proc(
                    "glDisable",
                )?),
            })
        }
    }
}

/// Resolve one GL proc, logging on failure. Helper for [`GlFns::resolve`].
fn non_null_proc(name: &str) -> Option<*mut c_void> {
    let p = resolve_gl_proc(name);
    if p.is_null() {
        log::error!("[player:linux] GL proc '{name}' unresolved");
        None
    } else {
        Some(p)
    }
}

// ── GL proc-address resolver ───────────────────────────────────────────────────
//
// mpv resolves GL entry points through `OpenGLInitParams.get_proc_address`, a
// plain `fn` pointer with no captured state, so the resolver must be
// process-global. Primary path is `eglGetProcAddress` (Wayland + modern X11;
// NVIDIA exposes core GL via EGL_KHR_get_all_proc_addresses). `glXGetProcAddressARB`
// is the fallback for legacy X11/GLX sessions. Swappable + logged per the brief.

struct GlResolver {
    egl_get_proc: Option<EglGetProcFn>,
    glx_get_proc: Option<GlxGetProcFn>,
    /// Keeps the dlopen'd libEGL/libGL handles alive for the process lifetime so
    /// the cached fn pointers above stay valid. Never read directly.
    #[allow(dead_code)]
    libs: Vec<libloading::Library>,
}

// SAFETY: only the (Copy, thread-safe) fn pointers are ever called; the loaded
// libraries are read-only OS handles kept alive for the process. The resolver is
// initialized once and only read afterwards.
unsafe impl Send for GlResolver {}
unsafe impl Sync for GlResolver {}

static RESOLVER: OnceLock<GlResolver> = OnceLock::new();

/// dlopen libEGL (and libGL for the GLX fallback) once and cache their
/// proc-address resolvers. Idempotent.
fn init_gl_resolver() {
    if RESOLVER.get().is_some() {
        return;
    }
    let mut libs: Vec<libloading::Library> = Vec::new();
    let mut egl_get_proc: Option<EglGetProcFn> = None;
    let mut glx_get_proc: Option<GlxGetProcFn> = None;

    // Primary: EGL (Wayland-backed GtkGLArea, and X11 under GDK_GL=egl).
    if let Ok(lib) = unsafe { libloading::Library::new("libEGL.so.1") } {
        match unsafe { lib.get::<EglGetProcFn>(b"eglGetProcAddress\0") }.map(|s| *s) {
            Ok(f) => egl_get_proc = Some(f),
            Err(e) => log::warn!("[player:linux] eglGetProcAddress unresolved: {e}"),
        }
        libs.push(lib);
    } else {
        log::warn!("[player:linux] libEGL.so.1 not loaded — will try GLX");
    }

    // Fallback: GLX (legacy X11 sessions where GtkGLArea uses GLX).
    if let Ok(lib) = unsafe { libloading::Library::new("libGL.so.1") } {
        match unsafe { lib.get::<GlxGetProcFn>(b"glXGetProcAddressARB\0") }.map(|s| *s) {
            Ok(f) => glx_get_proc = Some(f),
            Err(e) => log::debug!("[player:linux] glXGetProcAddressARB unresolved: {e}"),
        }
        libs.push(lib);
    } else {
        log::debug!("[player:linux] libGL.so.1 not loaded (GLX fallback unavailable)");
    }

    let primary = if egl_get_proc.is_some() {
        "eglGetProcAddress"
    } else if glx_get_proc.is_some() {
        "glXGetProcAddressARB"
    } else {
        "none"
    };
    log::info!(
        "[player:linux] GL proc resolver ready: primary={primary} (egl={}, glx={})",
        egl_get_proc.is_some(),
        glx_get_proc.is_some()
    );
    let _ = RESOLVER.set(GlResolver {
        egl_get_proc,
        glx_get_proc,
        libs,
    });
}

/// Resolve a GL entry point by name. Tries EGL first, then GLX. Returns null if
/// unresolved (mpv treats null as "extension unavailable").
fn resolve_gl_proc(name: &str) -> *mut c_void {
    let Some(r) = RESOLVER.get() else {
        log::error!("[player:linux] resolve_gl_proc('{name}') before resolver init");
        return std::ptr::null_mut();
    };
    let Ok(cname) = CString::new(name) else {
        return std::ptr::null_mut();
    };
    if let Some(f) = r.egl_get_proc {
        let p = unsafe { f(cname.as_ptr()) };
        if !p.is_null() {
            return p;
        }
    }
    if let Some(f) = r.glx_get_proc {
        let p = unsafe { f(cname.as_ptr() as *const u8) };
        if !p.is_null() {
            return p;
        }
    }
    std::ptr::null_mut()
}

/// mpv's `OpenGLInitParams.get_proc_address` (no captured state → process-global
/// resolver). Called on the thread with the current GL context (the GTK main
/// thread inside the GLArea signals).
fn get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
    resolve_gl_proc(name)
}

// ── Engine-failure reporting (HTML5 fallback contract) ─────────────────────────

static ENGINE_FAILURE: Mutex<Option<String>> = Mutex::new(None);

/// Record a fatal render-path failure, log it, and emit `player://engine-failed`
/// so the frontend falls back to HTML5. Fail-soft: no panic, no crash.
fn record_engine_failure(app: &AppHandle, reason: String) {
    log::error!("[player:linux] engine init failed (HTML5 fallback): {reason}");
    if let Ok(mut g) = ENGINE_FAILURE.lock() {
        *g = Some(reason.clone());
    }
    let _ = app.emit("player://engine-failed", reason);
}

/// The recorded native-engine failure reason, if any. Read by
/// `player_engine_status` to answer the TS availability probe.
pub fn engine_failure_reason() -> Option<String> {
    ENGINE_FAILURE.lock().ok().and_then(|g| g.clone())
}

// ── First-frame reveal (prexu-91t8) ─────────────────────────────────────────
//
// On the Windows HWND path the first PlaybackRestart coincides with mpv
// compositing a frame, so events.rs emits `player://host-window-ready` there.
// On the render-API path mpv composites nothing itself — a frame is only on
// screen once the GLArea `render` handler has drawn it, which can lag
// PlaybackRestart by ~0.5-1s (render-context attach races the first load).
// So on Linux the event pump ARMS this one-shot instead, and the render
// handler emits host-window-ready after the first successfully rendered frame
// of that load. Per-LOAD, not per-context: episode handoff soft-stop keeps
// the render context alive, so the pump re-arms on each file's first
// PlaybackRestart and disarms any stale arm on FileLoaded.

static FIRST_FRAME_READY_ARMED: AtomicBool = AtomicBool::new(false);

/// Arm the one-shot first-frame reveal for the current file load. Called from
/// the mpv event-pump thread on the first PlaybackRestart per file. Also
/// nudges one `queue_render` pass so the arm is consumed even when nothing
/// else queues a redraw (e.g. playback restored straight into pause: the
/// 60 Hz pump is gated off and mpv's update callback may already have fired
/// for the frame that preceded the arm).
pub(crate) fn arm_first_frame_ready(app: &AppHandle) {
    FIRST_FRAME_READY_ARMED.store(true, Ordering::Release);
    log::info!("[player:linux] first-frame reveal armed — host-window-ready on next rendered frame");
    if let Err(e) = app.run_on_main_thread(|| {
        let comp = COMPOSITOR.with(|c| c.try_borrow().ok().and_then(|g| g.clone()));
        match comp {
            Some(comp) => comp.gl_area.queue_render(),
            None => log::warn!("[player:linux] arm_first_frame_ready: compositor not installed"),
        }
    }) {
        log::warn!("[player:linux] arm_first_frame_ready: queue_render nudge failed: {e:?}");
    }
}

/// Drop any un-consumed arm. Called on FileLoaded (a stale arm from a
/// previous aborted load must not fire on this load's first — possibly still
/// black — frame) and on detach.
pub(crate) fn disarm_first_frame_ready() {
    if FIRST_FRAME_READY_ARMED.swap(false, Ordering::AcqRel) {
        log::debug!("[player:linux] stale first-frame reveal arm dropped");
    }
}

/// One-shot consume, called from the GLArea render handler after a successful
/// mpv draw. True at most once per arm.
fn consume_first_frame_ready() -> bool {
    FIRST_FRAME_READY_ARMED.swap(false, Ordering::AcqRel)
}

// ── Pure helpers (unit-tested; no GTK/GL required) ─────────────────────────────

/// Physical-pixel FBO size from the GLArea's logical allocation and the DPI
/// scale factor. Re-read every frame — this alone handles live resize + HiDPI
/// (the mpv render API rebuilds its target when the size changes). (ADR)
pub(crate) fn fbo_dimensions(allocated_width: i32, allocated_height: i32, scale_factor: i32) -> (i32, i32) {
    (allocated_width * scale_factor, allocated_height * scale_factor)
}

/// Frame-driver decision: the 60 Hz pump should `queue_render` only while a file
/// is actively playing. Paused / idle (no file) frames are driven solely by
/// mpv's update-callback so we do not re-render the same frame 60×/s. (re-review)
pub(crate) fn should_pump(paused: bool, idle_active: bool) -> bool {
    !paused && !idle_active
}

/// Subtitle compensation for the margin-based mini mode (prexu-91k4).
/// Returns `(sub-scale, sub-use-margins)` for a given margin-ratio tuple.
///
/// mpv's subtitle/OSD layer ignores `video-margin-ratio-*`: it keeps sizing
/// text against the full render surface (`sub-scale-with-window`) and may
/// render into the margins (`sub-use-margins`, default yes). On Windows the
/// mini player is a genuinely small host window so subs scale naturally; the
/// Linux parity factor is the mini video's HEIGHT fraction of the surface
/// (`1 - top - bottom`) — exactly what `sub-scale-with-window` would apply if
/// the window itself were mini-height. Width margins don't matter: mpv sizes
/// text by height. `sub-use-margins=no` keeps the (now correctly small) text
/// inside the video rect instead of the surface-bottom margin.
///
/// Zero ratios (not minimized / cleared) restore mpv defaults `(1.0, yes)`.
/// The floor mirrors `MAX_MARGIN_RATIO` in `commands::minimize`: axis sums
/// are clamped to 0.99 there, so the height fraction is never below 0.01 —
/// the clamp here only guards against a degenerate tuple reaching us anyway.
pub(crate) fn sub_compensation(ratios: (f64, f64, f64, f64)) -> (f64, bool) {
    let (_left, _right, top, bottom) = ratios;
    if ratios == (0.0, 0.0, 0.0, 0.0) {
        return (1.0, true);
    }
    ((1.0 - top - bottom).clamp(0.01, 1.0), false)
}

/// Clear (empty) the opaque region of a widget's GdkWindow so GDK and the
/// compositor alpha-blend the whole widget instead of fast-pathing "opaque"
/// areas from a retained buffer. Called on the webview at realize and after
/// every size-allocate (WebKit re-computes its opaque region there). `verbose`
/// logs the observable compositing state once (realize) instead of per-resize.
/// Panic-free: runs inside GTK signal closures.
fn clear_opaque_region(widget: &gtk::Widget, verbose: bool) {
    let Some(gdk_window) = widget.window() else {
        if verbose {
            log::warn!("[player:linux] clear_opaque_region: widget has no GdkWindow yet");
        }
        return;
    };
    // An EMPTY region (not None — None means "let GTK compute") = nothing opaque.
    let empty = gtk::cairo::Region::create();
    gdk_window.set_opaque_region(Some(&empty));
    if verbose {
        // GDK exposes no opaque-region getter; log the adjacent observable state.
        log::info!(
            "[player:linux] webview opaque region cleared (realize) — app_paintable={} screen_composited={:?} visual_depth={:?}",
            widget.is_app_paintable(),
            widget.screen().map(|s| s.is_composited()),
            widget.visual().map(|v| v.depth())
        );
    } else {
        log::trace!("[player:linux] webview opaque region re-cleared (size-allocate)");
    }
}

// ── Compositor state (GTK-main-thread only) ────────────────────────────────────

thread_local! {
    static COMPOSITOR: RefCell<Option<Rc<Compositor>>> = const { RefCell::new(None) };
}

struct Compositor {
    app: AppHandle,
    gl_area: gtk::GLArea,
    /// The mpv render context — created on first `realize`+`attach_mpv`, freed on
    /// `unrealize`/`detach_mpv`. `None` until both the GL context and mpv exist.
    render: RefCell<Option<RenderContext>>,
    /// Keeps mpv alive for as long as the render context references it; dropped
    /// in `detach_mpv` (after the render context is freed).
    mpv: RefCell<Option<Arc<Mpv>>>,
    realized: Cell<bool>,
    /// Cached core-GL entry points for the per-frame FBO query + clears
    /// (resolved once the GL context is current).
    gl_fns: Cell<Option<GlFns>>,
    /// The 60 Hz `queue_render` pump source; removed on teardown.
    pump_source: RefCell<Option<glib::SourceId>>,
}

impl Compositor {
    /// Read mpv's play state to decide whether the pump should drive a redraw.
    /// Defaults to "don't pump" if mpv or the properties are unavailable.
    /// Panic-free (runs inside a glib timeout closure): `try_borrow`, no unwrap.
    fn should_pump_now(&self) -> bool {
        let Ok(mb) = self.mpv.try_borrow() else {
            return false;
        };
        let Some(mpv) = mb.as_ref() else {
            return false;
        };
        let paused = mpv.get_property::<bool>("pause").unwrap_or(true);
        let idle = mpv.get_property::<bool>("idle-active").unwrap_or(true);
        should_pump(paused, idle)
    }
}

// ── Public entry points ────────────────────────────────────────────────────────

/// Reparent wry's webview under a GtkOverlay with an mpv-render GtkGLArea
/// beneath it, and make the webview background transparent. Runs on the GTK main
/// thread (Tauri `setup` hook), before any playback. Fail-soft.
pub fn install(window: &WebviewWindow, app: AppHandle) {
    log::info!("[player:linux] installing render-API compositor");
    // The WebKit DMABUF renderer is REQUIRED for correct transparent-webview
    // compositing (the fallback renderer accumulates stale composites —
    // progressive dimming/ghosting; see lib.rs). Log the effective state so a
    // user-set disable is visible in defect reports.
    match std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER") {
        Ok(v) if v != "0" => log::warn!(
            "[player:linux] WEBKIT_DISABLE_DMABUF_RENDERER={v} is set — transparent-webview \
             compositing WILL degrade (progressive dimming); native player not recommended"
        ),
        _ => log::info!("[player:linux] WebKit DMABUF renderer enabled (default)"),
    }
    init_gl_resolver();

    // (1) Webview transparency — belt-and-braces. The LOAD-BEARING call is the
    // creation-time opt-in in lib.rs (`wry::set_pending_webview_transparency`,
    // consumed by the vendored fork BEFORE the WebKitWebView was built): only a
    // pre-creation transparent background fixes WebKit's compositing /
    // opaque-region state, so GTK truly alpha-blends the webview over the
    // GLArea instead of re-blending a stale opaque-retained surface
    // (progressive video dimming). This runtime call merely re-asserts the page
    // background. Safe app-wide: the React UI paints its own opaque backgrounds
    // and goes transparent during native playback.
    if let Err(e) = window.with_webview(|pw| {
        let webview = pw.inner();
        webview.set_background_color(&gtk::gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
        log::info!("[player:linux] WebKitWebView background re-asserted transparent (RGBA 0,0,0,0)");
    }) {
        log::error!("[player:linux] with_webview (transparency) failed: {e:?}");
    }

    // (2) Reparent. The window's single child is wry's vbox, which holds the
    // WebKitWebView. Pull the WEBVIEW out of the vbox and stack it directly over
    // our GtkGLArea in a GtkOverlay (see the module docs for why the webview
    // must be a DIRECT overlay child: tauri-runtime-wry's resize handler
    // downcasts `webview.parent().parent()` to `gtk::Window` and aborts the
    // process on every click otherwise).
    let gtk_window = match window.gtk_window() {
        Ok(w) => w,
        Err(e) => {
            record_engine_failure(&app, format!("gtk_window() unavailable: {e:?}"));
            return;
        }
    };
    let vbox = match window.default_vbox() {
        Ok(v) => v,
        Err(e) => {
            record_engine_failure(&app, format!("default_vbox() unavailable: {e:?}"));
            return;
        }
    };
    let children = vbox.children();
    let Some(webview_widget) = children
        .iter()
        .find(|w| w.dynamic_cast_ref::<webkit2gtk::WebView>().is_some())
        .cloned()
    else {
        // Leave the original tree untouched — the app keeps working on HTML5.
        record_engine_failure(&app, "WebKitWebView not found in default vbox".to_string());
        return;
    };
    if children.len() > 1 {
        log::warn!(
            "[player:linux] default vbox has {} children; only the webview is moved into the overlay",
            children.len()
        );
    }

    let overlay = gtk::Overlay::new();
    let gl_area = gtk::GLArea::new();
    gl_area.set_required_version(3, 3);
    gl_area.set_has_depth_buffer(false);
    gl_area.set_has_stencil_buffer(false);
    gl_area.set_hexpand(true);
    gl_area.set_vexpand(true);

    vbox.remove(&webview_widget); // webview out of wry's vbox
    gtk_window.remove(&vbox); // empty vbox out of the window (left unparented)
    overlay.add(&gl_area); // base child = video
    // PREXU_NO_WEBVIEW=1: diagnostic isolation — render mpv only, no webview
    // (discriminates GL-layer bugs from webview-compositing bugs on hardware).
    if std::env::var_os("PREXU_NO_WEBVIEW").is_none() {
        webview_widget.set_hexpand(true);
        webview_widget.set_vexpand(true);
        overlay.add_overlay(&webview_widget); // overlay child = webview (transparent bg)
    } else {
        log::warn!("[player:linux] PREXU_NO_WEBVIEW set — webview NOT composited (diagnostic mode)");
    }
    gtk_window.add(&overlay); // overlay is now the window's child
    // Show the overlay subtree (GLArea + webview). Does NOT show the toplevel —
    // window visibility stays `visible:false` until the frontend calls app_ready.
    overlay.show_all();
    log::info!(
        "[player:linux] reparent done — webview (direct overlay child) over GtkGLArea; UI subtree shown"
    );

    // Fix B (belt-and-braces on top of the creation-time transparency): clear
    // the webview GdkWindow's opaque region so GDK/the compositor never treat
    // any part of it as opaque-retained. GDK has no opaque-region GETTER, so
    // the observable state (app-paintable, RGBA visual depth, composited) is
    // logged instead. WebKit re-computes the region on every size-allocate, so
    // re-assert there too (our handler runs after WebKit's class handler).
    {
        webview_widget.connect_realize(|w| {
            clear_opaque_region(w, true);
        });
        webview_widget.connect_size_allocate(|w, _alloc| {
            clear_opaque_region(w, false);
        });
        // Already realized (unlikely at setup, the toplevel is still hidden) —
        // apply now rather than waiting for a realize that already happened.
        if webview_widget.is_realized() {
            clear_opaque_region(&webview_widget, true);
        }
    }

    // (3) Wire the render lifecycle and store the compositor.
    let comp = Rc::new(Compositor {
        app,
        gl_area,
        render: RefCell::new(None),
        mpv: RefCell::new(None),
        realized: Cell::new(false),
        gl_fns: Cell::new(None),
        pump_source: RefCell::new(None),
    });
    wire_gl_area(&comp);
    COMPOSITOR.with(|c| *c.borrow_mut() = Some(comp));
    log::info!("[player:linux] compositor installed");
}

/// Hand the live mpv handle to the compositor (called from `ensure_init` on a
/// tokio worker). Marshals onto the main thread to create the render context.
pub fn attach_mpv(app: &AppHandle, mpv: Arc<Mpv>) {
    log::info!("[player:linux] attach_mpv — scheduling render-context bind on main thread");
    let app_err = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        let comp = COMPOSITOR.with(|c| c.try_borrow().ok().and_then(|g| g.clone()));
        match comp {
            Some(comp) => {
                match comp.mpv.try_borrow_mut() {
                    Ok(mut g) => *g = Some(mpv),
                    Err(e) => {
                        log::error!("[player:linux] attach_mpv: mpv slot busy: {e}");
                        return;
                    }
                }
                try_create_render_context(&comp);
            }
            None => {
                log::error!("[player:linux] attach_mpv: compositor not installed");
                let _ = app_err.emit(
                    "player://engine-failed",
                    "compositor not installed".to_string(),
                );
            }
        }
    }) {
        log::error!("[player:linux] attach_mpv: run_on_main_thread failed: {e:?}");
    }
}

/// Free the mpv render context on the main thread and drop the compositor's
/// `Arc<Mpv>` clone. Blocks until the main thread confirms, so the caller
/// (`PlayerState::destroy`) only runs `mpv_terminate_destroy` AFTER the render
/// context is freed (ordering requirement — prexu-60mz.4 bug class).
pub fn detach_mpv(app: &AppHandle) {
    log::info!("[player:linux] detach_mpv — freeing render context on main thread (blocking)");
    // No renders will follow — an un-consumed reveal arm must not leak into
    // the next session's first (pre-PlaybackRestart) frame.
    disarm_first_frame_ready();
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let dispatched = app.run_on_main_thread(move || {
        let comp = COMPOSITOR.with(|c| c.try_borrow().ok().and_then(|g| g.clone()));
        if let Some(comp) = comp {
            if let Some(src) = comp.pump_source.try_borrow_mut().ok().and_then(|mut g| g.take()) {
                src.remove();
            }
            // mpv render API contract: the SAME GL context that created the
            // render context must be current for every mpv_render_* call,
            // INCLUDING mpv_render_context_free (which the drop below runs).
            // The create path (try_create_render_context) makes it current;
            // without doing so here the free executes against whatever context
            // is current on the main thread — none, or GDK's own paint
            // context — and mpv deletes its GL objects inside GDK's context.
            // That corrupts GTK's compositing state: the toplevel stops
            // committing frames and the window freezes on its last composite
            // (black after resize) even though every thread stays healthy
            // (prexu-3iv3). Skip when unrealized — the GL context is gone and
            // the unrealize handler already freed the render context there.
            if comp.realized.get() {
                comp.gl_area.make_current();
                if let Some(err) = comp.gl_area.error() {
                    log::error!("[player:linux] detach_mpv: make_current failed: {err}");
                }
            } else {
                log::warn!("[player:linux] detach_mpv: GLArea not realized — freeing without context");
            }
            let freed = match comp.render.try_borrow_mut() {
                Ok(mut g) => g.take().is_some(),
                Err(e) => {
                    log::error!("[player:linux] detach_mpv: render slot busy: {e}");
                    false
                }
            };
            if let Ok(mut g) = comp.mpv.try_borrow_mut() {
                let _ = g.take();
            }
            if freed {
                log::info!("[player:linux] mpv render context freed (detach)");
            }
        }
        let _ = tx.send(());
    });
    match dispatched {
        Ok(()) => {
            if rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .is_err()
            {
                log::warn!("[player:linux] detach_mpv: main-thread teardown not confirmed within 2s");
            }
        }
        Err(e) => log::error!("[player:linux] detach_mpv: run_on_main_thread failed: {e:?}"),
    }
}

// ── In-window minimize: video-margin-ratio application (prexu-axj4.5) ──────────
//
// There is no separate host window to reposition on Linux (see the module
// docs) — the mini-corner inset is achieved by insetting mpv's own video area
// with `video-margin-ratio-left/right/top/bottom`. `commands::minimize`
// computes the four ratios (pure, unit-tested); the functions below apply
// them to the live mpv handle from the GTK main thread.

/// Apply mpv's `video-margin-ratio-*` properties plus the matching subtitle
/// compensation (`sub-scale` / `sub-use-margins`, prexu-91k4), if attached.
/// Panic-free (`try_borrow`, logged early-return) — called both from a
/// main-thread dispatch (`apply_margins_now`/`clear_margins_now`) and
/// directly from the GLArea `resize` signal handler below, both of which
/// already run on the GTK main thread.
fn apply_margin_ratios(comp: &Compositor, ratios: (f64, f64, f64, f64)) {
    let Ok(mb) = comp.mpv.try_borrow() else {
        log::warn!("[player:linux] apply_margin_ratios: mpv slot busy, skipped");
        return;
    };
    let Some(mpv) = mb.as_ref() else {
        log::debug!("[player:linux] apply_margin_ratios: mpv not attached, skipped");
        return;
    };
    let (left, right, top, bottom) = ratios;
    for (name, value) in [
        ("video-margin-ratio-left", left),
        ("video-margin-ratio-right", right),
        ("video-margin-ratio-top", top),
        ("video-margin-ratio-bottom", bottom),
    ] {
        if let Err(e) = mpv.set_property(name, value) {
            log::error!("[player:linux] set_property({name}, {value:.4}) failed: {e:?}");
        }
    }
    // prexu-91k4: margins move the video but NOT mpv's subtitle layer, which
    // keeps rendering at full-surface scale (and into the margins). Scale
    // subs to the mini video height and pin them inside the video rect;
    // zero ratios restore the defaults. Composes with the user's sub style:
    // apply_sub_style drives sub-font-size, this multiplies via sub-scale.
    let (sub_scale, use_margins) = sub_compensation(ratios);
    if let Err(e) = mpv.set_property("sub-scale", sub_scale) {
        log::error!("[player:linux] set_property(sub-scale, {sub_scale:.4}) failed: {e:?}");
    }
    if let Err(e) = mpv.set_property("sub-use-margins", use_margins) {
        log::error!("[player:linux] set_property(sub-use-margins, {use_margins}) failed: {e:?}");
    }
    log::debug!(
        "[player:linux] video-margin-ratio applied left={left:.4} right={right:.4} top={top:.4} bottom={bottom:.4} sub-scale={sub_scale:.4} sub-use-margins={use_margins}"
    );
}

/// Recompute margins from the current `PlayerState::get_minimize()` inset and
/// the GLArea's CURRENT logical allocation, then apply them to mpv. Called by
/// `player_enter_minimize` / `player_update_mini_geometry` after they store
/// the new `MinimizeState`.
///
/// Dispatches onto the GTK main thread and blocks (bounded by a timeout) so
/// the command stays synchronous — mirroring the Windows `resync_host` call,
/// which likewise applies the new geometry before the command returns.
pub(crate) fn apply_margins_now(app: &AppHandle) {
    let app2 = app.clone();
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let dispatched = app.run_on_main_thread(move || {
        let comp = COMPOSITOR.with(|c| c.try_borrow().ok().and_then(|g| g.clone()));
        let Some(comp) = comp else {
            log::warn!("[player:linux] apply_margins_now: compositor not installed");
            let _ = tx.send(());
            return;
        };
        let Some(mini) = app2.state::<PlayerState>().get_minimize() else {
            log::debug!("[player:linux] apply_margins_now: no minimize state, skipping");
            let _ = tx.send(());
            return;
        };
        let w = comp.gl_area.allocated_width();
        let h = comp.gl_area.allocated_height();
        let ratios = crate::player::commands::minimize::compute_margin_ratios(w, h, mini);
        log::info!(
            "[player:linux] apply_margins_now: allocation={w}x{h} corner={:?} ratios={:?}",
            mini.corner, ratios
        );
        apply_margin_ratios(&comp, ratios);
        let _ = tx.send(());
    });
    match dispatched {
        Ok(()) => {
            if rx.recv_timeout(std::time::Duration::from_secs(1)).is_err() {
                log::warn!("[player:linux] apply_margins_now: main-thread apply not confirmed within 1s");
            }
        }
        Err(e) => log::error!("[player:linux] apply_margins_now: run_on_main_thread failed: {e:?}"),
    }
}

/// Reset all four `video-margin-ratio-*` properties to 0.0 so mpv fills the
/// whole GLArea again. Called by `player_exit_minimize`. Same blocking
/// main-thread dispatch pattern as `apply_margins_now`.
pub(crate) fn clear_margins_now(app: &AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let dispatched = app.run_on_main_thread(move || {
        let comp = COMPOSITOR.with(|c| c.try_borrow().ok().and_then(|g| g.clone()));
        match comp {
            Some(comp) => {
                log::info!("[player:linux] clear_margins_now: resetting video-margin-ratio to 0");
                apply_margin_ratios(&comp, (0.0, 0.0, 0.0, 0.0));
            }
            None => log::warn!("[player:linux] clear_margins_now: compositor not installed"),
        }
        let _ = tx.send(());
    });
    match dispatched {
        Ok(()) => {
            if rx.recv_timeout(std::time::Duration::from_secs(1)).is_err() {
                log::warn!("[player:linux] clear_margins_now: main-thread clear not confirmed within 1s");
            }
        }
        Err(e) => log::error!("[player:linux] clear_margins_now: run_on_main_thread failed: {e:?}"),
    }
}

// ── Render lifecycle ───────────────────────────────────────────────────────────

/// Connect the GtkGLArea `realize` / `render` / `unrealize` signals. Each
/// closure holds only a `Weak<Compositor>` so the widget→compositor edge does
/// not form a reference cycle with the compositor→widget edge.
fn wire_gl_area(comp: &Rc<Compositor>) {
    // realize: GL context becomes current here — create the render context if
    // mpv is already attached, else defer until attach_mpv.
    {
        let weak = Rc::downgrade(comp);
        comp.gl_area.connect_realize(move |area| {
            area.make_current();
            if let Some(err) = area.error() {
                if let Some(c) = weak.upgrade() {
                    record_engine_failure(&c.app, format!("GtkGLArea realize error: {err}"));
                }
                return;
            }
            log::info!("[player:linux] GtkGLArea realized (GL context current)");
            if let Some(c) = weak.upgrade() {
                c.realized.set(true);
                try_create_render_context(&c);
            }
        });
    }

    // render: draw the current mpv frame into the GLArea's own FBO.
    // Panic-free: try_borrow + no unwraps (GTK signal closure = extern "C").
    {
        let weak = Rc::downgrade(comp);
        comp.gl_area.connect_render(move |area, _ctx| {
            let Some(c) = weak.upgrade() else {
                return glib::Propagation::Stop;
            };
            let Ok(rb) = c.render.try_borrow() else {
                log::warn!("[player:linux] render skipped — render slot busy");
                return glib::Propagation::Stop;
            };
            let (Some(render), Some(fns)) = (rb.as_ref(), c.gl_fns.get()) else {
                return glib::Propagation::Stop;
            };
            // Bind the GLArea's FBO/texture BEFORE reading the binding.
            area.attach_buffers();
            let mut fbo_id: i32 = 0;
            // SAFETY: cached core-GL fns; the GLArea context is current inside
            // the render signal. Scissor must be off or glClear is clipped to
            // whatever scissor rect mpv left behind.
            unsafe {
                (fns.get_integerv)(GL_FRAMEBUFFER_BINDING, &mut fbo_id);
                // Fresh, fully-opaque base every frame. Without this the buffer
                // keeps prior contents and GTK's composite accumulates a dim
                // layer pass-over-pass (video "gets darker and darker"; resize
                // reset it by reallocating the buffer) and resize shows stale
                // bands from the old allocation.
                (fns.disable)(GL_SCISSOR_TEST);
                (fns.clear_color)(0.0, 0.0, 0.0, 1.0);
                (fns.clear)(GL_COLOR_BUFFER_BIT);
            }
            let (w, h) =
                fbo_dimensions(area.allocated_width(), area.allocated_height(), area.scale_factor());
            // render_no_block (vendored libmpv2 addition): render() with
            // MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME=0. The default blocking
            // render parks THIS (GTK main) thread in an untimed cond wait for
            // the vo thread's flip_page; a video-margin-ratio reconfig during
            // playback deadlocks that pair circularly and freezes the whole
            // main loop — black video, starved Tauri IPC responses — until
            // any mpv core wakeup (prexu-skr2, diagnosed via live eu-stack).
            // Pacing is ours anyway: the 60 Hz pump + GTK vsync drive frame
            // timing, so target-time blocking buys nothing here.
            match render.render_no_block::<()>(fbo_id, w, h, true) {
                Ok(()) => {
                    log::trace!("[player:linux] render frame fbo={fbo_id} {w}x{h}");
                    // prexu-91t8: the load reveal fires HERE — a frame is now
                    // actually in the GLArea buffer (on screen within one GTK
                    // frame-clock cycle) — not on PlaybackRestart. Only on a
                    // successful draw; an errored render leaves the arm set
                    // for the next attempt.
                    if consume_first_frame_ready() {
                        log::info!(
                            "[player:linux] first frame rendered after arm → player://host-window-ready"
                        );
                        let _ = c.app.emit("player://host-window-ready", ());
                    }
                }
                Err(e) => log::trace!("[player:linux] render error: {e:?}"),
            }
            // Force the alpha channel fully opaque AFTER mpv's draw: mpv's GL
            // output does not guarantee alpha=1, and GTK blends the GLArea
            // buffer over the previous window composite using that alpha —
            // any alpha < 1 re-blends (accumulates) instead of replacing.
            // SAFETY: same cached fns; re-bind our FBO first (mpv may have
            // left another framebuffer bound) and re-disable scissor.
            unsafe {
                (fns.bind_framebuffer)(GL_FRAMEBUFFER, fbo_id as u32);
                (fns.disable)(GL_SCISSOR_TEST);
                (fns.color_mask)(0, 0, 0, 1);
                (fns.clear_color)(0.0, 0.0, 0.0, 1.0);
                (fns.clear)(GL_COLOR_BUFFER_BIT);
                (fns.color_mask)(1, 1, 1, 1);
            }
            glib::Propagation::Stop
        });
    }

    // resize: GTK reallocates the GLArea buffers at the new size — queue an
    // immediate repaint so a paused player (pump gated off) still redraws the
    // current frame at the new allocation instead of leaving stale content.
    //
    // Also recompute + re-apply video-margin-ratio-* here (prexu-axj4.5):
    // the mini inset is a FIXED px rect, so its ratios of the surface change
    // on every resize while minimized — without this the mini region would
    // drift out of the requested corner as soon as the user resized the main
    // window. `get_minimize()` returns `None` when not minimized, so this is
    // a no-op during normal (non-mini) playback. Runs on the GTK main thread
    // (this is a GTK signal handler) — panic-free per the module invariant:
    // `weak.upgrade()` early-returns if the compositor is gone, and
    // `apply_margin_ratios` itself uses `try_borrow`.
    {
        let weak = Rc::downgrade(comp);
        comp.gl_area.connect_resize(move |area, w, h| {
            log::debug!("[player:linux] GLArea resize {w}x{h} — queueing repaint");
            area.queue_render();
            let Some(c) = weak.upgrade() else { return };
            if let Some(mini) = c.app.state::<PlayerState>().get_minimize() {
                let ratios = crate::player::commands::minimize::compute_margin_ratios(w, h, mini);
                log::debug!(
                    "[player:linux] resize while minimized — recomputed ratios={:?}",
                    ratios
                );
                apply_margin_ratios(&c, ratios);
            }
        });
    }

    // unrealize: free the render context BEFORE the GL context is destroyed.
    // Panic-free: try_borrow_mut with logged early-return.
    {
        let weak = Rc::downgrade(comp);
        comp.gl_area.connect_unrealize(move |_area| {
            let Some(c) = weak.upgrade() else { return };
            c.realized.set(false);
            if let Some(src) = c.pump_source.try_borrow_mut().ok().and_then(|mut g| g.take()) {
                src.remove();
            }
            match c.render.try_borrow_mut() {
                Ok(mut g) => {
                    if g.take().is_some() {
                        log::info!("[player:linux] GtkGLArea unrealize — mpv render context freed");
                    }
                }
                Err(e) => log::error!("[player:linux] unrealize: render slot busy — context NOT freed: {e}"),
            };
        });
    }
}

/// Create the mpv render context and start the frame pump, if both the GL
/// context (realized) and mpv (attached) are ready. Idempotent; called from both
/// the `realize` handler and `attach_mpv`. Fail-soft.
fn try_create_render_context(comp: &Rc<Compositor>) {
    // Panic-free (runs inside GTK signal / main-thread closures): try_borrow
    // everywhere, logged early-returns, no unwraps.
    match comp.render.try_borrow() {
        Ok(g) if g.is_some() => return,
        Ok(_) => {}
        Err(e) => {
            log::error!("[player:linux] render-context create skipped — render slot busy: {e}");
            return;
        }
    }
    if !comp.realized.get() {
        log::debug!("[player:linux] render-context create deferred — GLArea not realized yet");
        return;
    }
    let mpv = match comp.mpv.try_borrow().map(|g| g.clone()) {
        Ok(Some(m)) => m,
        Ok(None) => {
            log::debug!("[player:linux] render-context create deferred — mpv not attached yet");
            return;
        }
        Err(e) => {
            log::error!("[player:linux] render-context create skipped — mpv slot busy: {e}");
            return;
        }
    };

    comp.gl_area.make_current();
    if let Some(err) = comp.gl_area.error() {
        record_engine_failure(&comp.app, format!("GLArea error before render-context create: {err}"));
        return;
    }

    // RenderContext over the live mpv handle (OpenGL backend). The handle is
    // internally synchronized and `mpv` outlives this context (our Arc clone
    // keeps it alive; detach frees this context before the final Arc drops), so
    // aliasing it here is sound — same pattern as the Windows video_render path.
    let handle = unsafe { &mut *mpv.ctx.as_ptr() };
    let render = match RenderContext::new(
        handle,
        vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams {
                get_proc_address,
                ctx: (),
            }),
        ],
    ) {
        Ok(r) => r,
        Err(e) => {
            record_engine_failure(&comp.app, format!("mpv_render_context_create failed: {e:?}"));
            return;
        }
    };

    // Resolve + cache the core-GL entry points the render handler needs (FBO
    // query, clears, colour-mask, framebuffer re-bind).
    let Some(fns) = GlFns::resolve() else {
        record_engine_failure(&comp.app, "core GL entry points unresolved".to_string());
        return;
    };
    comp.gl_fns.set(Some(fns));

    // mpv update-callback (mpv thread) → flip a Send atomic that the 60 Hz pump
    // polls. Avoids the deprecated glib channel and the spike's leaked sender:
    // the callback closure owns its `needs_render` clone, freed when the render
    // context drops.
    let needs_render = Arc::new(AtomicBool::new(true));
    let mut render = render;
    {
        let nr = Arc::clone(&needs_render);
        render.set_update_callback(move || {
            nr.store(true, Ordering::Relaxed);
        });
    }
    match comp.render.try_borrow_mut() {
        Ok(mut g) => *g = Some(render),
        Err(e) => {
            // `render` drops here (frees the mpv render context) — safe, mpv is
            // still alive; the next attach_mpv retries.
            log::error!("[player:linux] render slot busy — created context dropped: {e}");
            return;
        }
    }
    log::info!("[player:linux] mpv render context created (OpenGL backend); starting 60 Hz frame pump");

    // 60 Hz pump: redraw when mpv signalled a frame OR while actively playing.
    // Paused/idle → skip (mpv's callback still drives seek repaints etc).
    let weak = Rc::downgrade(comp);
    let source = glib::timeout_add_local(std::time::Duration::from_millis(16), move || {
        let Some(c) = weak.upgrade() else {
            return glib::ControlFlow::Break;
        };
        let signalled = needs_render.swap(false, Ordering::Relaxed);
        if signalled || c.should_pump_now() {
            c.gl_area.queue_render();
        }
        glib::ControlFlow::Continue
    });
    match comp.pump_source.try_borrow_mut() {
        Ok(mut g) => {
            // Never leak a previous pump source (idempotence guard).
            if let Some(old) = g.replace(source) {
                old.remove();
            }
        }
        Err(e) => log::error!("[player:linux] pump-source slot busy — pump not stored: {e}"),
    }
}

// ── Unit tests (pure logic only — GTK/GL cannot run headless) ──────────────────

#[cfg(test)]
mod tests {
    use super::{engine_failure_reason, fbo_dimensions, should_pump, sub_compensation};

    #[test]
    fn fbo_dimensions_scale_1_is_identity() {
        assert_eq!(fbo_dimensions(1920, 1080, 1), (1920, 1080));
    }

    #[test]
    fn fbo_dimensions_hidpi_multiplies_by_scale() {
        // 1280×720 logical @ 2× DPI → 2560×1440 physical.
        assert_eq!(fbo_dimensions(1280, 720, 2), (2560, 1440));
    }

    #[test]
    fn fbo_dimensions_zero_allocation_is_zero() {
        // Pre-allocation (GLArea not yet laid out) must not underflow/negate.
        assert_eq!(fbo_dimensions(0, 0, 1), (0, 0));
    }

    #[test]
    fn fbo_dimensions_fractional_scale_rounds_via_gtk() {
        // GTK reports scale_factor as an integer (1 on a 150% display where the
        // font scale, not the surface scale, carries the .5), so the physical
        // size is a clean integer multiple.
        assert_eq!(fbo_dimensions(1000, 500, 3), (3000, 1500));
    }

    #[test]
    fn should_pump_true_only_when_playing() {
        // playing: not paused, not idle.
        assert!(should_pump(false, false));
    }

    #[test]
    fn should_pump_false_when_paused() {
        assert!(!should_pump(true, false));
    }

    #[test]
    fn should_pump_false_when_idle_no_file() {
        assert!(!should_pump(false, true));
    }

    #[test]
    fn should_pump_false_when_paused_and_idle() {
        assert!(!should_pump(true, true));
    }

    #[test]
    fn sub_compensation_defaults_when_not_minimized() {
        // Zero ratios = not minimized (or margins just cleared): mpv defaults.
        assert_eq!(sub_compensation((0.0, 0.0, 0.0, 0.0)), (1.0, true));
    }

    #[test]
    fn sub_compensation_scales_by_mini_height_fraction() {
        // 1600×900 window, 480×270 mini, 16px padding, bottom-right corner:
        // top = (900-270-16)/900, bottom = 16/900 → video height 270/900 = 0.3.
        let top = (900.0 - 270.0 - 16.0) / 900.0;
        let bottom = 16.0 / 900.0;
        let (scale, use_margins) = sub_compensation((0.69, 0.01, top, bottom));
        assert!((scale - 0.3).abs() < 1e-9);
        assert!(!use_margins);
    }

    #[test]
    fn sub_compensation_ignores_width_margins() {
        // mpv sizes subtitle text by height; only the height axis matters.
        let (scale, _) = sub_compensation((0.9, 0.05, 0.25, 0.25));
        assert!((scale - 0.5).abs() < 1e-9);
    }

    #[test]
    fn sub_compensation_clamps_degenerate_height_margins() {
        // Height margins summing past 1.0 (can't happen via MAX_MARGIN_RATIO,
        // guarded anyway) must not produce a non-positive scale.
        let (scale, use_margins) = sub_compensation((0.0, 0.0, 0.7, 0.7));
        assert!((scale - 0.01).abs() < 1e-9);
        assert!(!use_margins);
    }

    #[test]
    fn engine_failure_reason_default_none() {
        // No failure recorded in a fresh process (record_engine_failure needs an
        // AppHandle and is never called in unit tests).
        assert!(engine_failure_reason().is_none());
    }

    #[test]
    fn first_frame_reveal_is_one_shot_and_disarmable() {
        use std::sync::atomic::Ordering;
        // The whole arm/consume/disarm sequence lives in ONE test: the flag is
        // a process-global static and parallel tests would race it.
        // (arm_first_frame_ready needs an AppHandle for the queue_render
        // nudge, so the arm side is exercised via the static directly.)
        super::disarm_first_frame_ready();
        assert!(!super::consume_first_frame_ready(), "un-armed consume must be false");

        super::FIRST_FRAME_READY_ARMED.store(true, Ordering::Release);
        assert!(super::consume_first_frame_ready(), "armed consume fires once");
        assert!(!super::consume_first_frame_ready(), "second consume must not re-fire");

        super::FIRST_FRAME_READY_ARMED.store(true, Ordering::Release);
        super::disarm_first_frame_ready();
        assert!(
            !super::consume_first_frame_ready(),
            "disarm drops a stale arm before it can fire"
        );
    }
}
