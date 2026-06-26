//! Path C3c (prexu-60mz.3): host the main window's WebView2 as a
//! DirectComposition visual so the React UI can be composited *above* the mpv
//! video visual on a single HWND (Alt+Tab / capture parity, no black tile).
//!
//! Composition is the unconditional render path on Windows (C3h, prexu-kcmg;
//! the legacy WS_POPUP host was removed by prexu-zfyi). Two halves:
//!   1. [`request_hosting`] — called once before the `main` window is built,
//!      flips the vendored-wry opt-in so its WebView2 is created via
//!      `CreateCoreWebView2CompositionController` instead of windowed mode.
//!   2. [`install`] — called from inside `with_webview` once the window exists,
//!      builds the DComp device + target on the main HWND, creates the webview
//!      visual, and `SetRootVisualTarget`s the composition controller into it.
//!
//! The mpv *video* visual sits below the webview (C3d, prexu-60mz.4); the webview
//! is transparent where the React app doesn't paint, so the video shows through.
#![cfg(target_os = "windows")]

use std::cell::RefCell;

use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{AcceleratorKeyPressedEventHandler, CursorChangedEventHandler};
use windows::core::{w, Interface, PCWSTR};
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11Texture2D, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionScaleTransform,
    IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::{IDXGIDevice, IDXGISwapChain1};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, GetClientRect, LoadCursorW, SetCursor, HCURSOR, HTCLIENT, IDC_ARROW,
    WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_MBUTTONDBLCLK, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL,
    WM_NCDESTROY, WM_RBUTTONDBLCLK, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SETCURSOR, WM_XBUTTONDBLCLK,
    WM_XBUTTONDOWN, WM_XBUTTONUP,
};

thread_local! {
    /// Keeps the DComp tree (device/target/visual) alive for the process
    /// lifetime. Created and only ever touched on the main/UI thread, so a
    /// thread-local is the correct owner for these apartment-threaded COM
    /// objects (they are not `Send`, so they cannot live in Tauri state).
    static HOST: RefCell<Option<CompositionHost>> = const { RefCell::new(None) };

    /// Last cursor the webview asked for (raw HCURSOR as isize; 0 == hidden,
    /// e.g. CSS `cursor: none`). Written by the CursorChanged event the instant
    /// the page changes its cursor, read by WM_SETCURSOR. Decoupling these is
    /// what makes the cursor restore correctly after the player hides it —
    /// WM_SETCURSOR alone lags the page's async cursor changes by a move.
    static CURSOR: std::cell::Cell<isize> = const { std::cell::Cell::new(0) };

    /// The composition webview's controller, stashed on `install` so later
    /// events can reach it: DPI changes re-apply the rasterization scale (C4c)
    /// and window moves reposition the IME candidate window (C4b). Apartment-
    /// threaded COM, main-thread only — same reason as HOST that it lives in a
    /// thread-local rather than Tauri state (it is not `Send`).
    static CONTROLLER: RefCell<Option<ICoreWebView2Controller>> = const { RefCell::new(None) };

    /// The video swapchain's actual pixel size — what the render thread last
    /// rebuilt it to. The DComp video visual is scaled by dest/actual so a
    /// grow fills the inset immediately, before the async swapchain rebuild
    /// lands (prexu-bgjd). Main-thread only.
    static VIDEO_ACTUAL: std::cell::Cell<(u32, u32)> = const { std::cell::Cell::new((1, 1)) };

    /// The desired video inset rect `(off_x, off_y, dest_w, dest_h)` in client
    /// px, last requested by the geometry path. Paired with VIDEO_ACTUAL to
    /// compute the stretch scale. Main-thread only.
    static VIDEO_DEST: std::cell::Cell<(i32, i32, u32, u32)> =
        const { std::cell::Cell::new((0, 0, 1, 1)) };
}

struct CompositionHost {
    // Held only to keep the COM tree alive; ordering of drop is irrelevant here
    // because the window outlives the process teardown that matters.
    _d3d: ID3D11Device,
    _device: IDCompositionDevice,
    _target: IDCompositionTarget,
    _root_visual: IDCompositionVisual,
    _webview_visual: IDCompositionVisual,
    // C3d Inc2: the video visual sits *below* the webview. Its content is the
    // composition swapchain that the mpv render thread (Inc3) presents into. The
    // shared texture + its handle are mpv's draw target (ANGLE imports the handle
    // as a GL FBO); kept alive here, consumed by the render thread in Inc3.
    _video_visual: IDCompositionVisual,
    _video_swapchain: IDXGISwapChain1,
    _shared_tex: ID3D11Texture2D,
    _share_handle: HANDLE,
    // prexu-bgjd: scale transform on the video visual, mutated by
    // `set_video_dest` / `set_video_size` to stretch the swapchain to the inset.
    video_scale: IDCompositionScaleTransform,
}

