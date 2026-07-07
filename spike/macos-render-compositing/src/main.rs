//! prexu-ia6w.2 spike — mpv render-API video UNDER a transparent WKWebView in ONE
//! NSWindow on Apple Silicon. The macOS analog of spike/wayland-render-compositing.
//!
//!   NSWindow
//!     └─ contentView (layer-backed)
//!          ├─ (base)    NSOpenGLView   ← mpv_render_context_render() draws here
//!          └─ (overlay) WKWebView (drawsBackground = NO) ← HTML overlay
//!
//! AppKit composites the two sibling subviews into the window's single surface, so
//! the transparent webview shows the video through it with true alpha. No child
//! OS window, no `--wid`. This is the macOS equivalent of GtkOverlay stacking.
//!
//! It self-drives: plays a real HEVC 10-bit sample, pumps frames at ~60 Hz on the
//! main thread, captures its own composited window to evidence/ via
//! CGWindowListCreateImage (and `screencapture -l` fallback), measures FPS, then
//! tears down (render context freed BEFORE the GL context) and exits cleanly.
//!
//! Usage:  macos_render_compositing [media-path]   (default: samples/sample-hevc10.mp4)
//! Env:    SPIKE_NO_WEBVIEW=1  → mpv NSOpenGLView only (isolates the render path)
//!         SPIKE_RUN_SECS=N    → run duration before teardown (default 12)

use std::cell::Cell;
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::Arc;
use std::time::Instant;

use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2::Mpv;
use objc2::encode::{Encode, Encoding};
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};

// ───────────────────────────── geometry (repr(C)) ─────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}
// objc2 requires struct arg/return types to declare their Objective-C encoding.
unsafe impl Encode for CGPoint {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for CGSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for CGRect {
    const ENCODING: Encoding =
        Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
}

impl CGRect {
    fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        CGRect {
            origin: CGPoint { x, y },
            size: CGSize {
                width: w,
                height: h,
            },
        }
    }
    // CGRectNull: origin at +inf — tells CGWindowListCreateImage "use the window bounds".
    fn null() -> Self {
        CGRect::new(f64::INFINITY, f64::INFINITY, 0.0, 0.0)
    }
}

// ───────────────────────────── AppKit / NSOpenGL constants ────────────────────
const NS_WINDOW_STYLE_TITLED: u64 = 1;
const NS_WINDOW_STYLE_CLOSABLE: u64 = 2;
const NS_WINDOW_STYLE_MINIATURIZABLE: u64 = 4;
const NS_WINDOW_STYLE_RESIZABLE: u64 = 8;
const NS_BACKING_STORE_BUFFERED: u64 = 2;
const NS_APP_ACTIVATION_POLICY_REGULAR: isize = 0;
// autoresizing: width-sizable (2) | height-sizable (16)
const NS_VIEW_WIDTH_HEIGHT_SIZABLE: u64 = 2 | 16;

// NSOpenGLPixelFormatAttribute values (NSOpenGL.h).
const NSOPENGL_PFA_DOUBLE_BUFFER: u32 = 5;
const NSOPENGL_PFA_COLOR_SIZE: u32 = 8;
const NSOPENGL_PFA_ALPHA_SIZE: u32 = 11;
const NSOPENGL_PFA_DEPTH_SIZE: u32 = 12;
const NSOPENGL_PFA_ACCELERATED: u32 = 73;
const NSOPENGL_PFA_ALLOW_OFFLINE: u32 = 96;
const NSOPENGL_PFA_OPENGL_PROFILE: u32 = 99;
const NSOPENGL_PROFILE_VERSION_3_2_CORE: u32 = 0x3200;

// ─────────────────────────── CoreFoundation run loop FFI ──────────────────────
type CFRunLoopRef = *mut c_void;
type CFRunLoopTimerRef = *mut c_void;
type CFStringRef = *const c_void;
type CFAllocatorRef = *const c_void;
type CFRunLoopTimerCallBack = extern "C" fn(CFRunLoopTimerRef, *mut c_void);

#[repr(C)]
struct CFRunLoopTimerContext {
    version: isize,
    info: *mut c_void,
    retain: *const c_void,
    release: *const c_void,
    copy_description: *const c_void,
}

