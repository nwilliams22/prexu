//! Path C3d (prexu-60mz.4) — Increment 2: the GPU video-render primitives that
//! back mpv's libmpv2 `RenderContext`, lifted from the proven C3b spike
//! (`spike/dcomp-hwdec`) into the app and rewired onto the *secure* ANGLE loader
//! ([`crate::player::angle_loader`]) instead of the spike's bare-name DLL loads.
//!
//! Three pieces, in render order:
//!   1. [`create_shared_texture`] — a `D3D11_RESOURCE_MISC_SHARED` BGRA texture.
//!      mpv draws into it through ANGLE (its GL FBO aliases this exact texture
//!      via the EGL D3D share-handle extension), and we `CopyResource` it into
//!      the composition swapchain backbuffer each frame.
//!   2. [`AngleGl`] — the ANGLE EGL/GLES context plus the share-handle→FBO
//!      bridge. Owns the GL context, which is thread-affine: in Inc3 a dedicated
//!      render thread constructs and drives this.
//!   3. [`create_video_swapchain`] — a `CreateSwapChainForComposition` swapchain
//!      whose backbuffer is presented on the DComp *video* visual (below the
//!      webview visual). Built in Inc2 by [`crate::player::composition_host`].
//!
//! Inc2 wires (1)+(3) into the composition tree and compiles (2) in; the mpv
//! render loop that actually drives all three lands in Inc3, at which point the
//! module-level `dead_code` allow below comes off.
#![cfg(target_os = "windows")]
// Inc2 scaffolding: AngleGl + the shared-texture import path are consumed by the
// mpv render thread in Inc3. Remove when that thread lands.
#![allow(dead_code)]

use std::ffi::c_void;
use std::sync::OnceLock;

use khronos_egl as egl;
use libloading::Library;

use windows::core::{Interface, BOOL};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
    D3D11_RESOURCE_MISC_SHARED, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_IGNORE, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIFactory2, IDXGIResource, IDXGISwapChain1, DXGI_SCALING_STRETCH,
    DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL, DXGI_USAGE_RENDER_TARGET_OUTPUT,
};

use crate::player::angle_loader;

// ── D3D11 / DXGI surfaces ────────────────────────────────────────────────────

/// Shared BGRA render-target texture. mpv's GL FBO aliases this via ANGLE's
/// EGL D3D-share-handle import; we copy it into the swapchain backbuffer each
/// frame. `MISC_SHARED` is what makes the share handle obtainable.
pub fn create_shared_texture(
    device: &ID3D11Device,
    width: u32,
    height: u32,
) -> windows::core::Result<(ID3D11Texture2D, HANDLE)> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
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
    let tex = tex.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
    let dxgi_res: IDXGIResource = tex.cast()?;
    let share_handle = unsafe { dxgi_res.GetSharedHandle()? };
    log::info!(
        "[player:video] shared BGRA texture {}x{} handle={:?}",
        width,
        height,
        share_handle.0
    );
    Ok((tex, share_handle))
}