/// Flip the vendored-wry opt-in so the next top-level webview built on this
/// thread (the `main` window) is composition-hosted. Must run before Tauri
/// builds that window — i.e. before `Builder::run`.
pub fn request_hosting() {
    log::info!("[player:comp] requesting composition hosting for main webview");
    wry::set_pending_composition_hosting(true);
}

/// Build the DComp tree on `hwnd` and hook `controller`'s pixels into it.
///
/// MUST run on the main/UI thread (call from inside `WebviewWindow::with_webview`).
/// `controller` must be the composition controller that [`request_hosting`]
/// caused wry to create; the cast fails for a windowed controller.
pub fn install(hwnd: HWND, controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
    let composition: ICoreWebView2CompositionController = controller.cast()?;

    // C4 (prexu-0oc3): re-apply the parity windowed WebView2 gave for free but
    // visual hosting drops. Stash the controller first so later DPI events (C4c)
    // and window moves (C4b) can reach it, then configure the one-shot settings.
    CONTROLLER.with(|c| *c.borrow_mut() = Some(controller.clone()));
    configure_controller_parity(hwnd, controller);

    let d3d = create_d3d11_device()?;
    let dxgi: IDXGIDevice = d3d.cast()?;
    let device: IDCompositionDevice = unsafe { DCompositionCreateDevice(Some(&dxgi))? };
    let target: IDCompositionTarget = unsafe { device.CreateTargetForHwnd(hwnd, true)? };

    // C3d Inc2: one DComp tree — root -> [ video (bottom), webview (top) ].
    // The webview is transparent where the React app doesn't paint, so the mpv
    // video visual below shows through. (Inc3 drives mpv into the swapchain.)
    let root_visual: IDCompositionVisual = unsafe { device.CreateVisual()? };
    let video_visual: IDCompositionVisual = unsafe { device.CreateVisual()? };
    let webview_visual: IDCompositionVisual = unsafe { device.CreateVisual()? };

    // Size the video surfaces to the window's current client area. Inc4 resizes
    // them on WM_SIZE; Inc2 just needs a valid swapchain to attach.
    let (width, height) = client_size(hwnd);
    let (shared_tex, share_handle) =
        crate::player::video_render::create_shared_texture(&d3d, width, height)?;
    let video_swapchain =
        crate::player::video_render::create_video_swapchain(&d3d, width, height)?;
    unsafe { video_visual.SetContent(&video_swapchain)? };

    // prexu-bgjd: a scale transform on the video visual lets the geometry path
    // stretch the current swapchain to fill a grown inset before the async
    // rebuild lands (`set_video_dest` sets scale = dest/actual; identity here).
    // Center (0,0) scales from the visual's top-left, which `SetOffsetX2/Y2`
    // pins to the inset corner.
    let video_scale = unsafe { device.CreateScaleTransform()? };
    unsafe {
        video_scale.SetCenterX2(0.0)?;
        video_scale.SetCenterY2(0.0)?;
        video_scale.SetScaleX2(1.0)?;
        video_scale.SetScaleY2(1.0)?;
        video_visual.SetTransform(&video_scale)?;
    }
    VIDEO_ACTUAL.with(|a| a.set((width, height)));
    VIDEO_DEST.with(|d| d.set((0, 0, width, height)));

    unsafe { root_visual.AddVisual(&video_visual, true, None)? }; // video at bottom
    unsafe { root_visual.AddVisual(&webview_visual, true, &video_visual)? }; // webview above
    unsafe { target.SetRoot(&root_visual)? };
    unsafe { composition.SetRootVisualTarget(&webview_visual)? };
    unsafe { device.Commit()? };

    log::info!(
        "[player:comp] DComp tree committed on HWND={:?}; root -> [video({}x{}), webview]",
        hwnd.0,
        width,
        height
    );

    // Composition-hosted webviews receive NO input automatically (windowed mode
    // got it free via the WebView2 child HWND). Forward mouse + cursor from
    // wry's container child to the composition controller. Keyboard/IME is C4.
    install_input_forwarding(hwnd, &composition);
    subscribe_cursor_changed(&composition);

    // Hand the GPU surfaces to the (later-spawned) mpv render thread. Clones
    // share the underlying COM objects by refcount; the originals stay here to
    // keep the DComp tree alive. Inc4 claims these in `ensure_init`.
    crate::player::video_render::publish_surfaces(crate::player::video_render::VideoSurfaces {
        device: d3d.clone(),
        swapchain: video_swapchain.clone(),
        shared_tex: shared_tex.clone(),
        share_handle,
        width,
        height,
    });

    HOST.with(|h| {
        *h.borrow_mut() = Some(CompositionHost {
            _d3d: d3d,
            _device: device,
            _target: target,
            _root_visual: root_visual,
            _webview_visual: webview_visual,
            _video_visual: video_visual,
            _video_swapchain: video_swapchain,
            _shared_tex: shared_tex,
            _share_handle: share_handle,
            video_scale,
        });
    });
    Ok(())
}