extern "C" {
    fn CFRunLoopGetMain() -> CFRunLoopRef;
    fn CFRunLoopAddTimer(rl: CFRunLoopRef, timer: CFRunLoopTimerRef, mode: CFStringRef);
    fn CFRunLoopStop(rl: CFRunLoopRef);
    fn CFRunLoopTimerCreate(
        allocator: CFAllocatorRef,
        fire_date: f64,
        interval: f64,
        flags: u64,
        order: isize,
        callout: CFRunLoopTimerCallBack,
        context: *mut CFRunLoopTimerContext,
    ) -> CFRunLoopTimerRef;
    fn CFAbsoluteTimeGetCurrent() -> f64;
    static kCFRunLoopCommonModes: CFStringRef;

    fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn setlocale(category: c_int, locale: *const c_char) -> *mut c_char;
}
use std::os::raw::c_int;
const RTLD_NOW: c_int = 2;
const LC_NUMERIC_MACOS: c_int = 4; // macOS <sys/_types.h> LC_NUMERIC

// ─────────────────────── CoreGraphics window-capture FFI ──────────────────────
type CGImageRef = *mut c_void;
type CGDataProviderRef = *mut c_void;
type CFDataRef = *const c_void;
extern "C" {
    fn CGWindowListCreateImage(
        bounds: CGRect,
        list_option: u32,
        window_id: u32,
        image_option: u32,
    ) -> CGImageRef;
    fn CGImageGetWidth(image: CGImageRef) -> usize;
    fn CGImageGetHeight(image: CGImageRef) -> usize;
    fn CGImageGetBytesPerRow(image: CGImageRef) -> usize;
    fn CGImageGetBitsPerPixel(image: CGImageRef) -> usize;
    fn CGImageGetDataProvider(image: CGImageRef) -> CGDataProviderRef;
    fn CGDataProviderCopyData(provider: CGDataProviderRef) -> CFDataRef;
    fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
    fn CFDataGetLength(data: CFDataRef) -> isize;
    fn CFRelease(cf: *const c_void);
}
const KCG_WINDOW_LIST_INCLUDING_WINDOW: u32 = 1 << 3; // 8
const KCG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING: u32 = 1 << 0; // 1
const KCG_WINDOW_IMAGE_BEST_RESOLUTION: u32 = 1 << 3; // 8

// ───────────────────────── GL entry-point resolution ──────────────────────────
// mpv resolves GL functions through this callback. On macOS the OpenGL framework
// exports core GL symbols directly, so dlsym on its handle works (no wgl/egl).
static GL_HANDLE: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

fn get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
    let h = GL_HANDLE.load(Ordering::Relaxed);
    if h.is_null() {
        return std::ptr::null_mut();
    }
    let cname = match CString::new(name) {
        Ok(c) => c,
        Err(_) => return std::ptr::null_mut(),
    };
    unsafe { dlsym(h, cname.as_ptr()) }
}

type GlGetIntegervFn = extern "C" fn(u32, *mut i32);
type GlGetStringFn = extern "C" fn(u32) -> *const u8;
const GL_VERSION: u32 = 0x1F02;
const GL_RENDERER: u32 = 0x1F01;

// ─────────────────────────── per-frame render state ───────────────────────────
// Touched only on the main thread (the CFRunLoopTimer callback). `needs_render`
// is the sole cross-thread field: mpv's update callback (mpv render thread) sets
// it; the main-thread pump swaps it — mirrors the Linux compositor's AtomicBool.
struct Spike {
    render: Cell<Option<RenderContext>>,
    gl_ctx: *mut AnyObject,  // NSOpenGLContext
    gl_view: *mut AnyObject, // NSOpenGLView
    window: *mut AnyObject,  // NSWindow
    mpv_ctx: *mut libmpv2_sys::mpv_handle, // for the teardown `quit` (stop audio)
    needs_render: Arc<AtomicBool>,
    frames: Cell<u64>,
    last_w: Cell<i32>,
    last_h: Cell<i32>,
    start: Instant,
    run_secs: f64,
    cap1_done: Cell<bool>,
    cap2_done: Cell<bool>,
    torn_down: Cell<bool>,
    logged_gl: Cell<bool>,
}

