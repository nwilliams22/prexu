//! THROWAWAY feasibility spike — beads prexu-k0i2 / Path C2.
//!
//! Combines the two independently-proven halves of Path C into ONE
//! DirectComposition tree on ONE plain top-level window, standalone:
//!   - C0 (prexu-jjbk): mpv -> ANGLE GL -> shared D3D11 texture -> composition
//!     swapchain -> a DComp VIDEO visual (z-below). Captured by WGC.
//!   - C1 (prexu-tfip): WebView2 visual hosting (CreateCoreWebView2Composition
//!     Controller + SetRootVisualTarget) -> a DComp WEBVIEW visual (z-above),
//!     transparent + clickable.
//!
//! Proves the whole Alt-tab-parity goal OUTSIDE Tauri before app surgery:
//!   (a) the webview UI overlays the video with TRUE ALPHA (transparent page
//!       regions show the video below; a control bar alpha-blends over it), AND
//!   (b) a single WGC capture (the Alt+Tab surface) contains BOTH video and UI.
//! Also fixes the C0 vertical flip (see MPV_RENDER_FLIP).
//!
//! DComp tree:  root -> [ video visual (bottom, content = mpv swapchain),
//!                        webview visual (top, SetRootVisualTarget) ]
//!
//! RUN: see RUN.md. Needs a GPU/interactive desktop, the WebView2 runtime, ANGLE
//! libEGL.dll/libGLESv2.dll on PATH, and a video file as argv[1].

#![cfg(target_os = "windows")]

use std::cell::RefCell;
use std::ffi::c_void;
use std::path::PathBuf;
use std::rc::Rc;

use windows::core::{w, Interface, BOOL, PCWSTR};
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_RESOURCE_MISC_SHARED, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_IGNORE, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIFactory2, IDXGIResource, IDXGISwapChain1, DXGI_SCALING_STRETCH,
    DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL, DXGI_USAGE_RENDER_TARGET_OUTPUT,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetWindowLongPtrW,
    PeekMessageW, PostQuitMessage, RegisterClassExW, SetCursor, SetWindowLongPtrW, ShowWindow,
    TranslateMessage, CS_HREDRAW, CS_VREDRAW, GWLP_USERDATA, HCURSOR, HTCLIENT, MSG, PM_REMOVE,
    SW_SHOW, WM_DESTROY, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_SETCURSOR, WM_SIZE,
    WNDCLASSEXW, WS_OVERLAPPEDWINDOW,
};

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
mod egl_angle;

use egl_angle::AngleGl;

const WIDTH: i32 = 1280;
const HEIGHT: i32 = 720;

// Button rect (client/webview px; rasterization scale forced 1.0).
const BTN_X: i32 = 480;
const BTN_Y: i32 = 300;
const BTN_W: i32 = 320;
const BTN_H: i32 = 120;

// Sample points for the verdict (client px).
const VIDEO_SAMPLE: (i32, i32) = (200, 150); // transparent page region over video
const BAR_SAMPLE: (i32, i32) = (200, HEIGHT - 40); // translucent control bar over video

// C0 fix: C0 rendered with mpv flip=true and the image came out upside-down in
// the DComp composition-swapchain path (no extra present-time flip, unlike a
// windowed swapchain). Flip is set to false here as the corrected value; the
// PNG must still be eyeballed since orientation cannot be auto-detected.
const MPV_RENDER_FLIP: bool = false;

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
                let _ = unsafe { s.controller.SetBounds(rc) };
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
                let _ = unsafe { s.comp.SendMouseInput(kind, vkeys, 0, pt) };
            }
            LRESULT(0)
        }
        WM_SETCURSOR => {
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
        lpszClassName: w!("PrexuDCompOverlaySpike"),
        ..Default::default()
    };
    unsafe { RegisterClassExW(&class) };
    let hwnd = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("PrexuDCompOverlaySpike"),
            w!("Prexu DComp Overlay Spike (Path C2: video + webview)"),
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

