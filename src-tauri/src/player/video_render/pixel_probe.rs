//! Opt-in, bounded readback for software-display black-output diagnosis.
//! Readbacks synchronize the GPU and may change reproduction timing. Never
//! enable this for ordinary playback or interpret a passing sample as a fix.
use super::{load, PfnBindFramebuffer, PfnGetError, GL_FRAMEBUFFER};
use std::ffi::c_void;
use std::time::{Duration, Instant};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};

const GRID: u32 = 5;
const LIMIT: u32 = 120;
type GetInteger = extern "system" fn(u32, *mut i32);
type ReadPixels = extern "system" fn(i32, i32, i32, i32, u32, u32, *mut c_void);

pub(super) struct PixelProbe {
    started: Instant,
    last: Option<Instant>,
    samples: u32,
}

impl PixelProbe {
    pub(super) fn from_env() -> Option<Self> {
        if std::env::var("PREXU_VIDEO_PIXEL_PROBE").as_deref() != Ok("1") {
            return None;
        }
        log::info!("[player:video] pixel probe enabled: 5x5 grid, 2s interval, {LIMIT} samples maximum; readback changes timing");
        Some(Self {
            started: Instant::now(),
            last: None,
            samples: 0,
        })
    }

    pub(super) fn due(&mut self) -> bool {
        if self.samples >= LIMIT
            || self
                .last
                .is_some_and(|t| t.elapsed() < Duration::from_secs(2))
        {
            return false;
        }
        self.samples += 1;
        self.last = Some(Instant::now());
        true
    }

    // Called after copy-fence completion, before Present or the next mpv render.
    // All three observations therefore refer to the same submitted frame.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn sample(
        &self,
        device: &ID3D11Device,
        ctx: &ID3D11DeviceContext,
        shared: &ID3D11Texture2D,
        back: &ID3D11Texture2D,
        fbo: i32,
        width: u32,
        height: u32,
        frame: u64,
    ) {
        let start = Instant::now();
        let gl = sample_gl(fbo, width, height);
        let shared = sample_d3d(device, ctx, shared, width, height);
        let back = sample_d3d(device, ctx, back, width, height);
        log::info!(
            "[player:video] pixels sample={} frame={frame} elapsed_ms={} size={width}x{height} gl={gl:?} shared={shared:?} back={back:?} readback_ms={}",
            self.samples, self.started.elapsed().as_millis(), start.elapsed().as_millis()
        );
    }
}

// Interior grid avoids window borders and samples beyond a central black patch.
fn coordinate(index: u32, extent: u32) -> u32 {
    ((u64::from(index + 1) * u64::from(extent)) / u64::from(GRID + 1)) as u32
}

#[derive(Debug, PartialEq)]
struct Summary {
    nonblack: u32,
    max_rgb: u8,
    hash: u64,
}