// ── C4 controller parity (prexu-0oc3): re-add windowed WebView2 freebies ──────

/// Apply the one-shot controller settings that windowed WebView2 provided for
/// free but DirectComposition visual hosting drops: HiDPI rasterization scale
/// (C4c), external file-drop rejection (C4d), and Ctrl+P print suppression
/// (C4e). Runs once from [`install`] on the main/UI thread.
fn configure_controller_parity(hwnd: HWND, controller: &ICoreWebView2Controller) {
    // C4c (prexu-od2n): windowed WebView2 tracked monitor DPI for free; the
    // visual-hosted controller renders at scale 1.0 by default, so text is soft
    // on a >100% monitor. Pin the rasterization scale to the window's DPI and
    // ask WebView2 to follow monitor changes; `set_rasterization_scale`
    // additionally re-applies it from the player's scale-factor handler.
    match controller.cast::<ICoreWebView2Controller3>() {
        Ok(c3) => {
            let scale = dpi_scale(hwnd);
            unsafe {
                if let Err(e) = c3.SetShouldDetectMonitorScaleChanges(true) {
                    log::warn!(
                        "[player:comp] SetShouldDetectMonitorScaleChanges failed: {:?}",
                        e
                    );
                }
                match c3.SetRasterizationScale(scale) {
                    Ok(()) => log::info!(
                        "[player:comp] rasterization scale set to {:.3} (C4c)",
                        scale
                    ),
                    Err(e) => log::warn!(
                        "[player:comp] SetRasterizationScale({:.3}) failed: {:?}",
                        scale,
                        e
                    ),
                }
            }
        }
        Err(e) => log::warn!(
            "[player:comp] ICoreWebView2Controller3 unavailable; HiDPI scale not set (C4c): {:?}",
            e
        ),
    }

    // C4d (prexu-jc8x): Prexu accepts no file drops. Under composition an
    // external drop would otherwise be accepted by the webview and navigate it
    // away from the app; disabling it makes the OS show the no-drop cursor and
    // dropped files do nothing.
    match controller.cast::<ICoreWebView2Controller4>() {
        Ok(c4) => match unsafe { c4.SetAllowExternalDrop(false) } {
            Ok(()) => log::info!("[player:comp] external file drop disabled (C4d)"),
            Err(e) => log::warn!("[player:comp] SetAllowExternalDrop(false) failed: {:?}", e),
        },
        Err(e) => log::warn!(
            "[player:comp] ICoreWebView2Controller4 unavailable; external drop not disabled (C4d): {:?}",
            e
        ),
    }

    // C4e (prexu-yd7e): swallow Ctrl+P so WebView2's print dialog never opens.
    // A surgical accelerator filter, not `AreBrowserAcceleratorKeysEnabled(false)`
    // — that would also disable F5/Ctrl+R reload and Ctrl+F find, which we keep.
    install_print_suppressor(controller);
}

/// DPI scale of `hwnd`'s monitor (1.0 == 96 DPI / 100%); 1.0 if the query fails.
fn dpi_scale(hwnd: HWND) -> f64 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        log::warn!("[player:comp] GetDpiForWindow returned 0; defaulting scale to 1.0");
        1.0
    } else {
        dpi as f64 / 96.0
    }
}

