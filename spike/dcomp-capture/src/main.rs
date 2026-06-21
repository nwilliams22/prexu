//! THROWAWAY feasibility spike — beads prexu-jjbk / Path C0.
//!
//! Question this binary answers: if mpv renders video into a D3D11 texture that
//! is presented on a **DirectComposition visual** attached to a *plain
//! top-level window* (NOT a WS_CHILD, NOT --wid), does Windows.Graphics.Capture
//! (the same compositor surface that Alt+Tab/WGC previews use) actually capture
//! the video?
//!
//! Path A (WS_CHILD) already failed in the app (see host_window.rs comments):
//! airspace hides controls and a child surface is not a shippable overlay. Path
//! C bets on DComp giving us ONE composed surface that both shows the video AND
//! is captured. This spike de-risks the single unproven leg.
//!
//! Pipeline (steps map to the task spec):
//!   1. CreateWindowExW — plain WS_OVERLAPPEDWINDOW top-level window.
//!   2. ANGLE GLES context via EGL (libEGL.dll loaded dynamically).
//!   3. mpv render API (libmpv2 safe RenderContext + OpenGLInitParams).
//!   4. Render-target bridge: shared D3D11 texture <-> ANGLE GL FBO.
//!   5. Present the D3D11 texture on a DComp visual; Commit.
//!   6. SELF-VERIFY: Windows.Graphics.Capture one frame -> staging tex -> PNG +
//!      center-pixel non-black check.
//!
//! RUN: see RUN.md. Needs a GPU/display, a video file path as argv[1], and
//! ANGLE's libEGL.dll/libGLESv2.dll on PATH (or next to the exe).

#![cfg(target_os = "windows")]

use std::ffi::c_void;
use std::path::PathBuf;

use windows::core::{w, Interface, BOOL, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HMODULE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_RESOURCE_MISC_SHARED, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_IGNORE, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIFactory2, IDXGIResource, IDXGISwapChain1, DXGI_SCALING_STRETCH,
    DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL, DXGI_USAGE_RENDER_TARGET_OUTPUT,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, PeekMessageW, RegisterClassExW,
    ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, MSG, PM_REMOVE, SW_SHOW,
    WNDCLASSEXW, WS_OVERLAPPEDWINDOW,
};

mod egl_angle;
mod capture;

use egl_angle::AngleGl;

const WIDTH: i32 = 1280;
const HEIGHT: i32 = 720;

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}

/// Step 1: a plain top-level window. Deliberately NOT WS_CHILD and NOT given to
/// mpv via --wid — DComp owns the surface.
fn create_plain_window() -> windows::core::Result<HWND> {
    // GetModuleHandleW -> HMODULE; HINSTANCE is the form WNDCLASSEXW/CreateWindow
    // expect. windows-rs provides From<HMODULE> for HINSTANCE.
    let hmodule: HMODULE =
        unsafe { windows::Win32::System::LibraryLoader::GetModuleHandleW(PCWSTR::null())? };
    let hinstance: HINSTANCE = hmodule.into();
    let class = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wnd_proc),
        hInstance: hinstance,
        lpszClassName: w!("PrexuDCompSpike"),
        ..Default::default()
    };
    unsafe { RegisterClassExW(&class) };

    let hwnd = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("PrexuDCompSpike"),
            w!("Prexu DComp Capture Spike"),
            WS_OVERLAPPEDWINDOW,
            100,
            100,
            WIDTH,
            HEIGHT,
            None,
            None,
            Some(hinstance),
            None,
        )?
    };
    log::info!("[spike:win] CreateWindowExW HWND={:?} ({}x{})", hwnd.0, WIDTH, HEIGHT);
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOW);
    }
    Ok(hwnd)
}

/// Step 5 (device side): create the D3D11 device DComp will composite with.
fn create_d3d11_device() -> windows::core::Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
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

