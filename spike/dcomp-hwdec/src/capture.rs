//! SELF-VERIFY leg via Windows.Graphics.Capture — adapted verbatim from the C0
//! spike (prexu-jjbk), trimmed to return the full RGBA buffer + dimensions so the
//! C1 caller can sample ARBITRARY pixels (a background-gap pixel vs a button
//! pixel) instead of only the center.
//!
//! Captures ONE frame of our own window through WGC (the same compositor surface
//! Alt+Tab previews use), copies it to a CPU-readable staging texture, writes a
//! PNG, and hands back the decoded RGBA.
//!
//! THROWAWAY spike. API verified against windows 0.61 bindings (the C0 spike
//! compiled this exact pipeline).

#![cfg(target_os = "windows")]

use std::path::Path;

use windows::core::Interface;
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_MAP_READ,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

/// A decoded captured frame: tightly-packed RGBA8, top-down.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl Frame {
    /// RGBA at (x, y), clamped to bounds. Returns [r, g, b, a].
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let x = x.min(self.width.saturating_sub(1)) as usize;
        let y = y.min(self.height.saturating_sub(1)) as usize;
        let p = (y * self.width as usize + x) * 4;
        [self.rgba[p], self.rgba[p + 1], self.rgba[p + 2], self.rgba[p + 3]]
    }
}

/// Capture one frame of `hwnd`, write it to `out` as a PNG, and return the
/// decoded RGBA frame.
pub fn capture_window(
    hwnd: HWND,
    d3d_device: &ID3D11Device,
    d3d_ctx: &ID3D11DeviceContext,
    out: &Path,
) -> Result<Frame, String> {
    let dxgi: IDXGIDevice = d3d_device
        .cast()
        .map_err(|e| format!("cast ID3D11Device->IDXGIDevice: {e:?}"))?;
    let winrt_device = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }
        .map_err(|e| format!("CreateDirect3D11DeviceFromDXGIDevice: {e:?}"))?;
    let winrt_device: IDirect3DDevice = winrt_device
        .cast()
        .map_err(|e| format!("cast IInspectable->IDirect3DDevice: {e:?}"))?;

    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| format!("get IGraphicsCaptureItemInterop factory: {e:?}"))?;
    let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(hwnd) }
        .map_err(|e| format!("CreateForWindow: {e:?}"))?;
    let size = item.Size().map_err(|e| format!("item.Size: {e:?}"))?;
    log::info!("[spike:capture] capture item {}x{}", size.Width, size.Height);

    let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &winrt_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        1,
        size,
    )
    .map_err(|e| format!("CreateFreeThreaded: {e:?}"))?;
    let session = frame_pool
        .CreateCaptureSession(&item)
        .map_err(|e| format!("CreateCaptureSession: {e:?}"))?;

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let tx = std::sync::Mutex::new(Some(tx));
    let handler =
        TypedEventHandler::<Direct3D11CaptureFramePool, windows::core::IInspectable>::new(
            move |_pool, _args| {
                if let Ok(mut guard) = tx.lock() {
                    if let Some(t) = guard.take() {
                        let _ = t.send(());
                    }
                }
                Ok(())
            },
        );
    let _token = frame_pool
        .FrameArrived(&handler)
        .map_err(|e| format!("FrameArrived subscribe: {e:?}"))?;

    session.StartCapture().map_err(|e| format!("StartCapture: {e:?}"))?;
    log::info!("[spike:capture] session started, waiting for first frame");

    rx.recv_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "timed out waiting for first captured frame".to_string())?;

    let frame = frame_pool
        .TryGetNextFrame()
        .map_err(|e| format!("TryGetNextFrame: {e:?}"))?;
    let surface = frame.Surface().map_err(|e| format!("frame.Surface: {e:?}"))?;
    let access: IDirect3DDxgiInterfaceAccess = surface
        .cast()
        .map_err(|e| format!("cast surface->IDirect3DDxgiInterfaceAccess: {e:?}"))?;
    let frame_tex: ID3D11Texture2D = unsafe { access.GetInterface() }
        .map_err(|e| format!("GetInterface ID3D11Texture2D: {e:?}"))?;

    let _ = session.Close();

    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { frame_tex.GetDesc(&mut desc) };
    let (w, h) = (desc.Width, desc.Height);
    log::info!("[spike:capture] captured texture {}x{} fmt={:?}", w, h, desc.Format);

    let staging_desc = D3D11_TEXTURE2D_DESC {
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
        ..desc
    };
    let mut staging: Option<ID3D11Texture2D> = None;
    unsafe {
        d3d_device
            .CreateTexture2D(&staging_desc, None, Some(&mut staging))
            .map_err(|e| format!("CreateTexture2D(staging): {e:?}"))?;
    }
    let staging = staging.unwrap();
    unsafe { d3d_ctx.CopyResource(&staging, &frame_tex) };

    let mut mapped =
        windows::Win32::Graphics::Direct3D11::D3D11_MAPPED_SUBRESOURCE::default();
    unsafe {
        d3d_ctx
            .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .map_err(|e| format!("Map(staging): {e:?}"))?;
    }
    let row_pitch = mapped.RowPitch as usize;
    let src = mapped.pData as *const u8;
    let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
    for y in 0..h as usize {
        for x in 0..w as usize {
            let sp = unsafe { src.add(y * row_pitch + x * 4) };
            let b = unsafe { *sp };
            let g = unsafe { *sp.add(1) };
            let r = unsafe { *sp.add(2) };
            let a = unsafe { *sp.add(3) };
            let dp = (y * w as usize + x) * 4;
            rgba[dp] = r;
            rgba[dp + 1] = g;
            rgba[dp + 2] = b;
            rgba[dp + 3] = a;
        }
    }
    unsafe { d3d_ctx.Unmap(&staging, 0) };

    write_png(out, w, h, &rgba).map_err(|e| format!("write_png: {e}"))?;
    log::info!("[spike:capture] wrote {}", out.display());

    Ok(Frame { width: w, height: h, rgba })
}