/// C4e: register an `AcceleratorKeyPressed` filter that marks Ctrl+P handled,
/// preventing the WebView2 print dialog. Only Ctrl+P is intercepted; all other
/// accelerators (reload, find) pass through untouched.
fn install_print_suppressor(controller: &ICoreWebView2Controller) {
    const VK_P: u32 = 0x50;
    const VK_CONTROL: i32 = 0x11;
    let handler = AcceleratorKeyPressedEventHandler::create(Box::new(
        move |_sender, args: Option<ICoreWebView2AcceleratorKeyPressedEventArgs>| {
            if let Some(args) = args {
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                let mut vk = 0u32;
                unsafe {
                    let _ = args.KeyEventKind(&mut kind);
                    let _ = args.VirtualKey(&mut vk);
                }
                let is_down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
                // High bit of GetKeyState == key currently down.
                let ctrl_down = (unsafe { GetKeyState(VK_CONTROL) }) < 0;
                if is_down && vk == VK_P && ctrl_down {
                    match unsafe { args.SetHandled(true) } {
                        Ok(()) => {
                            log::debug!("[player:comp] swallowed Ctrl+P (print disabled, C4e)")
                        }
                        Err(e) => log::warn!("[player:comp] SetHandled(Ctrl+P) failed: {:?}", e),
                    }
                }
            }
            Ok(())
        },
    ));
    let mut token = 0i64;
    match unsafe { controller.add_AcceleratorKeyPressed(&handler, &mut token) } {
        Ok(()) => log::info!("[player:comp] Ctrl+P print suppressor installed (C4e)"),
        Err(e) => log::error!("[player:comp] add_AcceleratorKeyPressed failed: {:?}", e),
    }
}

/// C4c: re-apply the rasterization scale after a DPI / monitor-scale change so
/// the webview stays crisp when moved between monitors of differing DPI. Called
/// from the player's scale-factor handler. No-op until composition is installed.
pub fn set_rasterization_scale(scale: f64) {
    CONTROLLER.with(|c| {
        if let Some(controller) = c.borrow().as_ref() {
            if let Ok(c3) = controller.cast::<ICoreWebView2Controller3>() {
                match unsafe { c3.SetRasterizationScale(scale) } {
                    Ok(()) => {
                        log::debug!("[player:comp] rasterization scale -> {:.3} (C4c)", scale)
                    }
                    Err(e) => log::warn!(
                        "[player:comp] SetRasterizationScale({:.3}) failed: {:?}",
                        scale,
                        e
                    ),
                }
            }
        }
    });
}

/// C4b: notify the composition-hosted webview that its parent window moved, so
/// it repositions OS-owned popups — chiefly the IME candidate window, which
/// otherwise sticks at its install-time screen position under visual hosting.
/// Called on every window move/origin change. No-op until composition is
/// installed.
pub fn notify_window_moved() {
    CONTROLLER.with(|c| {
        if let Some(controller) = c.borrow().as_ref() {
            if let Err(e) = unsafe { controller.NotifyParentWindowPositionChanged() } {
                log::trace!(
                    "[player:comp] NotifyParentWindowPositionChanged failed: {:?}",
                    e
                );
            }
        }
    });
}

/// Apply the current `VIDEO_DEST` rect to the video visual: offset to the inset
/// corner and scale the swapchain content by `dest/actual` so it fills the inset
/// even while the async swapchain rebuild is still in flight (prexu-bgjd).
fn apply_video_transform(host: &CompositionHost) {
    let (off_x, off_y, dest_w, dest_h) = VIDEO_DEST.with(|d| d.get());
    let (act_w, act_h) = VIDEO_ACTUAL.with(|a| a.get());
    // Clamp scale to >= 1: only ever stretch the swapchain UP to fill a grown
    // inset. On shrink the (still-larger) swapchain over-covers the smaller
    // pane and the opaque React UI masks the excess — scaling it DOWN to the
    // pane instead would risk a momentary under-fill that shows the transparent
    // window through (prexu-bgjd). The render thread rebuilds to the exact size
    // shortly after, returning the scale to 1 either way.
    let sx = (dest_w as f32 / act_w.max(1) as f32).max(1.0);
    let sy = (dest_h as f32 / act_h.max(1) as f32).max(1.0);
    unsafe {
        let _ = host._video_visual.SetOffsetX2(off_x as f32);
        let _ = host._video_visual.SetOffsetY2(off_y as f32);
        let _ = host.video_scale.SetScaleX2(sx);
        let _ = host.video_scale.SetScaleY2(sy);
        if let Err(e) = host._device.Commit() {
            log::warn!("[player:comp] video transform commit failed: {:?}", e);
        }
    }
}