// ─────────────────────────────── objc helpers ─────────────────────────────────
fn nsstring(s: &str) -> *mut AnyObject {
    let c = CString::new(s).unwrap();
    let cls = class!(NSString);
    unsafe { msg_send![cls, stringWithUTF8String: c.as_ptr()] }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let run_secs: f64 = std::env::var("SPIKE_RUN_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(12.0);
    let media = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "samples/sample-hevc10.mp4".to_string());
    let no_webview = std::env::var_os("SPIKE_NO_WEBVIEW").is_some();
    log::info!("[spike] source={media} run_secs={run_secs} no_webview={no_webview}");

    // dlopen the OpenGL framework once for get_proc_address.
    unsafe {
        let h = dlopen(
            b"/System/Library/Frameworks/OpenGL.framework/OpenGL\0".as_ptr() as *const c_char,
            RTLD_NOW,
        );
        assert!(!h.is_null(), "dlopen(OpenGL.framework) failed");
        GL_HANDLE.store(h, Ordering::Relaxed);
    }

    // Long-lived autorelease pool so setup-time autoreleased objects don't warn
    // (the AppKit run loop would otherwise be the first pool). Intentionally leaked.
    let _pool: *mut AnyObject = unsafe {
        let cls = class!(NSAutoreleasePool);
        let p: *mut AnyObject = msg_send![cls, alloc];
        msg_send![p, init]
    };

    // ── mpv: LC_NUMERIC=C before create (libmpv hard requirement) ─────────────
    unsafe { setlocale(LC_NUMERIC_MACOS, b"C\0".as_ptr() as *const c_char) };
    log::info!("[spike] setlocale(LC_NUMERIC, \"C\") applied before mpv_create");

    let mpv = Mpv::with_initializer(|init| {
        // Pre-init: options must go through set_option (not set_property, which
        // fails with PROPERTY_ERROR before mpv_initialize). Each is best-effort so
        // one bad option cannot abort the whole spike.
        for (k, v) in [
            ("hwdec", "auto-safe"), // → VideoToolbox on macOS
            ("vo", "libmpv"),       // render API
            ("loop-file", "inf"),
            ("msg-level", "all=v"), // [vd] hw-decode lines to the log event
        ] {
            if let Err(e) = init.set_option(k, v) {
                log::warn!("[spike] set_option({k}={v}) failed: {e:?}");
            }
        }
        Ok(())
    })
    .expect("Mpv::with_initializer failed");
    log::info!("[spike] mpv created + initialized (hwdec=auto-safe, vo=libmpv)");

    let mpv_ctx_ptr = mpv.ctx.as_ptr();

    // Request verbose log messages and pump them on a dedicated thread (main
    // thread owns rendering, not events — mirrors the mission's threading note).
    unsafe {
        libmpv2_sys::mpv_request_log_messages(mpv_ctx_ptr, b"v\0".as_ptr() as *const c_char);
    }
    spawn_event_thread(mpv_ctx_ptr as usize);

    // ── AppKit: NSApplication + window + views ────────────────────────────────
    let app: *mut AnyObject = unsafe {
        let cls = class!(NSApplication);
        msg_send![cls, sharedApplication]
    };
    unsafe {
        let _: bool = msg_send![app, setActivationPolicy: NS_APP_ACTIVATION_POLICY_REGULAR];
    }

    let content_rect = CGRect::new(0.0, 0.0, 1280.0, 720.0);
    let style = NS_WINDOW_STYLE_TITLED
        | NS_WINDOW_STYLE_CLOSABLE
        | NS_WINDOW_STYLE_MINIATURIZABLE
        | NS_WINDOW_STYLE_RESIZABLE;
    let window: *mut AnyObject = unsafe {
        let cls = class!(NSWindow);
        let w: *mut AnyObject = msg_send![cls, alloc];
        msg_send![
            w,
            initWithContentRect: content_rect,
            styleMask: style,
            backing: NS_BACKING_STORE_BUFFERED,
            defer: false,
        ]
    };
    unsafe {
        let _: () = msg_send![window, setTitle: nsstring("prexu-ia6w.2 — mpv render API under transparent WKWebView")];
        let _: () = msg_send![window, center];
    }

    let content: *mut AnyObject = unsafe { msg_send![window, contentView] };
    unsafe {
        // Force the whole hierarchy layer-backed (WKWebView already forces this;
        // being explicit makes the GL view's IOSurface layer participate in CA).
        let _: () = msg_send![content, setWantsLayer: true];
    }

    // ── NSOpenGLView (base video layer) ───────────────────────────────────────
    let pixel_format: *mut AnyObject = unsafe {
        let attrs: [u32; 15] = [
            NSOPENGL_PFA_OPENGL_PROFILE,
            NSOPENGL_PROFILE_VERSION_3_2_CORE,
            NSOPENGL_PFA_DOUBLE_BUFFER,
            NSOPENGL_PFA_ACCELERATED,
            NSOPENGL_PFA_ALLOW_OFFLINE,
            NSOPENGL_PFA_COLOR_SIZE,
            24,
            NSOPENGL_PFA_ALPHA_SIZE,
            8,
            NSOPENGL_PFA_DEPTH_SIZE,
            0,
            0,
            0,
            0,
            0,
        ];
        let cls = class!(NSOpenGLPixelFormat);
        let pf: *mut AnyObject = msg_send![cls, alloc];
        msg_send![pf, initWithAttributes: attrs.as_ptr()]
    };
    assert!(!pixel_format.is_null(), "NSOpenGLPixelFormat init failed (no GL 3.2 core?)");

    let gl_view: *mut AnyObject = unsafe {
        let cls = class!(NSOpenGLView);
        let v: *mut AnyObject = msg_send![cls, alloc];
        let v: *mut AnyObject =
            msg_send![v, initWithFrame: content_rect, pixelFormat: pixel_format];
        let _: () = msg_send![v, setWantsBestResolutionOpenGLSurface: true];
        let _: () = msg_send![v, setAutoresizingMask: NS_VIEW_WIDTH_HEIGHT_SIZABLE];
        v
    };
    let gl_ctx: *mut AnyObject = unsafe { msg_send![gl_view, openGLContext] };
    assert!(!gl_ctx.is_null(), "NSOpenGLContext is null");
    unsafe {
        let _: () = msg_send![content, addSubview: gl_view];
    }

    // ── WKWebView (transparent overlay) ───────────────────────────────────────
    if !no_webview {
        let webview: *mut AnyObject = unsafe {
            let cfg_cls = class!(WKWebViewConfiguration);
            let cfg: *mut AnyObject = msg_send![cfg_cls, new];
            let cls = class!(WKWebView);
            let v: *mut AnyObject = msg_send![cls, alloc];
            let v: *mut AnyObject = msg_send![v, initWithFrame: content_rect, configuration: cfg];
            let _: () = msg_send![v, setAutoresizingMask: NS_VIEW_WIDTH_HEIGHT_SIZABLE];
            v
        };
        // Transparency: WKWebView has no public setOpaque; the KVC toggle of the
        // private `drawsBackground` flag is the documented-by-community route.
        // Combined with a transparent HTML <body>, this lets video show through.
        unsafe {
            let no_val: *mut AnyObject = {
                let cls = class!(NSNumber);
                msg_send![cls, numberWithBool: false]
            };
            let _: () = msg_send![webview, setValue: no_val, forKey: nsstring("drawsBackground")];
            let _nav: *mut AnyObject = msg_send![webview, loadHTMLString: nsstring(OVERLAY_HTML), baseURL: std::ptr::null_mut::<AnyObject>()];
            // Stacked ABOVE the GL view (later subview = on top).
            let _: () = msg_send![content, addSubview: webview];
        }
        log::info!("[spike] WKWebView overlay added (drawsBackground=NO, transparent HTML body)");
    } else {
        log::info!("[spike] SPIKE_NO_WEBVIEW: NSOpenGLView only");
    }

    unsafe {
        let _: () = msg_send![window, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
        let _: () = msg_send![app, activateIgnoringOtherApps: true];
    }

    // ── mpv render context (OpenGL backend) bound to the NSOpenGLContext ───────
    unsafe {
        let _: () = msg_send![gl_ctx, makeCurrentContext];
    }
    let handle = unsafe { &mut *mpv_ctx_ptr };
    let mut render = RenderContext::new(
        handle,
        vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams {
                get_proc_address,
                ctx: (),
            }),
        ],
    )
    .expect("mpv_render_context_create failed");
    log::info!("[spike] mpv render context created (OpenGL backend)");

    // Log the GL strings mpv is rendering on (proof of the real GL context).
    unsafe {
        let gs: GlGetStringFn = std::mem::transmute(get_proc_address(&(), "glGetString"));
        let ver = CStr::from_ptr(gs(GL_VERSION) as *const c_char).to_string_lossy();
        let rend = CStr::from_ptr(gs(GL_RENDERER) as *const c_char).to_string_lossy();
        log::info!("[spike] GL_VERSION='{ver}' GL_RENDERER='{rend}'");
    }

    let needs_render = Arc::new(AtomicBool::new(true));
    {
        let nr = Arc::clone(&needs_render);
        render.set_update_callback(move || {
            nr.store(true, Ordering::Relaxed);
        });
    }

    // Start playback.
    mpv.command("loadfile", &[&media]).expect("loadfile failed");
    log::info!("[spike] loadfile {media}");

    // ── build shared frame state, hand it to the 60 Hz main-thread pump ───────
    let spike = Box::new(Spike {
        render: Cell::new(Some(render)),
        gl_ctx,
        gl_view,
        window,
        mpv_ctx: mpv_ctx_ptr,
        needs_render,
        frames: Cell::new(0),
        last_w: Cell::new(0),
        last_h: Cell::new(0),
        start: Instant::now(),
        run_secs,
        cap1_done: Cell::new(false),
        cap2_done: Cell::new(false),
        torn_down: Cell::new(false),
        logged_gl: Cell::new(false),
    });
    let spike_ptr = Box::into_raw(spike);

    unsafe {
        let mut ctx = CFRunLoopTimerContext {
            version: 0,
            info: spike_ptr as *mut c_void,
            retain: std::ptr::null(),
            release: std::ptr::null(),
            copy_description: std::ptr::null(),
        };
        let timer = CFRunLoopTimerCreate(
            std::ptr::null(),
            CFAbsoluteTimeGetCurrent(),
            1.0 / 60.0, // ~60 Hz
            0,
            0,
            pump_cb,
            &mut ctx as *mut _,
        );
        CFRunLoopAddTimer(CFRunLoopGetMain(), timer, kCFRunLoopCommonModes);
    }
    log::info!("[spike] 60 Hz main-thread frame pump installed — entering NSApp run loop");

    // Keep mpv alive across the run loop; drop after teardown.
    let mpv_keep = mpv;
    unsafe {
        let _: () = msg_send![app, run];
    }
    // run loop stopped by teardown → clean up mpv last.
    drop(mpv_keep);
    log::info!("[spike] NSApp run loop exited; mpv terminated; exiting cleanly");
    // Give the event thread a beat to observe MPV_EVENT_SHUTDOWN.
    std::thread::sleep(std::time::Duration::from_millis(150));
}