/// Shared BGRA render-target texture (mpv's GL FBO aliases it via ANGLE).
fn create_shared_texture(
    device: &ID3D11Device,
) -> windows::core::Result<(ID3D11Texture2D, HANDLE)> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: WIDTH as u32,
        Height: HEIGHT as u32,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
    };
    let mut tex: Option<ID3D11Texture2D> = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut tex))? };
    let tex = tex.unwrap();
    let dxgi_res: IDXGIResource = tex.cast()?;
    let share_handle = unsafe { dxgi_res.GetSharedHandle()? };
    log::info!("[spike:d3d] shared BGRA texture {}x{} handle={:?}", WIDTH, HEIGHT, share_handle.0);
    Ok((tex, share_handle))
}

/// Composition swapchain backing the VIDEO visual; mpv frames are copied in.
fn create_video_swapchain(d3d: &ID3D11Device) -> windows::core::Result<IDXGISwapChain1> {
    let dxgi_device: IDXGIDevice = d3d.cast()?;
    let adapter = unsafe { dxgi_device.GetAdapter()? };
    let factory: IDXGIFactory2 = unsafe { adapter.GetParent()? };
    let desc = DXGI_SWAP_CHAIN_DESC1 {
        Width: WIDTH as u32,
        Height: HEIGHT as u32,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        Stereo: BOOL::from(false),
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
        BufferCount: 2,
        Scaling: DXGI_SCALING_STRETCH,
        SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
        AlphaMode: DXGI_ALPHA_MODE_IGNORE,
        Flags: 0,
    };
    let sc = unsafe { factory.CreateSwapChainForComposition(d3d, &desc, None)? };
    log::info!("[spike:dcomp] video composition swapchain {}x{} created", WIDTH, HEIGHT);
    Ok(sc)
}

struct DComp {
    device: IDCompositionDevice,
    _target: IDCompositionTarget,
    _root: IDCompositionVisual,
    _video: IDCompositionVisual,
    webview_visual: IDCompositionVisual,
}

/// One tree: root -> [ video visual (bottom, content=swapchain), webview (top) ].
fn setup_dcomp(
    hwnd: HWND,
    d3d: &ID3D11Device,
    video_swapchain: &IDXGISwapChain1,
) -> windows::core::Result<DComp> {
    let dxgi_device: IDXGIDevice = d3d.cast()?;
    let device: IDCompositionDevice = unsafe { DCompositionCreateDevice(Some(&dxgi_device))? };
    let target: IDCompositionTarget = unsafe { device.CreateTargetForHwnd(hwnd, true)? };
    let root: IDCompositionVisual = unsafe { device.CreateVisual()? };
    let video: IDCompositionVisual = unsafe { device.CreateVisual()? };
    let webview_visual: IDCompositionVisual = unsafe { device.CreateVisual()? };

    unsafe { video.SetContent(video_swapchain)? };
    unsafe { root.AddVisual(&video, true, None)? }; // video at bottom
    unsafe { root.AddVisual(&webview_visual, true, &video)? }; // webview above
    unsafe { target.SetRoot(&root)? };
    unsafe { device.Commit()? };
    log::info!("[spike:dcomp] tree: root -> [video(bottom), webview(top)], committed");

    Ok(DComp {
        device,
        _target: target,
        _root: root,
        _video: video,
        webview_visual,
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

fn create_environment() -> Result<ICoreWebView2Environment, String> {
    let user_data = std::env::temp_dir().join("prexu-dcomp-overlay-spike");
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

/// Transparent page EXCEPT a cyan button and a translucent bottom control bar —
/// so the video below shows through the center and alpha-blends under the bar.
const TEST_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;}
  #bar{position:absolute;left:0;bottom:0;width:100%;height:120px;
       background:rgba(0,0,0,0.45);}
  #btn{position:absolute;left:480px;top:300px;width:320px;height:120px;
       background:rgb(0,255,255);border:0;color:#000;font:700 28px sans-serif;
       cursor:pointer;}
</style></head><body>
<div id="bar"></div>
<button id="btn">CLICK ME</button>
<script>
  document.getElementById('btn').addEventListener('click',()=>{
    document.title='CLICKED';
    document.getElementById('btn').style.background='rgb(0,200,0)';
  });
</script></body></html>"#;

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).init();
    log::info!("[spike] dcomp-overlay spike (prexu-k0i2 / Path C2) starting");
    let video: Option<PathBuf> = std::env::args().nth(1).map(PathBuf::from);
    match &video {
        Some(p) => log::info!("[spike] video file: {}", p.display()),
        None => log::warn!("[spike] no video path argv[1] — video region will be black; pass a file for a real PASS"),
    }
    if let Err(e) = run(video) {
        log::error!("[spike] FATAL: {e}");
        std::process::exit(1);
    }
}