/// Position AND size the video DComp visual to the inset rect
/// `(off_x, off_y, dest_w x dest_h)` in client pixels — `(0,0,full,full)` is
/// full-window video, a corner sub-rect is the mini player. The swapchain is
/// rebuilt to `dest` ASYNCHRONOUSLY by the render thread; until that lands, a
/// scale transform stretches the current swapchain to fill `dest`, so growing
/// the mini player never exposes the app behind the pane (prexu-bgjd). When the
/// render thread reports the rebuilt size via [`set_video_size`], the scale
/// snaps back to 1:1 (crisp). MUST run on the main/UI thread (the DComp device
/// is apartment-threaded); callers guarantee that. No-op if composition isn't
/// installed.
pub fn set_video_dest(off_x: i32, off_y: i32, dest_w: u32, dest_h: u32) {
    VIDEO_DEST.with(|d| d.set((off_x, off_y, dest_w.max(1), dest_h.max(1))));
    HOST.with(|h| {
        if let Some(host) = h.borrow().as_ref() {
            apply_video_transform(host);
        }
    });
    log::trace!("[player:comp] video dest -> ({off_x},{off_y}) {dest_w}x{dest_h}");
}

/// Report the render thread's newly-rebuilt swapchain size (prexu-bgjd).
/// Dispatched to the main thread after `resize_surfaces` settles so the stretch
/// transform set by [`set_video_dest`] collapses back to 1:1 now that the
/// swapchain matches the inset. No-op if composition isn't installed.
pub fn set_video_size(w: u32, h: u32) {
    VIDEO_ACTUAL.with(|a| a.set((w.max(1), h.max(1))));
    HOST.with(|h| {
        if let Some(host) = h.borrow().as_ref() {
            apply_video_transform(host);
        }
    });
    log::trace!("[player:comp] video swapchain size -> {w}x{h}");
}

/// Force a DirectComposition recomposite of the current tree. MUST run on the
/// main/UI thread (the DComp device is apartment-threaded); callers guarantee
/// that via `run_on_main_thread`. No-op if composition isn't installed.
///
/// prexu-3fxj: a composition-swapchain `Present` updates the swapchain, but the
/// video visual is not shown on screen until the device is committed on the main
/// thread. The geometry path commits incidentally (via [`set_video_dest`]), so
/// on a playback that receives no main-thread geometry event the video freezes on
/// its first frame while audio advances. The render thread posts this once after
/// its first present to guarantee the visual starts updating.
pub fn commit() {
    HOST.with(|h| {
        if let Some(host) = h.borrow().as_ref() {
            match unsafe { host._device.Commit() } {
                Ok(()) => log::debug!("[player:comp] DComp commit (recomposite)"),
                Err(e) => log::warn!("[player:comp] commit failed: {:?}", e),
            }
        }
    });
}

/// Client-area size of `hwnd` in pixels, floored at 1x1 so swapchain/texture
/// creation never sees a zero dimension (e.g. a minimized window at install).
fn client_size(hwnd: HWND) -> (u32, u32) {
    let mut rc = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut rc) }.is_ok() {
        let w = (rc.right - rc.left).max(1) as u32;
        let h = (rc.bottom - rc.top).max(1) as u32;
        (w, h)
    } else {
        log::warn!("[player:comp] GetClientRect failed; defaulting video surface to 1x1");
        (1, 1)
    }
}

/// Hardware D3D11 device with BGRA support (required by DirectComposition).
fn create_d3d11_device() -> windows::core::Result<ID3D11Device> {
    let mut device: Option<ID3D11Device> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            Default::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            None,
        )?;
    }
    device.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))
}

// ── Input forwarding (C3c: mouse + cursor; keyboard/IME is C4) ───────────────

/// Subclass id for our forwarding hook on the WRY_WEBVIEW child.
const INPUT_SUBCLASS_ID: usize = 0xC3C0;