// ───────────────────── the 60 Hz main-thread render pump ──────────────────────
extern "C" fn pump_cb(_timer: CFRunLoopTimerRef, info: *mut c_void) {
    let spike = unsafe { &*(info as *const Spike) };
    if spike.torn_down.get() {
        return;
    }
    let elapsed = spike.start.elapsed().as_secs_f64();

    // Drain mpv's "new frame" signal, but pump every tick anyway (mirrors the
    // Linux finding that the update callback alone does not reliably pump).
    let _signalled = spike.needs_render.swap(false, Ordering::Relaxed);

    render_one(spike);

    // Capture #1 (early: video + overlay up) and #2 (later: motion advanced).
    if !spike.cap1_done.get() && elapsed >= 3.0 {
        spike.cap1_done.set(true);
        capture_window(spike, "composited-hevc10-under-webview-macos.png");
    }
    if !spike.cap2_done.get() && elapsed >= (spike.run_secs * 0.6) {
        spike.cap2_done.set(true);
        capture_window(spike, "composited-hevc10-under-webview-macos-late.png");
    }

    // Teardown: free render context BEFORE the GL context dies (mission rule).
    if elapsed >= spike.run_secs {
        let frames = spike.frames.get();
        let fps = frames as f64 / elapsed;
        log::info!(
            "[spike] FPS observation: {frames} render callbacks over {elapsed:.1}s = {fps:.1} fps"
        );
        spike.torn_down.set(true);

        // (1) Free the render context FIRST, while the GL context is still valid
        //     (mission teardown rule; mirrors the Linux GLArea `unrealize`).
        log::info!("[spike] teardown 1/4: freeing mpv render context (before GL context)");
        unsafe {
            let _: () = msg_send![spike.gl_ctx, makeCurrentContext];
        }
        drop(spike.render.take());
        log::info!("[spike] teardown 1/4: render context freed; GL context still valid → OK");

        // (2) Explicitly tell mpv to QUIT. CRITICAL: closing the video window /
        //     freeing the render context does NOT stop mpv playback — mpv keeps
        //     decoding and HOLDS the CoreAudio output device (+ a power assertion)
        //     until the mpv core itself is stopped. Without this, audio plays on
        //     forever (worse here with loop-file=inf). Production teardown MUST
        //     command mpv quit/stop, not just tear down the GL/view layer.
        log::info!("[spike] teardown 2/4: mpv `quit` (stops decode + releases audio device)");
        unsafe {
            libmpv2_sys::mpv_command_string(spike.mpv_ctx, b"quit\0".as_ptr() as *const c_char);
        }

        // (3) Close the window — this releases the NSOpenGLContext / GL surface.
        log::info!("[spike] teardown 3/4: closing NSWindow (releases GL context)");
        unsafe {
            let _: () = msg_send![spike.window, close];
        }

        // (4) Unwind `[NSApp run]`. NB: CFRunLoopStop does NOT make `[NSApp run]`
        //     return — AppKit's run loop ignores it. The correct sequence is
        //     `[NSApp stop:]` (arms a return-after-next-event flag) followed by a
        //     posted dummy event to wake the loop so it actually returns.
        log::info!("[spike] teardown 4/4: [NSApp stop:] + wakeup event to unwind run loop");
        unsafe {
            let app: *mut AnyObject = {
                let cls = class!(NSApplication);
                msg_send![cls, sharedApplication]
            };
            let _: () = msg_send![app, stop: std::ptr::null_mut::<AnyObject>()];
            post_wakeup_event(app);
        }
    }
}