fn summarize(pixels: &[[u8; 4]]) -> Summary {
    let mut result = Summary {
        nonblack: 0,
        max_rgb: 0,
        hash: 0xcbf29ce484222325,
    };
    for pixel in pixels {
        let max = *pixel[..3].iter().max().unwrap();
        result.max_rgb = result.max_rgb.max(max);
        result.nonblack += u32::from(max > 16);
        // Exclude alpha: an opaque black frame is still black.
        for byte in &pixel[..3] {
            result.hash = (result.hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
        }
    }
    result
}

fn sample_gl(fbo: i32, width: u32, height: u32) -> Result<Summary, String> {
    let bind = load::<PfnBindFramebuffer>("glBindFramebuffer")?;
    let get = load::<GetInteger>("glGetIntegerv")?;
    let read = load::<ReadPixels>("glReadPixels")?;
    let error = load::<PfnGetError>("glGetError")?;
    let prior_error = error();
    if prior_error != 0 {
        return Err(format!("preexisting GL error 0x{prior_error:x}"));
    }
    let mut previous = 0;
    get(0x8CA6, &mut previous); // GL_FRAMEBUFFER_BINDING (GLES2 context)
    bind(GL_FRAMEBUFFER, fbo as u32);
    let mut pixels = [[0u8; 4]; (GRID * GRID) as usize];
    for y in 0..GRID {
        for x in 0..GRID {
            // D3D top-to-bottom ordering; GLES origin is bottom-left.
            let pixel = &mut pixels[(y * GRID + x) as usize];
            read(
                coordinate(x, width) as i32,
                (height - 1 - coordinate(y, height)) as i32,
                1,
                1,
                0x1908,
                0x1401,
                pixel.as_mut_ptr().cast(),
            ); // RGBA / UNSIGNED_BYTE
        }
    }
    bind(GL_FRAMEBUFFER, previous as u32);
    let code = error();
    if code != 0 {
        return Err(format!("GL readback error 0x{code:x}"));
    }
    Ok(summarize(&pixels))
}

fn sample_d3d(
    device: &ID3D11Device,
    ctx: &ID3D11DeviceContext,
    source: &ID3D11Texture2D,
    width: u32,
    height: u32,
) -> Result<Summary, String> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: GRID,
        Height: GRID,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        ..Default::default()
    };
    let mut staging = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut staging)) }
        .map_err(|e| format!("CreateTexture2D: {e}"))?;
    let staging = staging.ok_or("missing staging texture")?;
    for y in 0..GRID {
        for x in 0..GRID {
            let left = coordinate(x, width);
            let top = coordinate(y, height);
            let region = D3D11_BOX {
                left,
                top,
                front: 0,
                right: left + 1,
                bottom: top + 1,
                back: 1,
            };
            unsafe { ctx.CopySubresourceRegion(&staging, 0, x, y, 0, source, 0, Some(&region)) };
        }
    }
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }
        .map_err(|e| format!("Map: {e}"))?;
    let mut pixels = [[0u8; 4]; (GRID * GRID) as usize];
    for y in 0..GRID {
        for x in 0..GRID {
            // Mapped staging rows may be padded; only read each 4-byte pixel.
            let p = unsafe {
                mapped
                    .pData
                    .cast::<u8>()
                    .add((y * mapped.RowPitch + x * 4) as usize)
            };
            let bgra = unsafe { std::slice::from_raw_parts(p, 4) };
            pixels[(y * GRID + x) as usize] = [bgra[2], bgra[1], bgra[0], bgra[3]];
        }
    }
    unsafe { ctx.Unmap(&staging, 0) };
    Ok(summarize(&pixels))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_black_is_black_and_rgb_changes_are_visible() {
        assert_eq!(summarize(&[[0, 0, 0, 255]]).nonblack, 0);
        assert_eq!(summarize(&[[16, 16, 16, 255]]).nonblack, 0);
        assert_eq!(summarize(&[[0, 17, 0, 255]]).nonblack, 1);
        assert_eq!(summarize(&[[1, 2, 3, 0]]), summarize(&[[1, 2, 3, 255]]));
        assert_ne!(summarize(&[[20, 0, 0, 255]]), summarize(&[[0, 20, 0, 255]]));
    }

    #[test]
    fn coordinates_stay_inside_even_tiny_surfaces() {
        for extent in [1, 2, 5, 800, 1920, u32::MAX] {
            for index in 0..GRID {
                assert!(coordinate(index, extent) < extent);
            }
        }
    }

    #[test]
    fn sampling_is_rate_limited_and_capped() {
        let mut probe = PixelProbe {
            started: Instant::now(),
            last: None,
            samples: 0,
        };
        assert!(probe.due());
        assert!(!probe.due());
        probe.last = Some(Instant::now() - Duration::from_secs(3));
        assert!(probe.due());
        probe.samples = LIMIT;
        probe.last = None;
        assert!(!probe.due());
    }
}