/// Minimal zlib-stored + CRC PNG writer (no image-crate dep for a throwaway).
fn write_png(path: &Path, w: u32, h: u32, rgba: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let mut raw = Vec::with_capacity((w as usize + 1) * h as usize * 4);
    for y in 0..h as usize {
        raw.push(0u8); // filter: None
        let start = y * w as usize * 4;
        raw.extend_from_slice(&rgba[start..start + w as usize * 4]);
    }
    let zlib = zlib_store(&raw);

    let mut out = Vec::new();
    out.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&w.to_be_bytes());
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.push(8); // bit depth
    ihdr.push(6); // color type RGBA
    ihdr.push(0);
    ihdr.push(0);
    ihdr.push(0);
    write_chunk(&mut out, b"IHDR", &ihdr);
    write_chunk(&mut out, b"IDAT", &zlib);
    write_chunk(&mut out, b"IEND", &[]);

    let mut f = std::fs::File::create(path).map_err(|e| e.to_string())?;
    f.write_all(&out).map_err(|e| e.to_string())?;
    Ok(())
}

fn write_chunk(out: &mut Vec<u8>, tag: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(tag);
    out.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(tag);
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
}

fn zlib_store(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(0x78);
    out.push(0x01);
    let mut i = 0;
    while i < data.len() {
        let chunk = std::cmp::min(65535, data.len() - i);
        let last = i + chunk >= data.len();
        out.push(if last { 1 } else { 0 });
        out.extend_from_slice(&(chunk as u16).to_le_bytes());
        out.extend_from_slice(&(!(chunk as u16)).to_le_bytes());
        out.extend_from_slice(&data[i..i + chunk]);
        i += chunk;
    }
    out.extend_from_slice(&adler32(data).to_be_bytes());
    out
}

fn adler32(data: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}