// Post an application-defined NSEvent so `[NSApp run]` processes one more event
// and observes the `stop:` flag, returning control to main().
unsafe fn post_wakeup_event(app: *mut AnyObject) {
    const NS_EVENT_TYPE_APPLICATION_DEFINED: u64 = 15;
    let cls = class!(NSEvent);
    let ev: *mut AnyObject = msg_send![
        cls,
        otherEventWithType: NS_EVENT_TYPE_APPLICATION_DEFINED,
        location: CGPoint { x: 0.0, y: 0.0 },
        modifierFlags: 0u64,
        timestamp: 0f64,
        windowNumber: 0isize,
        context: std::ptr::null_mut::<AnyObject>(),
        subtype: 0i16,
        data1: 0isize,
        data2: 0isize,
    ];
    let _: () = msg_send![app, postEvent: ev, atStart: true];
}

fn render_one(spike: &Spike) {
    let render = match spike.render.take() {
        Some(r) => r,
        None => return,
    };
    unsafe {
        let _: () = msg_send![spike.gl_ctx, makeCurrentContext];
    }
    // Physical (backing) pixel size — HiDPI: read bounds * backingScale each frame.
    let bounds: CGRect = unsafe { msg_send![spike.gl_view, bounds] };
    let backing: CGRect = unsafe { msg_send![spike.gl_view, convertRectToBacking: bounds] };
    let w = backing.size.width as i32;
    let h = backing.size.height as i32;
    if w != spike.last_w.get() || h != spike.last_h.get() {
        spike.last_w.set(w);
        spike.last_h.set(h);
        unsafe {
            let _: () = msg_send![spike.gl_ctx, update];
        }
        log::info!("[spike] backing size now {w}x{h} px (GL context updated)");
    }

    // mpv renders into the default framebuffer (FBO 0 = the view's drawable).
    // render_no_block: never park the main loop on mpv's vo present wait.
    if let Err(e) = render.render_no_block::<()>(0, w, h, true) {
        log::error!("[spike] render_no_block failed: {e:?}");
    }
    unsafe {
        let _: () = msg_send![spike.gl_ctx, flushBuffer];
    }

    let n = spike.frames.get() + 1;
    spike.frames.set(n);
    if n <= 3 || n % 120 == 0 {
        log::info!("[spike] render frame #{n}: fbo=0 {w}x{h}");
    }
    // one-time viewport sanity log
    if !spike.logged_gl.get() && n >= 2 {
        spike.logged_gl.set(true);
        unsafe {
            let gi: GlGetIntegervFn =
                std::mem::transmute(get_proc_address(&(), "glGetIntegerv"));
            let mut fbo: i32 = -1;
            gi(0x8CA6 /* GL_FRAMEBUFFER_BINDING */, &mut fbo);
            log::info!("[spike] default framebuffer binding after render = {fbo}");
        }
    }
    spike.render.set(Some(render));
}

