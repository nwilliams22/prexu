//! THROWAWAY feasibility spike — beads prexu-60mz.1 / Path C3a.
//!
//! Question this binary answers (the C3 fork-vs-bypass GATE):
//!   Does Tauri's IPC MECHANISM still work when the WebView2 is hosted in VISUAL
//!   mode (CreateCoreWebView2CompositionController + SetRootVisualTarget) instead
//!   of windowed mode?
//!
//! Tauri's invoke/emit bridge is built entirely on the ICoreWebView2 core:
//!   - AddScriptToExecuteOnDocumentCreated  — Tauri injects its bootstrap script
//!   - add_WebMessageReceived               — JS `window.ipc.postMessage` -> Rust
//!   - PostWebMessageAsString / ExecuteScript — Rust -> JS (invoke reply + emit)
//! The CoreWebView2 is obtained the SAME way from a windowed or a composition
//! controller, so if these primitives round-trip on a composition-hosted webview,
//! a forked-wry composition path will carry Tauri IPC intact.
//!
//! This spike, on a COMPOSITION-hosted webview:
//!   1. injects `window.__PREXU_BRIDGE_READY__ = true` via
//!      AddScriptToExecuteOnDocumentCreated (proves init-script injection),
//!   2. the page checks that flag, registers a message listener, and posts
//!      `ping` via window.chrome.webview.postMessage (the native channel
//!      wry/Tauri wrap as window.ipc),
//!   3. Rust's add_WebMessageReceived handler replies `pong` via
//!      PostWebMessageAsString,
//!   4. the page receives `pong` and sets document.title = "IPC_OK".
//! Verdict polls DocumentTitle: "IPC_OK" => full bidirectional IPC survives.
//!
//! RUN: see RUN.md. Needs a GPU/interactive desktop + the WebView2 runtime.

#![cfg(target_os = "windows")]

use std::cell::RefCell;
use std::rc::Rc;

use windows::core::{w, Interface, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, PeekMessageW, PostQuitMessage,
    RegisterClassExW, ShowWindow, TranslateMessage, MSG, PM_REMOVE, SW_SHOW, WM_DESTROY,
    WNDCLASSEXW, WS_OVERLAPPEDWINDOW,
};

use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2CompositionController,
    ICoreWebView2Controller, ICoreWebView2Environment, ICoreWebView2Environment3,
    ICoreWebView2WebMessageReceivedEventArgs,
};
use webview2_com::{
    AddScriptToExecuteOnDocumentCreatedCompletedHandler,
    CreateCoreWebView2CompositionControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler, WebMessageReceivedEventHandler,
};

const WIDTH: i32 = 900;
const HEIGHT: i32 = 600;

const BRIDGE_SCRIPT: &str = "window.__PREXU_BRIDGE_READY__ = true;";

/// Mirrors Tauri's round-trip: init-script flag must be present, then JS posts
/// `ping` over the native channel and flips the title only when `pong` returns.
const TEST_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
  if (!window.__PREXU_BRIDGE_READY__) {
    document.title = 'NO_BRIDGE';            // AddScript did not run
  } else {
    window.chrome.webview.addEventListener('message', e => {
      if (e.data === 'pong') document.title = 'IPC_OK';
    });
    window.chrome.webview.postMessage('ping'); // JS -> Rust
  }
</script></body></html>"#;

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
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
        lpfnWndProc: Some(wnd_proc),
        hInstance: hinstance.into(),
        lpszClassName: w!("PrexuWv2IpcSpike"),
        ..Default::default()
    };
    unsafe { RegisterClassExW(&class) };
    let hwnd = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("PrexuWv2IpcSpike"),
            w!("Prexu WebView2 + Tauri-IPC Spike (Path C3a)"),
            WS_OVERLAPPEDWINDOW,
            120,
            120,
            WIDTH,
            HEIGHT,
            None,
            None,
            Some(hinstance.into()),
            None,
        )?
    };
    log::info!("[spike:win] CreateWindowExW HWND={:?}", hwnd.0);
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOW);
    }
    Ok(hwnd)
}

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
    Ok(device.unwrap())
}

struct DComp {
    device: IDCompositionDevice,
    _target: IDCompositionTarget,
    webview_visual: IDCompositionVisual,
}

/// Minimal one-visual DComp tree so the composition controller has a genuine
/// RootVisualTarget (we are testing IPC on a real visual-hosted webview).
fn setup_dcomp(hwnd: HWND, d3d: &ID3D11Device) -> windows::core::Result<DComp> {
    let dxgi_device: IDXGIDevice = d3d.cast()?;
    let device: IDCompositionDevice = unsafe { DCompositionCreateDevice(Some(&dxgi_device))? };
    let target: IDCompositionTarget = unsafe { device.CreateTargetForHwnd(hwnd, true)? };
    let webview_visual: IDCompositionVisual = unsafe { device.CreateVisual()? };
    unsafe { target.SetRoot(&webview_visual)? };
    unsafe { device.Commit()? };
    log::info!("[spike:dcomp] one-visual tree committed (webview target)");
    Ok(DComp { device, _target: target, webview_visual })
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
    let user_data = std::env::temp_dir().join("prexu-wv2-ipc-spike");
    let udf = wide(&user_data.to_string_lossy());
    let slot: Rc<RefCell<Option<ICoreWebView2Environment>>> = Rc::new(RefCell::new(None));
    let slot2 = slot.clone();
    CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), PCWSTR(udf.as_ptr()), None, &handler)
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
    let slot: Rc<RefCell<Option<ICoreWebView2CompositionController>>> = Rc::new(RefCell::new(None));
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