/// Find wry's `WRY_WEBVIEW` container child of `main_hwnd` (the HWND passed to
/// `CreateCoreWebView2CompositionController`, hence the one the OS delivers
/// mouse messages to and whose client coords `SendMouseInput` expects) and
/// subclass it to forward input to `comp`.
fn install_input_forwarding(main_hwnd: HWND, comp: &ICoreWebView2CompositionController) {
    let container =
        unsafe { FindWindowExW(Some(main_hwnd), None, w!("WRY_WEBVIEW"), None) };
    let container = match container {
        Ok(h) if !h.is_invalid() => h,
        _ => {
            log::error!(
                "[player:comp] WRY_WEBVIEW child of HWND={:?} not found; input not forwarded",
                main_hwnd.0
            );
            return;
        }
    };

    // Boxed clone owned by the subclass; freed on WM_NCDESTROY.
    let state = Box::into_raw(Box::new(comp.clone())) as usize;
    let ok = unsafe {
        SetWindowSubclass(container, Some(input_subclass_proc), INPUT_SUBCLASS_ID, state)
    };
    if ok.as_bool() {
        log::info!(
            "[player:comp] input forwarding installed on WRY_WEBVIEW child HWND={:?}",
            container.0
        );
    } else {
        log::error!("[player:comp] SetWindowSubclass failed; input not forwarded");
        drop(unsafe { Box::from_raw(state as *mut ICoreWebView2CompositionController) });
    }
}

/// Resolve `comp`'s current cursor to a SYSTEM cursor, cache it, and apply now.
///
/// WebView2's own `Cursor()` HCURSOR does not render when passed to `SetCursor`
/// under composition hosting (proven empirically — the handle is non-null but
/// shows nothing). `SystemCursorId()` gives the Win32 cursor id (IDC_ARROW=32512,
/// IDC_HAND=32649, …) which we `LoadCursorW` into a real, displayable system
/// cursor. A null `Cursor()` means CSS `cursor: none` → hide (cache 0).
/// Resolve `comp`'s current cursor to a SYSTEM cursor (WebView2's own handles
/// don't render via `SetCursor` under composition hosting), cache it, apply it.
///
/// `hide_on_none`: when the webview reports `cursor: none` (player chrome faded
/// → idle), `true` hides the pointer; `false` substitutes the arrow. We hide on
/// the CursorChanged *event* (genuine idle) but never on a *mouse move* — a move
/// means the user is active and chrome is waking, so the arrow must show
/// immediately rather than wait for the (sometimes-missed) none→default event.
fn apply_cursor(comp: &ICoreWebView2CompositionController, hide_on_none: bool) {
    let mut webview_cur = HCURSOR::default();
    let has_cursor =
        unsafe { comp.Cursor(&mut webview_cur) }.is_ok() && !webview_cur.is_invalid();

    let resolved = if has_cursor {
        let mut id = 0u32;
        let name = if unsafe { comp.SystemCursorId(&mut id) }.is_ok() && id != 0 {
            PCWSTR(id as usize as *const u16)
        } else {
            IDC_ARROW
        };
        unsafe { LoadCursorW(None, name) }.unwrap_or_default()
    } else if hide_on_none {
        HCURSOR::default() // idle → hidden
    } else {
        unsafe { LoadCursorW(None, IDC_ARROW) }.unwrap_or_default() // active move → show arrow
    };

    CURSOR.with(|c| c.set(resolved.0 as isize));
    unsafe { SetCursor(if resolved.is_invalid() { None } else { Some(resolved) }) };
}

/// Subscribe to the composition controller's CursorChanged event so the page's
/// async cursor changes (e.g. player chrome toggling `cursor: default`/`none`)
/// are applied immediately, not a mouse-move behind. Seeds the cache once.
fn subscribe_cursor_changed(comp: &ICoreWebView2CompositionController) {
    let handler = CursorChangedEventHandler::create(Box::new(
        move |sender: Option<ICoreWebView2CompositionController>, _args| {
            if let Some(comp) = sender {
                apply_cursor(&comp, true); // event = genuine state change; honor none→hide
            }
            Ok(())
        },
    ));
    let mut token = 0i64;
    match unsafe { comp.add_CursorChanged(&handler, &mut token) } {
        Ok(()) => {
            apply_cursor(comp, true); // seed initial cursor
            log::info!("[player:comp] CursorChanged subscribed");
        }
        Err(e) => log::error!("[player:comp] add_CursorChanged failed: {:?}", e),
    }
}

#[inline]
fn loword_i(v: isize) -> i32 {
    (v as u32 & 0xFFFF) as i16 as i32
}
#[inline]
fn hiword_i(v: isize) -> i32 {
    ((v as u32 >> 16) & 0xFFFF) as i16 as i32
}

