//! Path C3c (prexu-60mz.3): host the main window's WebView2 as a
//! DirectComposition visual so the React UI can be composited *above* the mpv
//! video visual on a single HWND (Alt+Tab / capture parity, no black tile).
//!
//! Two halves, both gated on the `PREXU_COMPOSITION_HOST` env flag so default
//! startup is untouched until this path is proven on a real GPU desktop:
//!   1. [`request_hosting`] — called once before the `main` window is built,
//!      flips the vendored-wry opt-in so its WebView2 is created via
//!      `CreateCoreWebView2CompositionController` instead of windowed mode.
//!   2. [`install`] — called from inside `with_webview` once the window exists,
//!      builds the DComp device + target on the main HWND, creates the webview
//!      visual, and `SetRootVisualTarget`s the composition controller into it.
//!
//! The mpv *video* visual (below the webview) is C3d (prexu-60mz.4); until then
//! this renders the React app alone through composition, which is exactly the
//! milestone that proves the webview-host half works.
#![cfg(target_os = "windows")]

use std::cell::RefCell;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2CompositionController, ICoreWebView2Controller,
};
use windows::core::Interface;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;

/// Env flag opting the main window into composition hosting. Off by default.
const FLAG: &str = "PREXU_COMPOSITION_HOST";

thread_local! {
    /// Keeps the DComp tree (device/target/visual) alive for the process
    /// lifetime. Created and only ever touched on the main/UI thread, so a
    /// thread-local is the correct owner for these apartment-threaded COM
    /// objects (they are not `Send`, so they cannot live in Tauri state).
    static HOST: RefCell<Option<CompositionHost>> = const { RefCell::new(None) };
}

struct CompositionHost {
    // Held only to keep the COM tree alive; ordering of drop is irrelevant here
    // because the window outlives the process teardown that matters.
    _d3d: ID3D11Device,
    _device: IDCompositionDevice,
    _target: IDCompositionTarget,
    _webview_visual: IDCompositionVisual,
}

/// Whether composition hosting is requested for this run.
pub fn enabled() -> bool {
    std::env::var_os(FLAG).is_some()
}

/// Flip the vendored-wry opt-in so the next top-level webview built on this
/// thread (the `main` window) is composition-hosted. Must run before Tauri
/// builds that window — i.e. before `Builder::run`.
pub fn request_hosting() {
    log::info!("[player:comp] {FLAG} set — requesting composition hosting for main webview");
    wry::set_pending_composition_hosting(true);
}

/// Build the DComp tree on `hwnd` and hook `controller`'s pixels into it.
///
/// MUST run on the main/UI thread (call from inside `WebviewWindow::with_webview`).
/// `controller` must be the composition controller that [`request_hosting`]
/// caused wry to create; the cast fails for a windowed controller.
pub fn install(hwnd: HWND, controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
    let composition: ICoreWebView2CompositionController = controller.cast()?;

    let d3d = create_d3d11_device()?;
    let dxgi: IDXGIDevice = d3d.cast()?;
    let device: IDCompositionDevice = unsafe { DCompositionCreateDevice(Some(&dxgi))? };
    let target: IDCompositionTarget = unsafe { device.CreateTargetForHwnd(hwnd, true)? };
    let webview_visual: IDCompositionVisual = unsafe { device.CreateVisual()? };

    unsafe { target.SetRoot(&webview_visual)? };
    unsafe { composition.SetRootVisualTarget(&webview_visual)? };
    unsafe { device.Commit()? };

    log::info!(
        "[player:comp] DComp tree committed on HWND={:?}; webview visual-hosted (video visual pending C3d)",
        hwnd.0
    );

    HOST.with(|h| {
        *h.borrow_mut() = Some(CompositionHost {
            _d3d: d3d,
            _device: device,
            _target: target,
            _webview_visual: webview_visual,
        });
    });
    Ok(())
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