/// Inject the bootstrap flag (Tauri uses this exact call for its IPC bootstrap).
fn inject_bridge_script(webview: &ICoreWebView2) -> Result<(), String> {
    let script = wide(BRIDGE_SCRIPT);
    let wv = webview.clone();
    AddScriptToExecuteOnDocumentCreatedCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            wv.AddScriptToExecuteOnDocumentCreated(PCWSTR(script.as_ptr()), &handler)
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |hr, _id| {
            hr?;
            Ok(())
        }),
    )
    .map_err(|e| format!("AddScriptToExecuteOnDocumentCreated: {e:?}"))
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).init();
    log::info!("[spike] wv2-tauri-ipc spike (prexu-60mz.1 / Path C3a) starting");
    if let Err(e) = run() {
        log::error!("[spike] FATAL: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }
        .map_err(|e| format!("CoInitializeEx: {e:?}"))?;

    let hwnd = create_plain_window().map_err(|e| format!("create_plain_window: {e:?}"))?;
    let d3d = create_d3d11_device().map_err(|e| format!("create_d3d11_device: {e:?}"))?;
    let dcomp = setup_dcomp(hwnd, &d3d).map_err(|e| format!("setup_dcomp: {e:?}"))?;

    let env = create_environment().map_err(|e| format!("create_environment: {e:?}"))?;
    let comp = create_composition_controller(&env, hwnd)
        .map_err(|e| format!("create_composition_controller: {e:?}"))?;
    unsafe { comp.SetRootVisualTarget(&dcomp.webview_visual) }
        .map_err(|e| format!("SetRootVisualTarget: {e:?}"))?;
    let controller: ICoreWebView2Controller =
        comp.cast().map_err(|e| format!("cast comp->Controller: {e:?}"))?;
    let bounds = RECT { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
    unsafe { controller.SetBounds(bounds) }.map_err(|e| format!("SetBounds: {e:?}"))?;
    unsafe { controller.SetIsVisible(true) }.map_err(|e| format!("SetIsVisible: {e:?}"))?;
    unsafe { dcomp.device.Commit() }.map_err(|e| format!("Commit: {e:?}"))?;

    let webview: ICoreWebView2 =
        unsafe { controller.CoreWebView2() }.map_err(|e| format!("CoreWebView2: {e:?}"))?;

    // ── Wire Tauri's exact IPC primitives on the composition-hosted core ─────
    // (1) init-script injection
    inject_bridge_script(&webview)?;
    log::info!("[spike:ipc] bootstrap script registered (AddScriptToExecuteOnDocumentCreated)");

    // (2) JS -> Rust: on 'ping', reply 'pong' (Rust -> JS) via PostWebMessageAsString
    let reply_target = webview.clone();
    let got_ping = Rc::new(RefCell::new(false));
    let got_ping2 = got_ping.clone();
    let handler = WebMessageReceivedEventHandler::create(Box::new(
        move |_wv: Option<ICoreWebView2>, args: Option<ICoreWebView2WebMessageReceivedEventArgs>| {
            if let Some(args) = args {
                let mut msg = windows::core::PWSTR::null();
                if unsafe { args.TryGetWebMessageAsString(&mut msg) }.is_ok() && !msg.is_null() {
                    let s = webview2_com::take_pwstr(msg);
                    log::info!("[spike:ipc] WebMessageReceived from JS: {:?}", s);
                    if s == "ping" {
                        *got_ping2.borrow_mut() = true;
                        let pong = wide("pong");
                        let _ = unsafe {
                            reply_target.PostWebMessageAsString(PCWSTR(pong.as_ptr()))
                        };
                        log::info!("[spike:ipc] replied pong (PostWebMessageAsString)");
                    }
                }
            }
            Ok(())
        },
    ));
    let mut token = 0i64;
    unsafe { webview.add_WebMessageReceived(&handler, &mut token) }
        .map_err(|e| format!("add_WebMessageReceived: {e:?}"))?;

    // (3) navigate the round-trip page
    let html = wide(TEST_HTML);
    unsafe { webview.NavigateToString(PCWSTR(html.as_ptr())) }
        .map_err(|e| format!("NavigateToString: {e:?}"))?;
    log::info!("[spike:ipc] navigated; waiting for IPC round-trip");

    // Poll DocumentTitle for the verdict (~5s).
    let mut title = String::new();
    for _ in 0..100 {
        pump_messages();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let mut t = windows::core::PWSTR::null();
        if unsafe { webview.DocumentTitle(&mut t) }.is_ok() && !t.is_null() {
            title = webview2_com::take_pwstr(t);
            if title == "IPC_OK" || title == "NO_BRIDGE" {
                break;
            }
        }
    }

    let ping = *got_ping.borrow();
    log::info!("[spike:ipc] final title={:?} got_ping={}", title, ping);
    if title == "IPC_OK" && ping {
        println!(
            "\n=== VERDICT: PASS — Tauri IPC primitives work on a VISUAL-HOSTED WebView2: \
             init-script injected, JS->Rust postMessage received (ping), Rust->JS \
             PostWebMessageAsString delivered (pong), round-trip confirmed (title=IPC_OK). \
             Forking wry for composition hosting will carry Tauri invoke/emit intact. ===\n"
        );
    } else if title == "NO_BRIDGE" {
        println!(
            "\n=== VERDICT: FAIL — AddScriptToExecuteOnDocumentCreated did NOT run under \
             composition hosting (page saw no bridge flag). Init-script injection is broken. ===\n"
        );
    } else {
        println!(
            "\n=== VERDICT: FAIL — IPC round-trip incomplete (title={:?}, got_ping={}). \
             If got_ping=false, JS->Rust postMessage did not arrive; if true but no IPC_OK, \
             Rust->JS PostWebMessageAsString did not reach the page. ===\n",
            title, ping
        );
    }

    let _ = unsafe { webview.remove_WebMessageReceived(token) };
    Ok(())
}
