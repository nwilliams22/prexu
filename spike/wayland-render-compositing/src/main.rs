//! prexu-axj4.1 spike: mpv render-API video UNDER a transparent webkit webview.
//!
//! Widget tree (mirrors how wry packs Tauri's webview on Linux):
//!
//!   GtkApplicationWindow
//!     └─ GtkOverlay
//!          ├─ (base)    GtkGLArea   ← mpv render API draws decoded frames here
//!          └─ (overlay) WebKitWebView (background RGBA 0,0,0,0) ← React/HTML UI
//!
//! GTK composites both widgets into the window's single wl_surface, so the
//! transparent webview shows the video through it. No `--wid`, no wl_subsurface.
//! Runs identically on Wayland and X11.
//!
//! Usage:  wl_render_compositing [media-path-or-url]
//! Default source is a synthetic lavfi pattern so it runs with zero media deps;
//! pass a real HEVC/AV1 file to prove hardware decode composites too.

use std::cell::Cell;
use std::ffi::{c_char, c_int, c_void, CString};
use std::ptr;
use std::rc::Rc;

use gtk::glib;
use gtk::prelude::*;
use webkit2gtk::WebViewExt;

// ───────────────────────── raw FFI: libmpv render API ─────────────────────────
// We only declare the handful of symbols the spike needs. Types mirror
// mpv/client.h and mpv/render_gl.h from libmpv 2.5.0.

#[repr(C)]
struct MpvHandle {
    _private: [u8; 0],
}
#[repr(C)]
struct MpvRenderContext {
    _private: [u8; 0],
}

#[repr(C)]
struct MpvRenderParam {
    type_: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct MpvOpenglInitParams {
    get_proc_address: extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
struct MpvOpenglFbo {
    fbo: c_int,
    w: c_int,
    h: c_int,
    internal_format: c_int,
}

// mpv_render_param_type
const MPV_RENDER_PARAM_INVALID: c_int = 0;
const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;

type MpvRenderUpdateFn = extern "C" fn(*mut c_void);

extern "C" {
    fn mpv_create() -> *mut MpvHandle;
    fn mpv_initialize(ctx: *mut MpvHandle) -> c_int;
    fn mpv_terminate_destroy(ctx: *mut MpvHandle);
    fn mpv_set_option_string(ctx: *mut MpvHandle, name: *const c_char, data: *const c_char)
        -> c_int;
    fn mpv_command(ctx: *mut MpvHandle, args: *const *const c_char) -> c_int;

    fn mpv_render_context_create(
        res: *mut *mut MpvRenderContext,
        mpv: *mut MpvHandle,
        params: *mut MpvRenderParam,
    ) -> c_int;
    fn mpv_render_context_set_update_callback(
        ctx: *mut MpvRenderContext,
        callback: MpvRenderUpdateFn,
        callback_ctx: *mut c_void,
    );
    fn mpv_render_context_render(ctx: *mut MpvRenderContext, params: *mut MpvRenderParam) -> c_int;
    fn mpv_render_context_free(ctx: *mut MpvRenderContext);
}

// GL_FRAMEBUFFER_BINDING (== GL_DRAW_FRAMEBUFFER_BINDING per spec). NOTE: 0x8CA9
// is GL_DRAW_FRAMEBUFFER (a bind *target*), which glGetIntegerv rejects with
// GL_INVALID_ENUM — querying it leaves the out-value at 0. That bug made mpv
// render into FBO 0 (discarded by GtkGLArea) → black. The queryable enum is 0x8CA6.
const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

// We resolve every GL entry point through eglGetProcAddress, which NVIDIA's EGL
// exposes for core GL too (EGL_KHR_get_all_proc_addresses). libEGL is dlopen'd
// once at startup; no link-time GL dependency. GtkGLArea on Wayland is EGL-backed.
extern "C" {
    fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn setlocale(category: c_int, locale: *const c_char) -> *mut c_char;
}
const RTLD_NOW: c_int = 2;
const LC_NUMERIC: c_int = 1; // glibc

static EGL_GET_PROC: std::sync::OnceLock<usize> = std::sync::OnceLock::new();

fn egl_get_proc(name: *const c_char) -> *mut c_void {
    let addr = *EGL_GET_PROC.get().expect("eglGetProcAddress not loaded");
    let f: extern "C" fn(*const c_char) -> *mut c_void = unsafe { std::mem::transmute(addr) };
    f(name)
}

// mpv calls this to resolve GL functions; must be on the thread with a current
// GL context (it is — we only create the render ctx inside GLArea "realize").
extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    egl_get_proc(name)
}

type GlGetIntegervFn = extern "C" fn(u32, *mut i32);

// mpv calls this from an arbitrary thread when a new frame is ready. GTK widgets
// are not thread-safe, so we only poke a Send glib channel; the main-thread
// receiver calls queue_render().
extern "C" fn on_mpv_update(ctx: *mut c_void) {
    let tx = unsafe { &*(ctx as *const glib::Sender<()>) };
    let _ = tx.send(());
}

// Shared render-context pointer, only ever touched on the GTK main thread.
type RenderCtxCell = Rc<Cell<*mut MpvRenderContext>>;

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Mirror the real app (src-tauri/src/lib.rs): the NVIDIA webview path needs
    // the DMABUF renderer disabled.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let media = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "av://lavfi:testsrc=size=1280x720:rate=30".to_string());
    log::info!("[spike] source = {media}");