/// Composition swapchain backing the DComp *video* visual; mpv frames are copied
/// into its backbuffer and `Present`ed. `STRETCH` + `FLIP_SEQUENTIAL` +
/// `ALPHA_IGNORE` match the C3b spike that was verified on a real GPU.
pub fn create_video_swapchain(
    device: &ID3D11Device,
    width: u32,
    height: u32,
) -> windows::core::Result<IDXGISwapChain1> {
    let dxgi_device: IDXGIDevice = device.cast()?;
    let adapter = unsafe { dxgi_device.GetAdapter()? };
    let factory: IDXGIFactory2 = unsafe { adapter.GetParent()? };
    let desc = DXGI_SWAP_CHAIN_DESC1 {
        Width: width,
        Height: height,
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
    let sc = unsafe { factory.CreateSwapChainForComposition(device, &desc, None)? };
    log::info!("[player:video] composition swapchain {}x{} created", width, height);
    Ok(sc)
}

// ── ANGLE EGL/GLES context + shared-texture → GL FBO bridge ───────────────────
//
// Lifted from spike/dcomp-hwdec/src/egl_angle.rs (verified on a real GPU in
// C3b). The one deliberate change for the app: ANGLE is loaded through the
// hardened, Authenticode-verified loader, never by bare DLL name.

// ANGLE extension enum (eglext_angle.h): accepted as <buftype> by
// eglCreatePbufferFromClientBuffer. Value from the Khronos EGL registry.
const EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE: egl::Enum = 0x3200;

type GLenumT = u32;
type GLuintT = u32;
type GLintT = i32;
type GLsizeiT = i32;

const GL_TEXTURE_2D: GLenumT = 0x0DE1;
const GL_FRAMEBUFFER: GLenumT = 0x8D40;
const GL_COLOR_ATTACHMENT0: GLenumT = 0x8CE0;
const GL_FRAMEBUFFER_COMPLETE: GLenumT = 0x8CD5;

type PfnGenTextures = extern "system" fn(GLsizeiT, *mut GLuintT);
type PfnBindTexture = extern "system" fn(GLenumT, GLuintT);
type PfnGenFramebuffers = extern "system" fn(GLsizeiT, *mut GLuintT);
type PfnBindFramebuffer = extern "system" fn(GLenumT, GLuintT);
type PfnFramebufferTexture2D = extern "system" fn(GLenumT, GLenumT, GLenumT, GLuintT, GLintT);
type PfnCheckFramebufferStatus = extern "system" fn(GLenumT) -> GLenumT;
type PfnFinish = extern "system" fn();
type PfnGetError = extern "system" fn() -> GLenumT;

/// Process-global resolver so libmpv2's `OpenGLInitParams.get_proc_address` (a
/// plain `fn` pointer with no captured state) can reach the live EGL instance.
/// Set once in [`AngleGl::create`].
static RESOLVER: OnceLock<ProcResolver> = OnceLock::new();

struct ProcResolver {
    egl: egl::DynamicInstance<egl::EGL1_4>,
    // ANGLE's libGLESv2: some core GL entry points are NOT returned by
    // eglGetProcAddress on Windows ANGLE; fall back to GetProcAddress on the
    // loaded GLESv2 module.
    glesv2: Library,
}

// The libraries hold raw OS handles; the resolver is only ever read, and the GL
// context that uses it is thread-affine (owned by the render thread).
unsafe impl Send for ProcResolver {}
unsafe impl Sync for ProcResolver {}

/// Called by mpv (via `OpenGLInitParams.get_proc_address`) AND by us to load the
/// FBO entry points. Tries `eglGetProcAddress` first, then the GLESv2 module.
pub fn resolve_gl_proc(name: &str) -> *mut c_void {
    let Some(r) = RESOLVER.get() else {
        log::error!("[player:video] resolve_gl_proc('{name}') before AngleGl::create");
        return std::ptr::null_mut();
    };
    if let Some(f) = r.egl.get_proc_address(name) {
        // fn pointer -> data pointer: must go via *const () (a direct fn->*mut
        // cast is rejected by rustc).
        return f as *const () as *mut c_void;
    }
    // Fallback: GetProcAddress on libGLESv2 for core entry points ANGLE's
    // eglGetProcAddress may not return.
    let cname = format!("{name}\0");
    unsafe {
        match r.glesv2.get::<extern "system" fn()>(cname.as_bytes()) {
            Ok(sym) => *sym as *const () as *mut c_void,
            Err(_) => {
                log::trace!("[player:video] '{name}' not found via egl or GLESv2");
                std::ptr::null_mut()
            }
        }
    }
}

fn load<T: Copy>(name: &str) -> Result<T, String> {
    let p = resolve_gl_proc(name);
    if p.is_null() {
        return Err(format!("GL proc '{name}' unresolved"));
    }
    // SAFETY: T is always a fn-pointer type the size of a pointer.
    Ok(unsafe { std::mem::transmute_copy::<*mut c_void, T>(&p) })
}

/// ANGLE EGL/GLES context bound to the shared D3D11 texture as a GL FBO. Owns
/// the GL context (thread-affine — construct and drive from one thread).
pub struct AngleGl {
    egl: &'static egl::DynamicInstance<egl::EGL1_4>,
    display: egl::Display,
    config: egl::Config,
    context: egl::Context,
    width: i32,
    height: i32,
    // populated by import_share_handle_as_fbo
    pbuffer: Option<egl::Surface>,
}

impl AngleGl {
    /// Load ANGLE (securely), get the default (D3D11) display, init, choose an
    /// ES2-capable pbuffer config, and create the context.
    pub fn create(width: i32, height: i32) -> Result<Self, String> {
        // SECURE load: absolute path + SHA-256 pin + Authenticode, no bare name.
        let (egl_lib, glesv2) = angle_loader::load_verified_angle()?;
        let egl_lib: Library = egl_lib.into();
        let glesv2: Library = glesv2.into();
        let egl_inst = unsafe { egl::DynamicInstance::<egl::EGL1_4>::load_required_from(egl_lib) }
            .map_err(|e| format!("DynamicInstance load: {e}"))?;

        RESOLVER
            .set(ProcResolver { egl: egl_inst, glesv2 })
            .map_err(|_| "RESOLVER already set".to_string())?;
        let egl = &RESOLVER.get().unwrap().egl;
        log::info!("[player:video] ANGLE libEGL/libGLESv2 loaded (verified)");

        // EGL_DEFAULT_DISPLAY == null native display.
        let default_display: egl::NativeDisplayType = std::ptr::null_mut();
        let display = unsafe { egl.get_display(default_display) }
            .ok_or_else(|| "eglGetDisplay returned None".to_string())?;
        let (major, minor) = egl
            .initialize(display)
            .map_err(|e| format!("eglInitialize: {e}"))?;
        log::info!("[player:video] EGL {major}.{minor} initialized");

        egl.bind_api(egl::OPENGL_ES_API)
            .map_err(|e| format!("eglBindAPI ES: {e}"))?;

        #[rustfmt::skip]
        let cfg_attrs = [
            egl::SURFACE_TYPE,    egl::PBUFFER_BIT,
            egl::RENDERABLE_TYPE, egl::OPENGL_ES2_BIT,
            egl::RED_SIZE,   8,
            egl::GREEN_SIZE, 8,
            egl::BLUE_SIZE,  8,
            egl::ALPHA_SIZE, 8,
            // Bindable as an RGBA texture (needed for the texture-backed pbuffer).
            egl::BIND_TO_TEXTURE_RGBA, egl::TRUE as egl::Int,
            egl::NONE,
        ];
        let config = egl
            .choose_first_config(display, &cfg_attrs)
            .map_err(|e| format!("eglChooseConfig: {e}"))?
            .ok_or_else(|| "no matching EGL config".to_string())?;

        let ctx_attrs = [egl::CONTEXT_CLIENT_VERSION, 2, egl::NONE];
        let context = egl
            .create_context(display, config, None, &ctx_attrs)
            .map_err(|e| format!("eglCreateContext: {e}"))?;
        log::info!("[player:video] EGL context created (ES2)");

        Ok(Self {
            egl,
            display,
            config,
            context,
            width,
            height,
            pbuffer: None,
        })
    }

    /// Import the D3D11 shared texture into ANGLE as a texture-backed pbuffer,
    /// bind it to a GL texture, attach to a new FBO, and return the FBO id.
    ///
    /// `share_handle` is the HANDLE from `IDXGIResource::GetSharedHandle` cast to
    /// a pointer (the EGLClientBuffer ANGLE expects for buftype
    /// `EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE`).
    pub fn import_share_handle_as_fbo(&mut self, share_handle: *mut c_void) -> Result<i32, String> {
        #[rustfmt::skip]
        let surf_attrs = [
            egl::WIDTH,          self.width,
            egl::HEIGHT,         self.height,
            egl::TEXTURE_TARGET, egl::TEXTURE_2D,
            egl::TEXTURE_FORMAT, egl::TEXTURE_RGBA,
            egl::NONE,
        ];
        let client_buffer = unsafe { egl::ClientBuffer::from_ptr(share_handle) };
        let pbuffer = self
            .egl
            .create_pbuffer_from_client_buffer(
                self.display,
                EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE,
                client_buffer,
                self.config,
                &surf_attrs,
            )
            .map_err(|e| format!("eglCreatePbufferFromClientBuffer (ANGLE D3D share): {e}"))?;
        log::info!("[player:video] imported D3D shared texture as texture-backed pbuffer");

        // Make the imported pbuffer current so GL calls + eglBindTexImage hit the
        // right surface/context.
        self.egl
            .make_current(self.display, Some(pbuffer), Some(pbuffer), Some(self.context))
            .map_err(|e| format!("eglMakeCurrent(pbuffer): {e}"))?;

        // Resolve GL entry points now that a context is current.
        let gen_textures: PfnGenTextures = load("glGenTextures")?;
        let bind_texture: PfnBindTexture = load("glBindTexture")?;
        let gen_framebuffers: PfnGenFramebuffers = load("glGenFramebuffers")?;
        let bind_framebuffer: PfnBindFramebuffer = load("glBindFramebuffer")?;
        let framebuffer_texture_2d: PfnFramebufferTexture2D = load("glFramebufferTexture2D")?;
        let check_fb: PfnCheckFramebufferStatus = load("glCheckFramebufferStatus")?;
        let get_error: PfnGetError = load("glGetError")?;

        let mut tex: GLuintT = 0;
        gen_textures(1, &mut tex);
        bind_texture(GL_TEXTURE_2D, tex);
        self.egl
            .bind_tex_image(self.display, pbuffer, egl::BACK_BUFFER)
            .map_err(|e| format!("eglBindTexImage: {e}"))?;

        let mut fbo: GLuintT = 0;
        gen_framebuffers(1, &mut fbo);
        bind_framebuffer(GL_FRAMEBUFFER, fbo);
        framebuffer_texture_2d(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
        let status = check_fb(GL_FRAMEBUFFER);
        let err = get_error();
        if status != GL_FRAMEBUFFER_COMPLETE {
            return Err(format!(
                "FBO incomplete: status=0x{status:04X} glError=0x{err:04X}"
            ));
        }
        log::info!("[player:video] FBO {fbo} complete over shared texture (glError=0x{err:04X})");

        self.pbuffer = Some(pbuffer);
        Ok(fbo as i32)
    }

    /// Flush GL so mpv's draw completes before the swapchain `CopyResource`.
    pub fn finish(&self) {
        if let Ok(finish) = load::<PfnFinish>("glFinish") {
            finish();
        }
    }
}
