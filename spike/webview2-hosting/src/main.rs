//! THROWAWAY feasibility spike — beads prexu-tfip / Path C1.
//!
//! Question this binary answers (the airspace killer for Path C):
//!   When a WebView2 is hosted in VISUAL mode
//!   (ICoreWebView2Environment3::CreateCoreWebView2CompositionController +
//!   ICoreWebView2CompositionController::SetRootVisualTarget into an app-owned
//!   DirectComposition tree), is the webview BOTH
//!     (a) CLICKABLE — forwarded mouse input reaches the page, AND
//!     (b) TRANSPARENT — a solid-colored DComp visual placed BEHIND it shows
//!         through the page's transparent regions?
//!
//! Windowed WebView2 hosting (what wry/Tauri use today) fails (b): the child
//! HWND is opaque to anything composited behind it (airspace). Path C bets that
//! VISUAL hosting removes airspace so video (a DComp visual below) and UI (the
//! webview visual above) live in ONE composed surface. The C0 spike (prexu-jjbk)
//! already proved that composed surface is captured by Alt+Tab/WGC; this spike
//! proves the webview half composites and accepts input.
//!
//! Pipeline:
//!   1. CoInitializeEx(STA) + a plain top-level window (NOT WS_CHILD).
//!   2. D3D11 device + DComp device/target for the window.
//!   3. DComp tree: root -> [ background visual = solid MAGENTA swapchain (bottom),
//!      webview visual (top) ].
//!   4. WebView2 environment (async) -> CreateCoreWebView2CompositionController
//!      (async) -> SetRootVisualTarget(webview visual); transparent default bg;
//!      SetBounds(full client); rasterization scale 1.0.
//!   5. NavigateToString a page that is transparent except a CYAN button; the
//!      button's onclick sets document.title = "CLICKED".
//!   6. Forward synthesized mouse input (SendMouseInput MOVE/DOWN/UP) at the
//!      button center; poll DocumentTitle() for "CLICKED".
//!   7. SELF-VERIFY via WGC: capture the window, sample a background-gap pixel
//!      (expect MAGENTA = transparent passthrough) and a button pixel (expect
//!      CYAN = webview content on top). Verdict = clicked && magenta && cyan.
//!
//! RUN: see RUN.md. Needs a GPU/interactive desktop session and the WebView2
//! Evergreen runtime (the Tauri app already requires it).

#![cfg(target_os = "windows")]

use std::cell::RefCell;
use std::rc::Rc;

use windows::core::{w, Interface, BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11RenderTargetView,
    ID3D11Texture2D, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_PREMULTIPLIED, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIFactory2, IDXGISwapChain1, DXGI_SCALING_STRETCH, DXGI_SWAP_CHAIN_DESC1,
    DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL, DXGI_USAGE_RENDER_TARGET_OUTPUT,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetWindowLongPtrW,
    PeekMessageW, PostQuitMessage, RegisterClassExW, SetCursor, SetWindowLongPtrW, ShowWindow,
    TranslateMessage, CS_HREDRAW, CS_VREDRAW, GWLP_USERDATA, HCURSOR, HTCLIENT, MSG, PM_REMOVE,
    SW_SHOW, WM_DESTROY, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_SETCURSOR, WM_SIZE,
    WNDCLASSEXW, WS_OVERLAPPEDWINDOW,
};

// WebView2 COM: high-level handler helpers + the generated sys interfaces.
use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2CompositionController,
    ICoreWebView2Controller, ICoreWebView2Controller2, ICoreWebView2Controller3,
    ICoreWebView2Environment, ICoreWebView2Environment3, COREWEBVIEW2_COLOR,
    COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN, COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP,
    COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE,
};
use webview2_com::{
    CreateCoreWebView2CompositionControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler,
};

mod capture;

const WIDTH: i32 = 1280;
const HEIGHT: i32 = 720;

// Button rect in client/webview pixels (rasterization scale forced to 1.0 so
// client coords == webview coords == CSS px). Kept well inside the window with a
// transparent gap around it so the gap samples the magenta background.
const BTN_X: i32 = 480;
const BTN_Y: i32 = 300;
const BTN_W: i32 = 320;
const BTN_H: i32 = 120;