// ─────────────────────── window capture → evidence/*.png ──────────────────────
fn capture_window(spike: &Spike, filename: &str) {
    let win_id: isize = unsafe { msg_send![spike.window, windowNumber] };
    if win_id <= 0 {
        log::warn!("[spike] capture: windowNumber={win_id} (off-screen?) — skipping");
        return;
    }
    let out = format!("evidence/{filename}");
    log::info!("[spike] capture: window #{win_id} → {out}");

    // Primary: CGWindowListCreateImage of our OWN window (no framing).
    let img = unsafe {
        CGWindowListCreateImage(
            CGRect::null(),
            KCG_WINDOW_LIST_INCLUDING_WINDOW,
            win_id as u32,
            KCG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING | KCG_WINDOW_IMAGE_BEST_RESOLUTION,
        )
    };
    if !img.is_null() {
        if cgimage_to_png(img, &out) {
            unsafe { CFRelease(img) };
            return;
        }
        unsafe { CFRelease(img) };
    }
    log::warn!("[spike] CGWindowListCreateImage returned null/blank — trying `screencapture -l`");

    // Fallback: screencapture -l <windowid> (both may need Screen Recording perm).
    let status = std::process::Command::new("screencapture")
        .args(["-x", "-o", &format!("-l{win_id}"), &out])
        .status();
    match status {
        Ok(s) if s.success() && std::path::Path::new(&out).exists() => {
            log::info!("[spike] capture via screencapture -l succeeded → {out}");
        }
        other => {
            log::error!(
                "[spike] capture FAILED (CGWindowListCreateImage null AND screencapture {other:?}). \
                 Likely Screen Recording permission not granted to the terminal. \
                 Composition is still visible on-screen; grant permission and re-run to capture."
            );
        }
    }
}

