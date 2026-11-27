//! AppKit render-API backend. All view, GL and RenderContext ownership stays on
//! the main thread; mpv's update callback only sets an atomic flag.
use std::cell::RefCell;
use std::ffi::{c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2::Mpv;
use objc2::encode::{Encode, Encoding};
use objc2::runtime::AnyObject;
use objc2::{class, msg_send, MainThreadMarker};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect {
    origin: Point,
    size: Size,
}
unsafe impl Encode for Point {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for Size {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for Rect {
    const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]);
}

#[repr(C)]
struct TimerContext {
    version: isize,
    info: *mut c_void,
    retain: *const c_void,
    release: *const c_void,
    copy_description: *const c_void,
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRunLoopGetMain() -> *mut c_void;
    fn CFRunLoopAddTimer(rl: *mut c_void, timer: *mut c_void, mode: *const c_void);
    fn CFRunLoopTimerInvalidate(timer: *mut c_void);
    fn CFRelease(value: *const c_void);
    fn CFAbsoluteTimeGetCurrent() -> f64;
    fn CFRunLoopTimerCreate(
        allocator: *const c_void,
        date: f64,
        interval: f64,
        flags: usize,
        order: isize,
        callback: extern "C" fn(*mut c_void, *mut c_void),
        context: *mut TimerContext,
    ) -> *mut c_void;
    static kCFRunLoopCommonModes: *const c_void;
}
#[link(name = "OpenGL", kind = "framework")]
unsafe extern "C" {
    fn glGetString(name: u32) -> *const u8;
}

static FAILURE: Mutex<Option<String>> = Mutex::new(None);
static INSTALLED: AtomicBool = AtomicBool::new(false);
thread_local! {
    static COMPOSITOR: RefCell<Option<Compositor>> = const { RefCell::new(None) };
}

struct Compositor {
    app: AppHandle,
    view: *mut AnyObject, // retained NSOpenGLView; owns its GL context
    context: *mut AnyObject,
    render: Option<RenderContext>,
    mpv: Option<Arc<Mpv>>, // released only after render
    dirty: Arc<AtomicBool>,
    timer: *mut c_void,
    dimensions: Option<(i32, i32)>,
    frames: u64,
    fullscreen: Option<bool>,
}

pub fn engine_failure_reason() -> Option<String> {
    FAILURE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .or_else(|| {
            (!INSTALLED.load(Ordering::Acquire)).then(|| "macOS compositor is not installed".into())
        })
}
fn failed(app: &AppHandle, reason: String) {
    log::error!("[player:macos] {reason}");
    *FAILURE.lock().unwrap_or_else(|e| e.into_inner()) = Some(reason.clone());
    let _ = app.emit("player://engine-failed", reason);
}

fn get_proc_address(_: &(), name: &str) -> *mut c_void {
    let Ok(name) = CString::new(name) else {
        return std::ptr::null_mut();
    };
    // OpenGL is linked above. RTLD_DEFAULT resolves its exported GL symbols.
    unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) }
}

/// Called from Tauri setup on the AppKit thread, before playback is possible.
pub fn install(window: &WebviewWindow, app: AppHandle) {
    // libmpv is weak-linked so dyld can launch the HTML5 app without it.
    // Use dlsym instead of testing a Rust function pointer (which Rust assumes
    // is non-null). ensure_init also checks this recorded failure before mpv.
    // SAFETY: the symbol name is NUL-terminated; no pointer is dereferenced.
    if unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"mpv_create".as_ptr()) }.is_null() {
        failed(&app, "libmpv is unavailable; using HTML5 playback".into());
        return;
    }
    if MainThreadMarker::new().is_none() {
        failed(
            &app,
            "Compositor installation requires the AppKit thread".into(),
        );
        return;
    }
    let result = (|| -> Result<Compositor, String> {
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
        // SAFETY: ns_window is Tauri's live NSWindow, and this is the main thread.
        unsafe {
            let content: *mut AnyObject = msg_send![ns_window, contentView];
            let bounds: Rect = msg_send![content, bounds];
            let attrs: [u32; 12] = [99, 0x3200, 5, 73, 96, 8, 24, 11, 8, 12, 0, 0];
            let format: *mut AnyObject = msg_send![class!(NSOpenGLPixelFormat), alloc];
            let format: *mut AnyObject = msg_send![format, initWithAttributes: attrs.as_ptr()];
            if format.is_null() {
                return Err("No accelerated OpenGL 3.2 core pixel format".into());
            }
            let view: *mut AnyObject = msg_send![class!(NSOpenGLView), alloc];
            let view: *mut AnyObject = msg_send![view, initWithFrame: bounds, pixelFormat: format];
            let _: () = msg_send![format, release];
            if view.is_null() {
                return Err("NSOpenGLView initialization failed".into());
            }
            let context: *mut AnyObject = msg_send![view, openGLContext];
            if context.is_null() {
                let _: () = msg_send![view, release];
                return Err("NSOpenGLContext initialization failed".into());
            }
            let _: () = msg_send![view, setWantsBestResolutionOpenGLSurface: true];
            let _: () = msg_send![view, setAutoresizingMask: 18usize];
            let _: () = msg_send![content, setWantsLayer: true];
            // NSWindowBelow with nil relativeTo places video below all existing
            // subviews, including wry's WKWebView (without reparenting it).
            let _: () = msg_send![content, addSubview: view, positioned: -1isize,
                relativeTo: std::ptr::null_mut::<AnyObject>()];
            let _: () = msg_send![view, setHidden: true];
            Ok(Compositor {
                app: app.clone(),
                view,
                context,
                render: None,
                mpv: None,
                dirty: Arc::new(AtomicBool::new(false)),
                timer: std::ptr::null_mut(),
                dimensions: None,
                frames: 0,
                fullscreen: None,
            })
        }
    })();
    match result {
        Ok(comp) => {
            COMPOSITOR.with(|slot| *slot.borrow_mut() = Some(comp));
            INSTALLED.store(true, Ordering::Release);
            log::info!("[player:macos] compositor installed");
        }
        Err(reason) => failed(&app, reason),
    }
}