/// Step 4 (target): a shared, render-target BGRA texture. The SHARED misc flag
/// lets us pull a share handle to hand to ANGLE so mpv's GL FBO and DComp see
/// the SAME pixels.
fn create_shared_texture(
    device: &ID3D11Device,
) -> windows::core::Result<(ID3D11Texture2D, windows::Win32::Foundation::HANDLE)> {
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

    // GetSharedHandle (legacy NT-less share handle) — exactly the handle type
    // EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE expects (verified vs ANGLE
    // EGL_ANGLE_d3d_share_handle_client_buffer spec).
    let dxgi_res: IDXGIResource = tex.cast()?;
    let share_handle = unsafe { dxgi_res.GetSharedHandle()? };
    log::info!(
        "[spike:d3d] shared BGRA texture {}x{} share_handle={:?}",
        WIDTH, HEIGHT, share_handle.0
    );
    Ok((tex, share_handle))
}

/// Bundle of DComp objects kept alive for the window's lifetime.
struct DComp {
    device: IDCompositionDevice,
    _target: IDCompositionTarget,
    _visual: IDCompositionVisual,
    /// Composition swapchain that actually backs the visual content. We copy the
    /// mpv-rendered shared texture into this each frame and Present it.
    swapchain: IDXGISwapChain1,
}

/// Step 5 (compose): DComp device -> target for our hwnd -> visual -> content.
///
/// CORRECTION (verified vs dcomp.h docs): IDCompositionVisual::SetContent does
/// NOT accept a raw ID3D11Texture2D — only an IDCompositionSurface or an
/// IDXGISwapChain1. So we create a composition swapchain (FLIP_SEQUENTIAL +
/// SCALING_STRETCH, the only modes CreateSwapChainForComposition allows) and use
/// it as the visual content; the render loop copies the shared texture into its
/// back buffer and Presents.
fn setup_dcomp(hwnd: HWND, d3d_device: &ID3D11Device) -> windows::core::Result<DComp> {
    let dxgi_device: IDXGIDevice = d3d_device.cast()?;

    // DXGI factory (from the device's adapter) for the composition swapchain.
    let adapter = unsafe { dxgi_device.GetAdapter()? };
    let factory: IDXGIFactory2 = unsafe { adapter.GetParent()? };

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
        AlphaMode: DXGI_ALPHA_MODE_IGNORE,
        Flags: 0,
    };
    let swapchain: IDXGISwapChain1 =
        unsafe { factory.CreateSwapChainForComposition(d3d_device, &sc_desc, None)? };
    log::info!("[spike:dcomp] composition swapchain {}x{} created", WIDTH, HEIGHT);

    // windows-rs: DCompositionCreateDevice<T: Interface>(Option<&IDXGIDevice>) -> Result<T>.
    let device: IDCompositionDevice = unsafe { DCompositionCreateDevice(Some(&dxgi_device))? };
    let target: IDCompositionTarget =
        unsafe { device.CreateTargetForHwnd(hwnd, true)? };
    let visual: IDCompositionVisual = unsafe { device.CreateVisual()? };
    unsafe { visual.SetContent(&swapchain)? };
    unsafe { target.SetRoot(&visual)? };
    unsafe { device.Commit()? };
    log::info!("[spike:dcomp] device+target+visual wired, swapchain set as content, committed");

    Ok(DComp {
        device,
        _target: target,
        _visual: visual,
        swapchain,
    })
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

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).init();
    log::info!("[spike] dcomp-capture feasibility spike (prexu-jjbk / Path C0) starting");

    let video: Option<PathBuf> = std::env::args().nth(1).map(PathBuf::from);
    match &video {
        Some(p) => log::info!("[spike] video file: {}", p.display()),
        None => log::warn!("[spike] no video path given as argv[1] — mpv will have nothing to play; pass a file to see real frames"),
    }

    if let Err(e) = run(video) {
        log::error!("[spike] FATAL: {e:#}");
        std::process::exit(1);
    }
}