fn cgimage_to_png(img: CGImageRef, out: &str) -> bool {
    unsafe {
        let w = CGImageGetWidth(img);
        let h = CGImageGetHeight(img);
        let bpr = CGImageGetBytesPerRow(img);
        let bpp = CGImageGetBitsPerPixel(img);
        if w == 0 || h == 0 || bpp != 32 {
            log::warn!("[spike] cgimage_to_png: unexpected image {w}x{h} bpp={bpp}");
            return false;
        }
        let provider = CGImageGetDataProvider(img);
        let data = CGDataProviderCopyData(provider);
        if data.is_null() {
            return false;
        }
        let ptr = CFDataGetBytePtr(data);
        let len = CFDataGetLength(data) as usize;
        if ptr.is_null() || len < bpr * h {
            CFRelease(data);
            return false;
        }
        // CGWindowListCreateImage yields BGRA (little-endian ARGB), premultiplied.
        let mut rgba = vec![0u8; w * h * 4];
        let mut nonzero = 0u64;
        for y in 0..h {
            let row = std::slice::from_raw_parts(ptr.add(y * bpr), bpr);
            for x in 0..w {
                let s = x * 4;
                let b = row[s];
                let g = row[s + 1];
                let r = row[s + 2];
                let a = row[s + 3];
                let d = (y * w + x) * 4;
                rgba[d] = r;
                rgba[d + 1] = g;
                rgba[d + 2] = b;
                rgba[d + 3] = a;
                if r as u64 + g as u64 + b as u64 > 0 {
                    nonzero += 1;
                }
            }
        }
        CFRelease(data);
        // Guard against an all-black capture (permission-denied often yields black).
        let frac = nonzero as f64 / (w * h) as f64;
        if frac < 0.01 {
            log::warn!("[spike] cgimage_to_png: image is ~all black ({:.3}% non-zero) — treating as blank", frac * 100.0);
            return false;
        }
        match image::save_buffer(
            out,
            &rgba,
            w as u32,
            h as u32,
            image::ExtendedColorType::Rgba8,
        ) {
            Ok(()) => {
                log::info!(
                    "[spike] wrote {out} ({w}x{h}, {:.1}% non-black pixels)",
                    frac * 100.0
                );
                true
            }
            Err(e) => {
                log::error!("[spike] PNG encode failed: {e}");
                false
            }
        }
    }
}