/// Per-window state stashed in GWLP_USERDATA once WebView2 is ready. The wndproc
/// forwards real OS mouse/cursor messages through these; before they exist the
/// wndproc just calls DefWindowProc.
struct HostState {
    comp: ICoreWebView2CompositionController,
    controller: ICoreWebView2Controller,
}

fn loword(v: u32) -> i32 {
    (v & 0xFFFF) as i16 as i32
}
fn hiword(v: u32) -> i32 {
    ((v >> 16) & 0xFFFF) as i16 as i32
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let state_ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const HostState;
    let state: Option<&HostState> = if state_ptr.is_null() {
        None
    } else {
        Some(unsafe { &*state_ptr })
    };

    match msg {
        WM_SIZE => {
            if let Some(s) = state {
                let mut rc = RECT::default();
                let _ = unsafe { GetClientRect(hwnd, &mut rc) };
                if let Err(e) = unsafe { s.controller.SetBounds(rc) } {
                    log::warn!("[spike:input] SetBounds on WM_SIZE failed: {e:?}");
                }
            }
            LRESULT(0)
        }
        WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP => {
            if let Some(s) = state {
                let pt = POINT { x: loword(lp.0 as u32), y: hiword(lp.0 as u32) };
                let (kind, vkeys) = match msg {
                    WM_LBUTTONDOWN => (
                        COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN,
                        COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON,
                    ),
                    WM_LBUTTONUP => (
                        COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP,
                        COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE,
                    ),
                    _ => (
                        COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE,
                        COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE,
                    ),
                };
                if let Err(e) = unsafe { s.comp.SendMouseInput(kind, vkeys, 0, pt) } {
                    log::warn!("[spike:input] SendMouseInput failed: {e:?}");
                }
            }
            LRESULT(0)
        }
        WM_SETCURSOR => {
            // Only override the cursor over the client (webview) area.
            if loword(lp.0 as u32) == HTCLIENT as i32 {
                if let Some(s) = state {
                    let mut hcur = HCURSOR::default();
                    if unsafe { s.comp.Cursor(&mut hcur) }.is_ok() {
                        unsafe { SetCursor(Some(hcur)) };
                        return LRESULT(1);
                    }
                }
            }
            unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
        }
        WM_DESTROY => {
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}

fn create_plain_window() -> windows::core::Result<HWND> {
    let hinstance =
        unsafe { windows::Win32::System::LibraryLoader::GetModuleHandleW(PCWSTR::null())? };
    let class = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wnd_proc),
        hInstance: hinstance.into(),
        lpszClassName: w!("PrexuWebView2HostSpike"),
        ..Default::default()
    };
    unsafe { RegisterClassExW(&class) };
    let hwnd = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("PrexuWebView2HostSpike"),
            w!("Prexu WebView2 Visual-Hosting Spike (Path C1)"),
            WS_OVERLAPPEDWINDOW,
            100,
            100,
            WIDTH,
            HEIGHT,
            None,
            None,
            Some(hinstance.into()),
            None,
        )?
    };
    log::info!("[spike:win] CreateWindowExW HWND={:?} ({}x{})", hwnd.0, WIDTH, HEIGHT);
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOW);
    }
    Ok(hwnd)
}

fn create_d3d11_device() -> windows::core::Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
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
            Some(&mut context),
        )?;
    }
    log::info!("[spike:d3d] D3D11CreateDevice ok (BGRA, hardware)");
    Ok((device.unwrap(), context.unwrap()))
}

/// DComp objects kept alive for the window lifetime.
struct DComp {
    device: IDCompositionDevice,
    _target: IDCompositionTarget,
    _root: IDCompositionVisual,
    _bg: IDCompositionVisual,
    /// Handed to SetRootVisualTarget; WebView2 renders into this.
    webview_visual: IDCompositionVisual,
    /// Keeps the magenta background swapchain alive (content of `_bg`).
    _bg_swapchain: IDXGISwapChain1,
}