fn run(video: Option<PathBuf>) -> anyhow_lite::Result<()> {
    // ── Step 1: plain top-level window ───────────────────────────────────────
    let hwnd = create_plain_window().map_err(|e| format!("create_plain_window: {e:?}"))?;

    // ── Step 5a: D3D11 device (used by DComp + shared texture + capture) ──────
    let (d3d_device, d3d_ctx) =
        create_d3d11_device().map_err(|e| format!("create_d3d11_device: {e:?}"))?;

    // ── Step 4a: shared render-target texture + its share handle ─────────────
    let (shared_tex, share_handle) =
        create_shared_texture(&d3d_device).map_err(|e| format!("create_shared_texture: {e:?}"))?;

    // ── Step 2 + 4b: ANGLE EGL context, import shared texture as GL FBO ───────
    // This is the riskiest leg: ANGLE's d3d_share_handle_client_buffer is known
    // to produce black textures / need keyed-mutex sync (ANGLE issue #141).
    let mut gl = AngleGl::create(WIDTH, HEIGHT)
        .map_err(|e| format!("AngleGl::create (EGL/ANGLE init): {e}"))?;
    let fbo = gl
        .import_share_handle_as_fbo(share_handle.0 as *mut c_void)
        .map_err(|e| format!("import_share_handle_as_fbo: {e}"))?;
    log::info!("[spike:gl] mpv will render into GL FBO id={fbo}");

    // ── Step 3: mpv + safe render context ────────────────────────────────────
    let mut mpv = mpv_bridge::init_mpv()?;
    let render = mpv_bridge::make_render_context(&mut mpv)?;
    if let Some(v) = &video {
        mpv_bridge::load_file(&mpv, v)?;
    }

    // ── Step 5b: DComp visual backed by a composition swapchain ───────────────
    let dcomp = setup_dcomp(hwnd, &d3d_device).map_err(|e| format!("setup_dcomp: {e:?}"))?;

    // ── Render loop: mpv -> shared GL FBO -> copy into swapchain -> Present -> Commit
    // We render unconditionally each iteration (the update callback just nudges)
    // to keep the spike simple. AdvancedControl is off, so render() is allowed
    // on this thread (the one that made the GL context current).
    log::info!("[spike] entering render loop (~120 frames)");
    for frame in 0..120 {
        pump_messages();
        // Drain mpv render-update flag (not strictly required without
        // AdvancedControl, but keeps mpv's clock happy).
        let _ = render.update();
        // mpv renders into our imported GL FBO (which aliases the shared D3D
        // texture). flip=true: GL is bottom-up, the D3D texture is top-down.
        if let Err(e) = mpv_bridge::render_frame(&render, fbo, WIDTH, HEIGHT) {
            log::error!("[spike:mpv] render_frame failed at frame {frame}: {e}");
            break;
        }
        gl.finish(); // ensure GL writes land in the shared texture before D3D reads

        // Copy the shared (mpv-rendered) texture into the swapchain back buffer,
        // then Present so DComp shows the new frame.
        match unsafe { dcomp.swapchain.GetBuffer::<ID3D11Texture2D>(0) } {
            Ok(back) => {
                unsafe { d3d_ctx.CopyResource(&back, &shared_tex) };
                if let Err(e) = unsafe { dcomp.swapchain.Present(1, Default::default()) }.ok() {
                    log::warn!("[spike:dcomp] Present failed at frame {frame}: {e:?}");
                }
            }
            Err(e) => log::warn!("[spike:dcomp] GetBuffer failed at frame {frame}: {e:?}"),
        }
        let _ = unsafe { dcomp.device.Commit() };
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
    log::info!("[spike] render loop done");

    // ── Step 6: SELF-VERIFY via Windows.Graphics.Capture ─────────────────────
    let out = std::env::current_dir()
        .unwrap_or_default()
        .join("capture_test.png");
    match capture::capture_window_to_png(hwnd, &d3d_device, &d3d_ctx, &out) {
        Ok(result) => {
            log::info!(
                "[spike:capture] wrote {} ; center pixel rgba={:?} non_black={}",
                out.display(),
                result.center_rgba,
                result.non_black
            );
            if result.non_black {
                println!("\n=== VERDICT: LINCHPIN PASS — capture_test.png center is NON-BLACK (video captured from DComp surface) ===\n");
            } else {
                println!("\n=== VERDICT: LINCHPIN FAIL — capture_test.png center is BLACK. DComp visual NOT in the captured surface (or mpv drew black). KILL SIGNAL for Path C unless the window itself visibly shows video. ===\n");
            }
        }
        Err(e) => {
            log::error!("[spike:capture] capture failed: {e}");
            println!("\n=== VERDICT: INCONCLUSIVE — capture path errored: {e} ===\n");
        }
    }

    Ok(())
}

// ── tiny local error alias so we don't pull anyhow as a dep ──────────────────
mod anyhow_lite {
    pub type Result<T> = std::result::Result<T, String>;
}

mod mpv_bridge {
    use super::*;
    use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
    use libmpv2::Mpv;
    use std::path::Path;

    /// Step 3a: construct mpv. NOTE: we do NOT set `wid` — the render API
    /// REPLACES wid (verified: mpv render docs + libmpv2 render module).
    pub fn init_mpv() -> Result<Mpv, String> {
        let mpv = Mpv::with_initializer(|init| {
            // vo must be libmpv when using the render API.
            init.set_property("vo", "libmpv")?;
            init.set_property("hwdec", "no")?; // keep the spike simple/portable
            init.set_property("keep-open", "always")?;
            init.set_property("osd-level", 0_i64)?;
            Ok(())
        })
        .map_err(|e| format!("mpv init failed: {e:?}"))?;
        log::info!("[spike:mpv] Mpv initialized (vo=libmpv, render API)");
        Ok(mpv)
    }

    /// resolve a GL function through ANGLE's eglGetProcAddress. The `ctx` we
    /// thread through OpenGLInitParams is a raw pointer to our AngleGl's EGL
    /// instance accessor (set up so this fn can call it). To keep lifetimes
    /// sane for a `fn` pointer (not a closure), we stash a process-global
    /// resolver in egl_angle.
    fn get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
        super::egl_angle::resolve_gl_proc(name)
    }

    /// Step 3b: the safe RenderContext. RenderContext::new takes &mut mpv_handle
    /// (verified: libmpv2 4.1 docs). We get it from Mpv.ctx: NonNull<mpv_handle>.
    pub fn make_render_context(mpv: &mut Mpv) -> Result<RenderContext, String> {
        let params = vec![
            RenderParam::ApiType(RenderParamApiType::OpenGl),
            RenderParam::InitParams(OpenGLInitParams {
                get_proc_address,
                ctx: (),
            }),
        ];
        // SAFETY: Mpv.ctx points at a live mpv_handle owned by `mpv`; the
        // RenderContext borrows it for as long as we keep both alive in run().
        let handle = unsafe { mpv.ctx.as_mut() };
        let rc = RenderContext::new(handle, params)
            .map_err(|e| format!("RenderContext::new failed: {e:?}"))?;
        log::info!("[spike:mpv] RenderContext created (OpenGL/ANGLE)");
        Ok(rc)
    }

    pub fn load_file(mpv: &Mpv, path: &Path) -> Result<(), String> {
        let p = path.to_string_lossy().to_string();
        mpv.command("loadfile", &[p.as_str()])
            .map_err(|e| format!("loadfile failed: {e:?}"))?;
        log::info!("[spike:mpv] loadfile {p}");
        Ok(())
    }

    /// Step 3c: render one mpv frame into the given GL FBO id.
    /// RenderContext::render is generic over a phantom GLContext; turbofish ().
    pub fn render_frame(rc: &RenderContext, fbo: i32, w: i32, h: i32) -> Result<(), String> {
        rc.render::<()>(fbo, w, h, true)
            .map_err(|e| format!("render failed: {e:?}"))
    }
}