// ───────────────────── mpv event/log-message pump (own thread) ─────────────────
fn spawn_event_thread(ctx_addr: usize) {
    std::thread::spawn(move || {
        let ctx = ctx_addr as *mut libmpv2_sys::mpv_handle;
        loop {
            let ev = unsafe { &*libmpv2_sys::mpv_wait_event(ctx, 1.0) };
            match ev.event_id {
                libmpv2_sys::mpv_event_id_MPV_EVENT_LOG_MESSAGE => {
                    let m = unsafe {
                        &*(ev.data as *const libmpv2_sys::mpv_event_log_message)
                    };
                    let prefix = unsafe { CStr::from_ptr(m.prefix) }.to_string_lossy();
                    let level = unsafe { CStr::from_ptr(m.level) }.to_string_lossy();
                    let text = unsafe { CStr::from_ptr(m.text) }.to_string_lossy();
                    let text = text.trim_end();
                    // Raw mpv line (evidence). Flag hwdec/videotoolbox lines loudly.
                    if text.contains("videotoolbox")
                        || text.contains("hwdec")
                        || text.contains("Using hardware decoding")
                    {
                        log::info!("[mpv/HWDEC] {prefix} {level}: {text}");
                    } else {
                        println!("[mpv] {prefix} {level}: {text}");
                    }
                }
                libmpv2_sys::mpv_event_id_MPV_EVENT_SHUTDOWN => {
                    log::info!("[spike] event thread saw MPV_EVENT_SHUTDOWN — exiting");
                    break;
                }
                _ => {}
            }
        }
    });
}

// Transparent HTML overlay — proves true alpha compositing of WKWebView over mpv.
const OVERLAY_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    font-family:-apple-system,system-ui,sans-serif;color:#fff;-webkit-user-select:none}
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
    backdrop-filter:blur(3px);text-shadow:0 2px 6px rgba(0,0,0,.9)}
  .ctrl{position:fixed;bottom:0;left:0;right:0;height:88px;padding:0 24px;
    display:flex;flex-direction:column;justify-content:center;gap:12px;
    background:linear-gradient(to top,rgba(0,0,0,.75),rgba(0,0,0,0))}
  .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.3)}
  .fill{height:6px;width:38%;border-radius:3px;background:#e5532f}
  .row{display:flex;align-items:center;gap:16px;font-size:14px}
  .play{width:34px;height:34px;border-radius:50%;background:#fff;color:#111;
    display:flex;align-items:center;justify-content:center;font-size:16px}
</style></head><body>
  <div class="topbar"><span class="dot"></span>PREXU — WKWebView overlay (transparent, drawsBackground=NO)</div>
  <div class="center"><div class="badge">↑ WKWebView (alpha) &nbsp;·&nbsp; mpv video below ↓</div></div>
  <div class="ctrl">
    <div class="bar"><div class="fill"></div></div>
    <div class="row"><div class="play">▶</div><span>00:04 / 00:20</span>
      <span style="margin-left:auto">mpv render API · VideoToolbox · macOS</span></div>
  </div>
</body></html>"#;