fn run(video: Option<PathBuf>) -> Result<(), String> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }
        .map_err(|e| format!("CoInitializeEx: {e:?}"))?;

    let hwnd = create_plain_window().map_err(|e| format!("create_plain_window: {e:?}"))?;
    let (d3d, d3d_ctx) = create_d3d11_device().map_err(|e| format!("create_d3d11_device: {e:?}"))?;

    // ── C0: mpv -> ANGLE -> shared texture ───────────────────────────────────
    let (shared_tex, share_handle) =
        create_shared_texture(&d3d).map_err(|e| format!("create_shared_texture: {e:?}"))?;
    let mut gl = AngleGl::create(WIDTH, HEIGHT)
        .map_err(|e| format!("AngleGl::create: {e}"))?;
    let fbo = gl
        .import_share_handle_as_fbo(share_handle.0 as *mut c_void)
        .map_err(|e| format!("import_share_handle_as_fbo: {e}"))?;
    let mut mpv = mpv_bridge::init_mpv()?;
    let render = mpv_bridge::make_render_context(&mut mpv)?;
    if let Some(v) = &video {
        mpv_bridge::load_file(&mpv, v)?;
    }
    let video_swapchain =
        create_video_swapchain(&d3d).map_err(|e| format!("create_video_swapchain: {e:?}"))?;

    // ── One DComp tree: video (bottom) + webview (top) ───────────────────────
    let dcomp =
        setup_dcomp(hwnd, &d3d, &video_swapchain).map_err(|e| format!("setup_dcomp: {e:?}"))?;

    // ── C1: WebView2 visual hosting into the top visual ──────────────────────
    let env = create_environment().map_err(|e| format!("create_environment: {e:?}"))?;
    let comp = create_composition_controller(&env, hwnd)
        .map_err(|e| format!("create_composition_controller: {e:?}"))?;
    unsafe { comp.SetRootVisualTarget(&dcomp.webview_visual) }
        .map_err(|e| format!("SetRootVisualTarget: {e:?}"))?;
    let controller: ICoreWebView2Controller =
        comp.cast().map_err(|e| format!("cast comp->Controller: {e:?}"))?;
    if let Ok(c3) = controller.cast::<ICoreWebView2Controller3>() {
        let _ = unsafe { c3.SetRasterizationScale(1.0) };
    }
    if let Ok(c2) = controller.cast::<ICoreWebView2Controller2>() {
        let _ = unsafe { c2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 0, R: 0, G: 0, B: 0 }) };
    }
    let bounds = RECT { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
    unsafe { controller.SetBounds(bounds) }.map_err(|e| format!("SetBounds: {e:?}"))?;
    unsafe { controller.SetIsVisible(true) }.map_err(|e| format!("SetIsVisible: {e:?}"))?;
    unsafe { dcomp.device.Commit() }.map_err(|e| format!("Commit: {e:?}"))?;
    let webview: ICoreWebView2 =
        unsafe { controller.CoreWebView2() }.map_err(|e| format!("CoreWebView2: {e:?}"))?;
    let html = wide(TEST_HTML);
    unsafe { webview.NavigateToString(PCWSTR(html.as_ptr())) }
        .map_err(|e| format!("NavigateToString: {e:?}"))?;

    let state = Box::new(HostState { comp: comp.clone(), controller: controller.clone() });
    let state_ptr = Box::into_raw(state);
    unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, state_ptr as isize) };

    // ── Render loop: mpv -> shared FBO -> copy into video swapchain -> Present;
    //    pump messages so the webview composites above. ~180 frames (~3s). ─────
    log::info!("[spike] render loop (~180 frames)");
    for frame in 0..180 {
        pump_messages();
        let _ = render.update();
        if let Err(e) = mpv_bridge::render_frame(&render, fbo, WIDTH, HEIGHT) {
            log::error!("[spike:mpv] render_frame failed @ {frame}: {e}");
            break;
        }
        gl.finish();
        match unsafe { video_swapchain.GetBuffer::<ID3D11Texture2D>(0) } {
            Ok(back) => {
                unsafe { d3d_ctx.CopyResource(&back, &shared_tex) };
                let _ = unsafe { video_swapchain.Present(1, Default::default()) }.ok();
            }
            Err(e) => log::warn!("[spike:dcomp] GetBuffer @ {frame}: {e:?}"),
        }
        let _ = unsafe { dcomp.device.Commit() };
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
    log::info!("[spike] render loop done");

    // ── Synthesize a click on the button (forwarded input) ───────────────────
    let click = POINT { x: BTN_X + BTN_W / 2, y: BTN_Y + BTN_H / 2 };
    log::info!("[spike:input] synth click at ({}, {})", click.x, click.y);
    unsafe {
        let _ = comp.SendMouseInput(COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE, 0, click);
        let _ = comp.SendMouseInput(COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON, 0, click);
        let _ = comp.SendMouseInput(COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE, 0, click);
    }
    let mut clicked = false;
    for _ in 0..40 {
        pump_messages();
        std::thread::sleep(std::time::Duration::from_millis(25));
        // keep video flowing while we wait
        let _ = render.update();
        let _ = mpv_bridge::render_frame(&render, fbo, WIDTH, HEIGHT);
        gl.finish();
        if let Ok(back) = unsafe { video_swapchain.GetBuffer::<ID3D11Texture2D>(0) } {
            unsafe { d3d_ctx.CopyResource(&back, &shared_tex) };
            let _ = unsafe { video_swapchain.Present(1, Default::default()) }.ok();
        }
        let _ = unsafe { dcomp.device.Commit() };
        let mut title = windows::core::PWSTR::null();
        if unsafe { webview.DocumentTitle(&mut title) }.is_ok() && !title.is_null() {
            if webview2_com::take_pwstr(title) == "CLICKED" {
                clicked = true;
                break;
            }
        }
    }
    log::info!("[spike:input] click registered = {}", clicked);

    // ── SELF-VERIFY via WGC: one capture must contain BOTH video and UI ───────
    let out = std::env::current_dir().unwrap_or_default().join("dcomp_overlay_test.png");
    match capture::capture_window(hwnd, &d3d, &d3d_ctx, &out) {
        Ok(frame) => {
            let vid = frame.pixel(VIDEO_SAMPLE.0 as u32, VIDEO_SAMPLE.1 as u32);
            let btn = frame.pixel((BTN_X + BTN_W / 2) as u32, (BTN_Y + BTN_H / 2) as u32);
            let bar = frame.pixel(BAR_SAMPLE.0 as u32, BAR_SAMPLE.1 as u32);
            // Video visible = the transparent page region over video is non-black
            // (only true if a real video file produced frames).
            let video_visible = vid[0] > 16 || vid[1] > 16 || vid[2] > 16;
            // Button overlays = cyan(pre) or green(post-click).
            let button_overlays = btn[1] > 150 && btn[0] < 120;
            log::info!(
                "[spike:verify] video@{:?} rgba={:?} visible={} ; button rgba={:?} overlays={} ; bar rgba={:?}",
                VIDEO_SAMPLE, vid, video_visible, btn, button_overlays, bar
            );
            verdict(clicked, video_visible, button_overlays, video.is_some(), vid, btn, bar);
        }
        Err(e) => {
            log::error!("[spike:capture] capture failed: {e}");
            println!("\n=== VERDICT: INCONCLUSIVE — capture errored: {e} ===\n");
        }
    }

    unsafe { drop(Box::from_raw(state_ptr)) };
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn verdict(
    clicked: bool,
    video_visible: bool,
    button_overlays: bool,
    had_video: bool,
    vid: [u8; 4],
    btn: [u8; 4],
    bar: [u8; 4],
) {
    let pass = clicked && button_overlays && (video_visible || !had_video);
    if pass && had_video && video_visible {
        println!(
            "\n=== VERDICT: LINCHPIN PASS — ONE DComp tree shows BOTH: video visible through the \
             transparent webview (video={:?}) AND the webview UI overlays it (button={:?}, \
             clicked={}), control bar alpha-blends (bar={:?}). WGC captured both together. Path C \
             end-to-end CONFIRMED outside Tauri. (Check {} orientation by eye — flip fix applied.) ===\n",
            vid, btn, clicked, bar, "dcomp_overlay_test.png"
        );
    } else if pass && !had_video {
        println!(
            "\n=== VERDICT: PARTIAL PASS (no video file) — webview overlay + capture confirmed \
             (button={:?}, clicked={}), but video region was not exercised. Re-run with a video \
             path argv[1] for the full linchpin. ===\n",
            btn, clicked
        );
    } else {
        println!(
            "\n=== VERDICT: LINCHPIN FAIL — clicked={} video_visible={} (video={:?}) \
             button_overlays={} (button={:?}). If video not visible, the lower visual is not \
             showing through the transparent webview (z-order/alpha). If button missing, the \
             webview did not composite above. ===\n",
            clicked, video_visible, vid, button_overlays, btn
        );
    }
}

mod mpv_bridge {
    use super::*;
    use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
    use libmpv2::Mpv;
    use std::path::Path;

    pub fn init_mpv() -> Result<Mpv, String> {
        let mpv = Mpv::with_initializer(|init| {
            init.set_property("vo", "libmpv")?;
            init.set_property("hwdec", "no")?;
            init.set_property("keep-open", "always")?;
            init.set_property("loop-file", "inf")?;
            init.set_property("osd-level", 0_i64)?;
            Ok(())
        })
        .map_err(|e| format!("mpv init failed: {e:?}"))?;
        log::info!("[spike:mpv] Mpv initialized (vo=libmpv, render API, loop)");
        Ok(mpv)
    }

    fn get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
        super::egl_angle::resolve_gl_proc(name)
    }

    pub fn make_render_context(mpv: &mut Mpv) -> Result<RenderContext, String> {
        let params = vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams { get_proc_address, ctx: () }),
        ];
        let handle = unsafe { mpv.ctx.as_mut() };
        let rc = RenderContext::new(handle, params)
            .map_err(|e| format!("RenderContext::new failed: {e:?}"))?;
        log::info!("[spike:mpv] RenderContext created (OpenGL/ANGLE)");
        Ok(rc)
    }

    pub fn load_file(mpv: &Mpv, path: &Path) -> Result<(), String> {
        let p = path.to_string_lossy().to_string();
        let quoted = format!("\"{}\"", p.replace('\\', "\\\\").replace('"', "\\\""));
        mpv.command("loadfile", &[quoted.as_str()])
            .map_err(|e| format!("loadfile failed: {e:?}"))?;
        log::info!("[spike:mpv] loadfile {p}");
        Ok(())
    }

    pub fn render_frame(rc: &RenderContext, fbo: i32, w: i32, h: i32) -> Result<(), String> {
        rc.render::<()>(fbo, w, h, super::MPV_RENDER_FLIP)
            .map_err(|e| format!("render failed: {e:?}"))
    }
}