/// Build root -> [ magenta background (bottom), webview visual (top) ].
fn setup_dcomp(hwnd: HWND, d3d: &ID3D11Device) -> windows::core::Result<DComp> {
    let dxgi_device: IDXGIDevice = d3d.cast()?;
    let adapter = unsafe { dxgi_device.GetAdapter()? };
    let factory: IDXGIFactory2 = unsafe { adapter.GetParent()? };

    // Background composition swapchain, cleared once to opaque magenta.
    let sc_desc = DXGI_SWAP_CHAIN_DESC1 {
        Width: WIDTH as u32,
        Height: HEIGHT as u32,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        Stereo: BOOL::from(false),
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
        BufferCount: 2,
        Scaling: DXGI_SCALING_STRETCH,
        SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
        AlphaMode: DXGI_ALPHA_MODE_PREMULTIPLIED,
        Flags: 0,
    };
    let bg_swapchain: IDXGISwapChain1 =
        unsafe { factory.CreateSwapChainForComposition(d3d, &sc_desc, None)? };
    // Clear the back buffer to magenta and present.
    let back: ID3D11Texture2D = unsafe { bg_swapchain.GetBuffer(0)? };
    let mut rtv: Option<ID3D11RenderTargetView> = None;
    unsafe { d3d.CreateRenderTargetView(&back, None, Some(&mut rtv))? };
    let rtv = rtv.unwrap();
    let ctx = unsafe { d3d.GetImmediateContext()? };
    unsafe { ctx.ClearRenderTargetView(&rtv, &[1.0, 0.0, 1.0, 1.0]) };
    unsafe { bg_swapchain.Present(0, Default::default()).ok()? };
    log::info!("[spike:dcomp] background swapchain cleared to magenta");

    let device: IDCompositionDevice = unsafe { DCompositionCreateDevice(Some(&dxgi_device))? };
    let target: IDCompositionTarget = unsafe { device.CreateTargetForHwnd(hwnd, true)? };
    let root: IDCompositionVisual = unsafe { device.CreateVisual()? };
    let bg: IDCompositionVisual = unsafe { device.CreateVisual()? };
    let webview_visual: IDCompositionVisual = unsafe { device.CreateVisual()? };

    unsafe { bg.SetContent(&bg_swapchain)? };
    // bg at bottom (insertAbove=TRUE, reference=NULL => bottom of z-order).
    unsafe { root.AddVisual(&bg, true, None)? };
    // webview visual ABOVE bg.
    unsafe { root.AddVisual(&webview_visual, true, &bg)? };
    unsafe { target.SetRoot(&root)? };
    unsafe { device.Commit()? };
    log::info!("[spike:dcomp] tree wired: root -> [bg(magenta), webview(top)], committed");

    Ok(DComp {
        device,
        _target: target,
        _root: root,
        _bg: bg,
        webview_visual,
        _bg_swapchain: bg_swapchain,
    })
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn pump_messages() {
    unsafe {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

/// Pump the message loop for roughly `ms` milliseconds so WebView2 (which runs
/// on this UI thread) can make progress.
fn pump_for(ms: u64) {
    let steps = (ms / 10).max(1);
    for _ in 0..steps {
        pump_messages();
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

/// Create the WebView2 environment (async, blocks with an internal pump).
fn create_environment() -> Result<ICoreWebView2Environment, String> {
    let user_data = std::env::temp_dir().join("prexu-wv2-hosting-spike");
    let udf = wide(&user_data.to_string_lossy());
    let slot: Rc<RefCell<Option<ICoreWebView2Environment>>> = Rc::new(RefCell::new(None));
    let slot2 = slot.clone();

    CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            CreateCoreWebView2EnvironmentWithOptions(
                PCWSTR::null(),
                PCWSTR(udf.as_ptr()),
                None,
                &handler,
            )
            .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |hr, env| {
            hr?;
            *slot2.borrow_mut() = env;
            Ok(())
        }),
    )
    .map_err(|e| format!("env wait_for_async_operation: {e:?}"))?;

    let env = slot.borrow_mut().take();
    env.ok_or_else(|| "environment was null".to_string())
}

/// Create the composition controller for `hwnd` (async, blocks with pump).
fn create_composition_controller(
    env: &ICoreWebView2Environment,
    hwnd: HWND,
) -> Result<ICoreWebView2CompositionController, String> {
    let env3: ICoreWebView2Environment3 = env.cast().map_err(|e| format!("cast Env3: {e:?}"))?;
    let slot: Rc<RefCell<Option<ICoreWebView2CompositionController>>> =
        Rc::new(RefCell::new(None));
    let slot2 = slot.clone();

    CreateCoreWebView2CompositionControllerCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            env3.CreateCoreWebView2CompositionController(hwnd, &handler)
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |hr, comp| {
            hr?;
            *slot2.borrow_mut() = comp;
            Ok(())
        }),
    )
    .map_err(|e| format!("comp wait_for_async_operation: {e:?}"))?;

    let comp = slot.borrow_mut().take();
    comp.ok_or_else(|| "composition controller was null".to_string())
}

const TEST_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:transparent;}
  #btn{position:absolute;left:480px;top:300px;width:320px;height:120px;
       background:rgb(0,255,255);border:0;color:#000;font:700 28px sans-serif;
       cursor:pointer;}