/// Marshal a synchronous operation without waiting on the main thread itself.
fn on_main(
    app: &AppHandle,
    op: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    if MainThreadMarker::new().is_some() {
        return op();
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(op());
    })
    .map_err(|e| format!("Cannot dispatch compositor operation: {e}"))?;
    rx.recv()
        .map_err(|_| "Compositor operation was cancelled".to_string())?
}

/// Apply the inset in AppKit logical points, before reporting the transition ready.
pub(crate) fn apply_margins_now(app: &AppHandle) -> Result<(), String> {
    on_main(app, || COMPOSITOR.with(|slot| {
        let slot = slot.try_borrow().map_err(|_| "macOS compositor is busy")?;
        slot.as_ref().ok_or("macOS compositor is not installed")?.apply_margins()
    }))
}

pub fn attach_mpv(app: &AppHandle, mpv: Arc<Mpv>) -> Result<(), String> {
    let result = on_main(app, move || {
        COMPOSITOR.with(|slot| {
            let mut slot = slot.borrow_mut();
            let comp = slot.as_mut().ok_or("macOS compositor is not installed")?;
            comp.detach();
            unsafe {
                let _: () = msg_send![comp.view, setHidden: false];
                let _: () = msg_send![comp.context, makeCurrentContext];
                let renderer = glGetString(0x1F01);
                if !renderer.is_null() {
                    log::info!(
                        "[player:macos] GL_RENDERER={}",
                        CStr::from_ptr(renderer.cast()).to_string_lossy()
                    );
                }
            }
            let mut render = RenderContext::new(
                unsafe { &mut *mpv.ctx.as_ptr() },
                vec![
                    RenderParam::ApiType(RenderParamApiType::OpenGl),
                    RenderParam::InitParams(OpenGLInitParams {
                        get_proc_address,
                        ctx: (),
                    }),
                ],
            )
            .map_err(|e| format!("mpv render context creation failed: {e}"))?;
            let dirty = Arc::clone(&comp.dirty);
            render.set_update_callback(move || dirty.store(true, Ordering::Release));
            comp.mpv = Some(mpv);
            comp.render = Some(render);
            comp.dirty.store(true, Ordering::Release);
            unsafe {
                let mut context = TimerContext {
                    version: 0,
                    info: std::ptr::null_mut(),
                    retain: std::ptr::null(),
                    release: std::ptr::null(),
                    copy_description: std::ptr::null(),
                };
                comp.timer = CFRunLoopTimerCreate(
                    std::ptr::null(),
                    CFAbsoluteTimeGetCurrent(),
                    1.0 / 60.0,
                    0,
                    0,
                    pump,
                    &mut context,
                );
                if comp.timer.is_null() {
                    comp.detach();
                    return Err("Frame timer creation failed".into());
                }
                CFRunLoopAddTimer(CFRunLoopGetMain(), comp.timer, kCFRunLoopCommonModes);
            }
            log::info!("[player:macos] render context attached; frame pump started");
            Ok(())
        })
    });
    if let Err(reason) = &result {
        failed(app, reason.clone());
    }
    result
}

pub fn detach_mpv(app: &AppHandle) {
    if let Err(reason) = on_main(app, || {
        COMPOSITOR.with(|slot| {
            if let Some(comp) = slot.borrow_mut().as_mut() {
                comp.detach();
            }
        });
        Ok(())
    }) {
        failed(app, reason);
    }
}