    // dlopen libEGL once and stash eglGetProcAddress for the GL resolver.
    unsafe {
        let h = dlopen(b"libEGL.so.1\0".as_ptr() as *const c_char, RTLD_NOW);
        assert!(!h.is_null(), "dlopen(libEGL.so.1) failed");
        let s = dlsym(h, b"eglGetProcAddress\0".as_ptr() as *const c_char);
        assert!(!s.is_null(), "dlsym(eglGetProcAddress) failed");
        EGL_GET_PROC.set(s as usize).ok();
    }

    gtk::init().expect("gtk::init failed");

    // ── mpv handle ──────────────────────────────────────────────────────────
    // libmpv mandates LC_NUMERIC=C (decimal point), regardless of user locale.
    unsafe { setlocale(LC_NUMERIC, b"C\0".as_ptr() as *const c_char) };
    let mpv = unsafe { mpv_create() };
    assert!(!mpv.is_null(), "mpv_create returned null");
    unsafe {
        set_opt(mpv, "terminal", "yes");
        set_opt(mpv, "msg-level", "all=v");
        set_opt(mpv, "hwdec", "auto"); // NVDEC on this box; proves hw-decode composites
        set_opt(mpv, "vo", "libmpv"); // required for the render API
        set_opt(mpv, "loop-file", "inf");
        let rc = mpv_initialize(mpv);
        assert_eq!(rc, 0, "mpv_initialize failed: {rc}");
    }

    // ── widgets ─────────────────────────────────────────────────────────────
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("prexu-axj4.1 — mpv render API under transparent webkit");
    window.set_default_size(1280, 720);
    if std::env::var_os("SPIKE_KEEP_ABOVE").is_some() {
        window.set_keep_above(true);
    }

    let overlay = gtk::Overlay::new();

    let gl_area = gtk::GLArea::new();
    gl_area.set_required_version(3, 3);
    gl_area.set_has_depth_buffer(false);
    gl_area.set_has_stencil_buffer(false);
    gl_area.set_hexpand(true);
    gl_area.set_vexpand(true);
    overlay.add(&gl_area); // base child

    // SPIKE_NO_WEBVIEW=1 isolates the mpv->GLArea path (proves video renders at
    // all). Without it, the transparent webview is stacked above to test compositing.
    if std::env::var_os("SPIKE_NO_WEBVIEW").is_none() {
        let webview = webkit2gtk::WebView::new();
        webview.set_background_color(&gtk::gdk::RGBA::new(0.0, 0.0, 0.0, 0.0)); // transparent, like wry
        webview.set_hexpand(true);
        webview.set_vexpand(true);
        webview.load_html(OVERLAY_HTML, None);
        overlay.add_overlay(&webview); // stacked above the GLArea
        log::info!("[spike] webview overlay added (transparent bg)");
    } else {
        log::info!("[spike] SPIKE_NO_WEBVIEW: mpv GLArea only, no webview");
    }

    window.add(&overlay);