</style></head><body>
<button id="btn">CLICK ME</button>
<script>
  document.getElementById('btn').addEventListener('click',()=>{
    document.title='CLICKED';
    document.getElementById('btn').style.background='rgb(0,200,0)';
  });
</script></body></html>"#;

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).init();
    log::info!("[spike] webview2 visual-hosting spike (prexu-tfip / Path C1) starting");
    if let Err(e) = run() {
        log::error!("[spike] FATAL: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    // STA + a message pump are required for WebView2.
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }
        .map_err(|e| format!("CoInitializeEx: {e:?}"))?;

    let hwnd = create_plain_window().map_err(|e| format!("create_plain_window: {e:?}"))?;
    let (d3d, _ctx) = create_d3d11_device().map_err(|e| format!("create_d3d11_device: {e:?}"))?;
    let dcomp = setup_dcomp(hwnd, &d3d).map_err(|e| format!("setup_dcomp: {e:?}"))?;

    // ── WebView2 environment + composition controller (visual hosting) ───────
    let env = create_environment().map_err(|e| format!("create_environment: {e:?}"))?;
    let comp = create_composition_controller(&env, hwnd)
        .map_err(|e| format!("create_composition_controller: {e:?}"))?;

    // Hand WebView2 the visual that sits ABOVE the magenta background.
    unsafe { comp.SetRootVisualTarget(&dcomp.webview_visual) }
        .map_err(|e| format!("SetRootVisualTarget: {e:?}"))?;

    let controller: ICoreWebView2Controller =
        comp.cast().map_err(|e| format!("cast comp->Controller: {e:?}"))?;

    // Force rasterization scale 1.0 so client px == webview px == CSS px (keeps
    // the synthesized-click coordinate math exact regardless of monitor DPI).
    if let Ok(c3) = controller.cast::<ICoreWebView2Controller3>() {
        if let Err(e) = unsafe { c3.SetRasterizationScale(1.0) } {
            log::warn!("[spike] SetRasterizationScale(1.0) failed: {e:?}");
        }
    }
    // Transparent default background so the page's transparent regions reveal the
    // magenta DComp visual below (the airspace test).
    if let Ok(c2) = controller.cast::<ICoreWebView2Controller2>() {
        let transparent = COREWEBVIEW2_COLOR { A: 0, R: 0, G: 0, B: 0 };
        if let Err(e) = unsafe { c2.SetDefaultBackgroundColor(transparent) } {
            log::warn!("[spike] SetDefaultBackgroundColor(transparent) failed: {e:?}");
        }
    }

    // Full-window bounds + visible.
    let bounds = RECT { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
    unsafe { controller.SetBounds(bounds) }.map_err(|e| format!("SetBounds: {e:?}"))?;
    unsafe { controller.SetIsVisible(true) }.map_err(|e| format!("SetIsVisible: {e:?}"))?;
    unsafe { dcomp.device.Commit() }.map_err(|e| format!("DComp Commit: {e:?}"))?;

    let webview: ICoreWebView2 =
        unsafe { controller.CoreWebView2() }.map_err(|e| format!("CoreWebView2: {e:?}"))?;
    let html = wide(TEST_HTML);
    unsafe { webview.NavigateToString(PCWSTR(html.as_ptr())) }
        .map_err(|e| format!("NavigateToString: {e:?}"))?;
    log::info!("[spike] navigated to test page; pumping for load");

    // Install state so the wndproc can forward real cursor/mouse from now on.
    let state = Box::new(HostState { comp: comp.clone(), controller: controller.clone() });
    let state_ptr = Box::into_raw(state);
    unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, state_ptr as isize) };

    // Let the page load and the first composited frame land.
    pump_for(1200);

    // ── Synthesize a click at the button center via forwarded input ──────────
    let click = POINT { x: BTN_X + BTN_W / 2, y: BTN_Y + BTN_H / 2 };
    log::info!("[spike:input] synthesizing click at ({}, {})", click.x, click.y);
    unsafe {
        let _ = comp.SendMouseInput(
            COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE,
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE,
            0,
            click,
        );
        let _ = comp.SendMouseInput(
            COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN,
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON,
            0,
            click,
        );
        let _ = comp.SendMouseInput(
            COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP,
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE,
            0,
            click,
        );
    }

    // Poll DocumentTitle() up to ~2s for the click to register.
    let mut clicked = false;
    for _ in 0..40 {
        pump_for(50);
        let mut title = windows::core::PWSTR::null();
        if unsafe { webview.DocumentTitle(&mut title) }.is_ok() && !title.is_null() {
            let t = webview2_com::take_pwstr(title);
            if t == "CLICKED" {
                clicked = true;
                break;
            }
        }
    }
    log::info!("[spike:input] click registered by page = {}", clicked);

    // Settle a frame after the button recolors, then capture.
    pump_for(300);

    // ── SELF-VERIFY via WGC ──────────────────────────────────────────────────
    let out = std::env::current_dir().unwrap_or_default().join("webview2_hosting_test.png");
    let cap_ctx =
        unsafe { d3d.GetImmediateContext() }.map_err(|e| format!("GetImmediateContext: {e:?}"))?;
    match capture::capture_window(hwnd, &d3d, &cap_ctx, &out) {
        Ok(frame) => {
            // Background gap: a point far from the button (bottom-right corner).
            let gap = frame.pixel((WIDTH - 40) as u32, (HEIGHT - 40) as u32);
            // Button center.
            let btn = frame.pixel((BTN_X + BTN_W / 2) as u32, (BTN_Y + BTN_H / 2) as u32);
            // Magenta ~ (R high, G low, B high). Cyan/green ~ (R low, G high).
            let gap_is_magenta = gap[0] > 180 && gap[1] < 80 && gap[2] > 180;
            let btn_is_webview = btn[1] > 150 && btn[0] < 120; // cyan or green button
            log::info!(
                "[spike:verify] gap rgba={:?} magenta={} ; button rgba={:?} webview={}",
                gap, gap_is_magenta, btn, btn_is_webview
            );
            verdict(clicked, gap_is_magenta, btn_is_webview, gap, btn);
        }
        Err(e) => {
            log::error!("[spike:capture] capture failed: {e}");
            println!("\n=== VERDICT: INCONCLUSIVE — capture path errored: {e} ===\n");
        }
    }

    // Cleanup the leaked state box.
    unsafe { drop(Box::from_raw(state_ptr)) };
    Ok(())
}

fn verdict(clicked: bool, gap_magenta: bool, btn_webview: bool, gap: [u8; 4], btn: [u8; 4]) {
    if clicked && gap_magenta && btn_webview {
        println!(
            "\n=== VERDICT: LINCHPIN PASS — webview is CLICKABLE (title->CLICKED) AND \
             TRANSPARENT (gap={:?} magenta background shows through) with webview content \
             composited above (button={:?}). Path C visual-hosting airspace test CONFIRMED. ===\n",
            gap, btn
        );
    } else {
        println!(
            "\n=== VERDICT: LINCHPIN FAIL — clicked={} gap_magenta={} (gap={:?}) \
             btn_webview={} (btn={:?}). If gap is NOT magenta, the webview visual is opaque / \
             airspace persists (KILL SIGNAL). If button is magenta, the webview did not \
             composite above the background. If clicked=false, input forwarding failed. ===\n",
            clicked, gap_magenta, gap, btn_webview, btn
        );
    }
}