unsafe extern "system" fn input_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    dwrefdata: usize,
) -> LRESULT {
    let comp = unsafe { &*(dwrefdata as *const ICoreWebView2CompositionController) };

    match msg {
        WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_LBUTTONDBLCLK | WM_RBUTTONDOWN
        | WM_RBUTTONUP | WM_RBUTTONDBLCLK | WM_MBUTTONDOWN | WM_MBUTTONUP | WM_MBUTTONDBLCLK
        | WM_XBUTTONDOWN | WM_XBUTTONUP | WM_XBUTTONDBLCLK => {
            // Client coords; vkeys = held mouse/modifier bits (MK_* match the
            // COREWEBVIEW2 virtual-key bit values). mouse_data carries the
            // X-button identity for WM_XBUTTON*.
            let point = POINT { x: loword_i(lparam.0), y: hiword_i(lparam.0) };
            let vkeys = COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS(loword_i(wparam.0 as isize));
            let kind = match msg {
                WM_MOUSEMOVE => COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE,
                WM_LBUTTONDOWN => COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN,
                WM_LBUTTONUP => COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP,
                WM_LBUTTONDBLCLK => COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOUBLE_CLICK,
                WM_RBUTTONDOWN => COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN,
                WM_RBUTTONUP => COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP,
                WM_RBUTTONDBLCLK => COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOUBLE_CLICK,
                WM_MBUTTONDOWN => COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOWN,
                WM_MBUTTONUP => COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_UP,
                WM_MBUTTONDBLCLK => COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOUBLE_CLICK,
                WM_XBUTTONDOWN => COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_DOWN,
                WM_XBUTTONUP => COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_UP,
                _ => COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_DOUBLE_CLICK,
            };
            let mouse_data = hiword_i(wparam.0 as isize) as u32; // X-button id; 0 otherwise
            if let Err(e) = unsafe { comp.SendMouseInput(kind, vkeys, mouse_data, point) } {
                log::trace!("[player:comp] SendMouseInput failed: {:?}", e);
            }
            // A move means the user is active: keep the pointer visible even if
            // the page still reports `cursor: none` mid chrome-wake. Idle hiding
            // is handled by the CursorChanged event.
            if msg == WM_MOUSEMOVE {
                apply_cursor(comp, false);
            }
            LRESULT(0)
        }
        WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
            // Wheel messages carry SCREEN coords; convert to the child's client.
            let mut point = POINT { x: loword_i(lparam.0), y: hiword_i(lparam.0) };
            let _ = unsafe { ScreenToClient(hwnd, &mut point) };
            let vkeys = COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS(loword_i(wparam.0 as isize));
            let mouse_data = hiword_i(wparam.0 as isize) as u32; // signed wheel delta
            let kind = if msg == WM_MOUSEWHEEL {
                COREWEBVIEW2_MOUSE_EVENT_KIND_WHEEL
            } else {
                COREWEBVIEW2_MOUSE_EVENT_KIND_HORIZONTAL_WHEEL
            };
            if let Err(e) = unsafe { comp.SendMouseInput(kind, vkeys, mouse_data, point) } {
                log::trace!("[player:comp] SendMouseInput(wheel) failed: {:?}", e);
            }
            LRESULT(0)
        }
        WM_SETCURSOR => {
            // Only override while over the client (webview) area. Use the cached
            // cursor (kept current by the CursorChanged event) rather than a live
            // query, and claim the message so DefWindowProc can't reset us to the
            // WRY_WEBVIEW class cursor (which is NULL → would hide the pointer).
            if loword_i(lparam.0) == HTCLIENT as i32 {
                // Apply the cached system cursor (updated by the CursorChanged
                // event — no per-move COM calls). Claim the message so
                // DefWindowProc can't reset us to the WRY_WEBVIEW class cursor.
                let cached = CURSOR.with(|c| c.get());
                let hcur = HCURSOR(cached as *mut core::ffi::c_void);
                unsafe { SetCursor(if hcur.is_invalid() { None } else { Some(hcur) }) };
                return LRESULT(1);
            }
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }
        WM_NCDESTROY => {
            let _ = unsafe {
                RemoveWindowSubclass(hwnd, Some(input_subclass_proc), INPUT_SUBCLASS_ID)
            };
            drop(unsafe { Box::from_raw(dwrefdata as *mut ICoreWebView2CompositionController) });
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }
        _ => unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) },
    }
}