    // ── mpv render context lifecycle, bound to the GLArea's GL context ───────
    let render_ctx: RenderCtxCell = Rc::new(Cell::new(ptr::null_mut()));

    // Channel: mpv update thread -> GTK main thread -> queue_render.
    let (tx, rx) = glib::MainContext::channel::<()>(glib::Priority::DEFAULT);
    let tx_boxed: Box<glib::Sender<()>> = Box::new(tx);
    let tx_ptr = Box::into_raw(tx_boxed); // leaked for the lifetime of the app (spike)

    {
        let render_ctx = render_ctx.clone();
        let gl_area_weak = gl_area.downgrade();
        let media = media.clone();
        gl_area.connect_realize(move |area| {
            area.make_current();
            if let Some(err) = area.error() {
                log::error!("[spike] GLArea realize error: {err}");
                return;
            }

            let api = CString::new("opengl").unwrap();
            let mut init = MpvOpenglInitParams {
                get_proc_address,
                get_proc_address_ctx: ptr::null_mut(),
            };
            let mut params = [
                MpvRenderParam {
                    type_: MPV_RENDER_PARAM_API_TYPE,
                    data: api.as_ptr() as *mut c_void,
                },
                MpvRenderParam {
                    type_: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                    data: &mut init as *mut _ as *mut c_void,
                },
                MpvRenderParam {
                    type_: MPV_RENDER_PARAM_INVALID,
                    data: ptr::null_mut(),
                },
            ];

            let mut ctx: *mut MpvRenderContext = ptr::null_mut();
            let rc = unsafe { mpv_render_context_create(&mut ctx, mpv, params.as_mut_ptr()) };
            if rc != 0 || ctx.is_null() {
                log::error!("[spike] mpv_render_context_create failed: {rc}");
                return;
            }
            render_ctx.set(ctx);
            log::info!("[spike] mpv render context created (GL backend)");

            unsafe {
                mpv_render_context_set_update_callback(ctx, on_mpv_update, tx_ptr as *mut c_void);
            }

            // Start playback now that the render path is live.
            let _ = gl_area_weak; // keep the closure's capture set explicit
            let cmd = CString::new("loadfile").unwrap();
            let arg = CString::new(media.as_str()).unwrap();
            let argv: [*const c_char; 3] = [cmd.as_ptr(), arg.as_ptr(), ptr::null()];
            let rc = unsafe { mpv_command(mpv, argv.as_ptr()) };
            log::info!("[spike] loadfile rc={rc}");
        });
    }

    let frame_count = Rc::new(Cell::new(0u64));
    {
        let render_ctx = render_ctx.clone();
        let frame_count = frame_count.clone();
        gl_area.connect_render(move |area, _ctx| {
            let rctx = render_ctx.get();
            if rctx.is_null() {
                return glib::Propagation::Proceed;
            }
            let n = frame_count.get() + 1;
            frame_count.set(n);
            if n <= 3 || n % 60 == 0 {
                log::info!("[spike] render frame #{n}");
            }
            let scale = area.scale_factor();
            let w = area.allocated_width() * scale;
            let h = area.allocated_height() * scale;

            // Bind the GLArea's own FBO/texture as the draw target. Without this
            // the bound draw framebuffer is 0 (the default FB), which GtkGLArea
            // never presents — mpv would render into a discarded buffer (black).
            area.attach_buffers();

            let gi: GlGetIntegervFn =
                unsafe { std::mem::transmute(egl_get_proc(b"glGetIntegerv\0".as_ptr() as *const c_char)) };
            let mut cur_fbo: i32 = 0;
            gi(GL_FRAMEBUFFER_BINDING, &mut cur_fbo);

            let mut fbo = MpvOpenglFbo {
                fbo: cur_fbo,
                w,
                h,
                internal_format: 0,
            };
            let mut flip: c_int = 1;
            let mut params = [
                MpvRenderParam {
                    type_: MPV_RENDER_PARAM_OPENGL_FBO,
                    data: &mut fbo as *mut _ as *mut c_void,
                },
                MpvRenderParam {
                    type_: MPV_RENDER_PARAM_FLIP_Y,
                    data: &mut flip as *mut _ as *mut c_void,
                },
                MpvRenderParam {
                    type_: MPV_RENDER_PARAM_INVALID,
                    data: ptr::null_mut(),
                },
            ];
            let rc = unsafe { mpv_render_context_render(rctx, params.as_mut_ptr()) };
            if n <= 3 || (rc != 0 && n % 60 == 0) {
                log::info!("[spike] render frame #{n}: fbo={cur_fbo} {w}x{h} rc={rc}");
            }
            glib::Propagation::Stop
        });
    }