/// Call at close request, while NSWindow and its GL drawable still exist.
pub fn shutdown(app: &AppHandle) {
    if let Err(reason) = on_main(app, || {
        COMPOSITOR.with(|slot| {
            slot.borrow_mut().take();
        });
        INSTALLED.store(false, Ordering::Release);
        Ok(())
    }) {
        failed(app, reason);
    }
}

extern "C" fn pump(_: *mut c_void, _: *mut c_void) {
    COMPOSITOR.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        let Some(comp) = slot.as_mut() else { return };
        if let Err(reason) = comp.frame() {
            failed(&comp.app, reason);
            comp.detach();
        }
    });
}

impl Compositor {
    fn apply_margins(&self) -> Result<(), String> {
        let mpv = self.mpv.as_ref().ok_or("macOS player is not attached")?;
        let bounds: Rect = unsafe { msg_send![self.view, bounds] };
        let ratios = self.app.state::<super::PlayerState>()
            .margin_ratios(bounds.size.width as i32, bounds.size.height as i32)
            .unwrap_or((0.0, 0.0, 0.0, 0.0));
        let (left, right, top, bottom) = ratios;
        for (name, value) in [
            ("video-margin-ratio-left", left), ("video-margin-ratio-right", right),
            ("video-margin-ratio-top", top), ("video-margin-ratio-bottom", bottom),
        ] {
            mpv.set_property(name, value).map_err(|e| format!("{name}: {e}"))?;
        }
        let normal = ratios == (0.0, 0.0, 0.0, 0.0);
        let scale = if normal { 1.0 } else { (1.0 - top - bottom).clamp(0.01, 1.0) };
        mpv.set_property("sub-scale", scale).map_err(|e| e.to_string())?;
        mpv.set_property("sub-use-margins", normal).map_err(|e| e.to_string())?;
        self.dirty.store(true, Ordering::Release);
        log::debug!("[player:cmd] macOS margins {ratios:?}, logical size {}x{}", bounds.size.width, bounds.size.height);
        Ok(())
    }

    fn frame(&mut self) -> Result<(), String> {
        // Observe AppKit rather than assuming set_fullscreen completed inline.
        // This also catches native green-button and Escape transitions.
        let window: *mut AnyObject = unsafe { msg_send![self.view, window] };
        if !window.is_null() {
            let style: usize = unsafe { msg_send![window, styleMask] };
            let fullscreen = style & (1 << 14) != 0; // NSWindowStyleMaskFullScreen
            if self.fullscreen != Some(fullscreen) {
                self.fullscreen = Some(fullscreen);
                log::info!("[player:cmd] macOS native fullscreen actual={fullscreen}");
                let _ = self.app.emit("player://fullscreen", fullscreen);
            }
        }

        let Some(render) = &self.render else {
            return Ok(());
        };
        let backing: Rect = unsafe {
            let bounds: Rect = msg_send![self.view, bounds];
            msg_send![self.view, convertRectToBacking: bounds]
        };
        let Some(size) =
            super::macos_render_math::drawable_size(backing.size.width, backing.size.height)
        else {
            return Ok(());
        };
        let resized = self.dimensions != Some(size);
        if resized {
            self.apply_margins()?;
        }
        if !self.dirty.swap(false, Ordering::AcqRel) && !resized {
            return Ok(());
        }
        unsafe {
            let _: () = msg_send![self.context, makeCurrentContext];
            if resized {
                let _: () = msg_send![self.context, update];
                log::debug!("[player:macos] backing resize {}x{}", size.0, size.1);
            }
        }
        render
            .render_no_block::<()>(0, size.0, size.1, true)
            .map_err(|e| format!("Frame render failed: {e}"))?;
        unsafe {
            let _: () = msg_send![self.context, flushBuffer];
        }
        self.dimensions = Some(size);
        self.frames += 1;
        log::trace!("[player:macos] rendered frame {}", self.frames);
        Ok(())
    }
    fn detach(&mut self) {
        self.fullscreen = None;
        unsafe {
            if !self.timer.is_null() {
                CFRunLoopTimerInvalidate(self.timer);
                CFRelease(self.timer);
                self.timer = std::ptr::null_mut();
            }
            let _: () = msg_send![self.context, makeCurrentContext];
            drop(self.render.take());
            // The retained mpv core must outlive its render context.
            self.mpv.take();
            let _: () = msg_send![self.view, setHidden: true];
        }
        self.dirty.store(false, Ordering::Release);
        self.dimensions = None;
        log::debug!(
            "[player:macos] detached after {} frames; render freed before GL",
            self.frames
        );
        self.frames = 0;
    }
}
impl Drop for Compositor {
    fn drop(&mut self) {
        self.detach();
        unsafe {
            let _: () = msg_send![class!(NSOpenGLContext), clearCurrentContext];
            let _: () = msg_send![self.context, clearDrawable];
            let _: () = msg_send![self.view, removeFromSuperview];
            let _: () = msg_send![self.view, release];
        }
    }
}