    {
        let gl_area = gl_area.clone();
        rx.attach(None, move |_| {
            gl_area.queue_render();
            glib::ControlFlow::Continue
        });
    }

    // Robust frame driver: also poke a redraw ~60 Hz, independent of mpv's update
    // callback, so the render path can't stall on callback-wiring issues.
    {
        let gl_area = gl_area.clone();
        glib::timeout_add_local(std::time::Duration::from_millis(16), move || {
            gl_area.queue_render();
            glib::ControlFlow::Continue
        });
    }

    // Clean teardown of the render context before the GL context dies.
    {
        let render_ctx = render_ctx.clone();
        gl_area.connect_unrealize(move |_| {
            let ctx = render_ctx.replace(ptr::null_mut());
            if !ctx.is_null() {
                unsafe { mpv_render_context_free(ctx) };
                log::info!("[spike] mpv render context freed");
            }
        });
    }

    window.connect_delete_event(move |_, _| {
        unsafe { mpv_terminate_destroy(mpv) };
        gtk::main_quit();
        glib::Propagation::Proceed
    });

    window.show_all();
    log::info!("[spike] window shown — entering GTK main loop");
    gtk::main();
}

unsafe fn set_opt(mpv: *mut MpvHandle, name: &str, val: &str) {
    let n = CString::new(name).unwrap();
    let v = CString::new(val).unwrap();
    let rc = mpv_set_option_string(mpv, n.as_ptr(), v.as_ptr());
    if rc != 0 {
        log::warn!("[spike] set_option {name}={val} -> rc={rc}");
    }
}

// HTML overlay: transparent body so video shows through, with a top title bar
// and a bottom control bar — proves true alpha compositing of webkit over mpv.
const OVERLAY_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    font-family:system-ui,sans-serif;color:#fff;-webkit-user-select:none}
  .topbar{position:fixed;top:0;left:0;right:0;height:64px;display:flex;
    align-items:center;padding:0 20px;font-size:20px;font-weight:600;
    background:linear-gradient(to bottom,rgba(0,0,0,.65),rgba(0,0,0,0));
    text-shadow:0 1px 3px rgba(0,0,0,.8)}
  .dot{width:12px;height:12px;border-radius:50%;background:#5fd35f;margin-right:12px;
    box-shadow:0 0 8px #5fd35f}
  .center{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
    pointer-events:none}
  .badge{padding:14px 26px;border-radius:14px;font-size:22px;font-weight:700;
    background:rgba(20,20,30,.42);border:1px solid rgba(255,255,255,.35);
    backdrop-filter:blur(2px);text-shadow:0 2px 6px rgba(0,0,0,.9)}
  .ctrl{position:fixed;bottom:0;left:0;right:0;height:88px;padding:0 24px;
    display:flex;flex-direction:column;justify-content:center;gap:12px;
    background:linear-gradient(to top,rgba(0,0,0,.75),rgba(0,0,0,0))}
  .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.3)}
  .fill{height:6px;width:38%;border-radius:3px;background:#e5532f}
  .row{display:flex;align-items:center;gap:16px;font-size:14px}
  .play{width:34px;height:34px;border-radius:50%;background:#fff;color:#111;
    display:flex;align-items:center;justify-content:center;font-size:16px}
</style></head><body>
  <div class="topbar"><span class="dot"></span>PREXU — HTML overlay (webkit, transparent bg)</div>
  <div class="center"><div class="badge">↑ this is the React/HTML layer &nbsp;·&nbsp; video below is mpv ↓</div></div>
  <div class="ctrl">
    <div class="bar"><div class="fill"></div></div>
    <div class="row"><div class="play">▶</div><span>00:48 / 02:10</span>
      <span style="margin-left:auto">mpv render API · gpu-next · NVDEC</span></div>
  </div>
</body></html>"#;
