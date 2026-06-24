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

use std::ffi::c_void;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use khronos_egl as egl;
use libloading::Library;
use libmpv2::render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType};
use libmpv2::Mpv;

use windows::core::{Interface, BOOL};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_RESOURCE_MISC_SHARED, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT,
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

/// Load ANGLE (securely) and publish the process-global EGL resolver, once.
/// Idempotent: returns the existing instance on every call after the first, so
/// repeated player init/destroy cycles each get a usable EGL instance instead of
/// failing on a second set. If two threads race, the loser drops its instance
/// and uses the winner's.
fn ensure_resolver() -> Result<&'static egl::DynamicInstance<egl::EGL1_4>, String> {
    if let Some(r) = RESOLVER.get() {
        return Ok(&r.egl);
    }
    // SECURE load: absolute path + SHA-256 pin + Authenticode, no bare name.
    let (egl_lib, glesv2) = angle_loader::load_verified_angle()?;
    let egl_lib: Library = egl_lib.into();
    let glesv2: Library = glesv2.into();
    let egl_inst = unsafe { egl::DynamicInstance::<egl::EGL1_4>::load_required_from(egl_lib) }
        .map_err(|e| format!("DynamicInstance load: {e}"))?;
    // Ignore a set race: another thread winning is fine — we use whatever's set.
    let _ = RESOLVER.set(ProcResolver { egl: egl_inst, glesv2 });
    log::info!("[player:video] ANGLE libEGL/libGLESv2 loaded (verified)");
    Ok(&RESOLVER.get().unwrap().egl)
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
    // Kept alive (not read) so the texture-backed pbuffer the FBO draws into
    // outlives rendering; populated by import_share_handle_as_fbo.
    _pbuffer: Option<egl::Surface>,
}

impl AngleGl {
    /// Load ANGLE (securely), get the default (D3D11) display, init, choose an
    /// ES2-capable pbuffer config, and create the context.
    pub fn create(width: i32, height: i32) -> Result<Self, String> {
        // The ANGLE libraries + EGL instance are process-global and loaded once
        // (idempotent): a player can init→destroy→re-init many times (warmup
        // probe, then each playback), and every render thread builds a fresh
        // context over the SAME EGL instance.
        let egl = ensure_resolver()?;

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
            _pbuffer: None,
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

        self._pbuffer = Some(pbuffer);
        Ok(fbo as i32)
    }

    /// Flush GL so mpv's draw completes before the swapchain `CopyResource`.
    pub fn finish(&self) {
        if let Ok(finish) = load::<PfnFinish>("glFinish") {
            finish();
        }
    }
}

impl Drop for AngleGl {
    /// Release the EGL context + imported pbuffer. Runs on the render thread that
    /// owns the (thread-affine) context, when `render_loop` returns at teardown.
    /// Without this, each player init→destroy cycle would leak a context + a
    /// pbuffer over the shared texture. The EGL instance/display are global and
    /// intentionally kept (reused by the next render thread).
    fn drop(&mut self) {
        let _ = self.egl.make_current(self.display, None, None, None);
        if let Some(pb) = self._pbuffer.take() {
            let _ = self.egl.destroy_surface(self.display, pb);
        }
        let _ = self.egl.destroy_context(self.display, self.context);
        log::debug!("[player:video] AngleGl released (context + pbuffer)");
    }
}

// ── Surface hand-off: main thread → render thread ─────────────────────────────
//
// The DComp tree, swapchain, and shared texture are all built on the MAIN thread
// (in `composition_host::install`, at window-creation time). The mpv render
// thread is spawned later, from `ensure_init` on a tokio worker (first playback).
// This slot carries the GPU surfaces across that gap. `windows` COM interfaces
// are `Send + Sync`; only `HANDLE` is not, so the bundle gets a manual `Send`.

/// GPU surfaces the render thread needs: our D3D11 device (for the immediate
/// context that copies frames), the composition swapchain it presents into, the
/// shared texture mpv draws into via ANGLE, and that texture's share handle.
///
/// `Clone` is a COM refcount bump (+ a `Copy` of the share handle), so each
/// player init can cheaply claim its own references while the originals stay
/// alive in the DComp tree.
#[derive(Clone)]
pub struct VideoSurfaces {
    pub device: ID3D11Device,
    pub swapchain: IDXGISwapChain1,
    pub shared_tex: ID3D11Texture2D,
    pub share_handle: HANDLE,
    pub width: u32,
    pub height: u32,
}

// SAFETY: the COM interfaces are `Send`; `HANDLE` is a global D3D share handle
// that is valid process-wide and only read on the render thread. The bundle is
// produced on the main thread and consumed once on the render thread — never
// aliased across threads simultaneously.
unsafe impl Send for VideoSurfaces {}

/// Set by `composition_host::install` (main thread), taken by `ensure_init`
/// (worker) when it starts the render thread. `None` until install runs.
static PENDING_SURFACES: Mutex<Option<VideoSurfaces>> = Mutex::new(None);

/// Publish the GPU surfaces for the render thread to claim. Overwrites any prior
/// (a re-install replaces stale surfaces).
pub fn publish_surfaces(surfaces: VideoSurfaces) {
    match PENDING_SURFACES.lock() {
        Ok(mut slot) => {
            *slot = Some(surfaces);
            log::info!("[player:video] surfaces published for render thread");
        }
        Err(e) => log::error!("[player:video] publish_surfaces lock poisoned: {e}"),
    }
}

/// Claim a clone of the published GPU surfaces, LEAVING them in place so the
/// next player init (warmup probe, then each playback) can claim again. Returns
/// `None` only if composition hosting never installed them (install failed/didn't
/// run), in which case the caller has no video target and skips the render thread.
pub fn claim_surfaces() -> Option<VideoSurfaces> {
    match PENDING_SURFACES.lock() {
        Ok(slot) => slot.clone(),
        Err(e) => {
            log::error!("[player:video] claim_surfaces lock poisoned: {e}");
            None
        }
    }
}

// ── Render thread ─────────────────────────────────────────────────────────────

/// Composition-swapchain frames are not flipped at present time (unlike a
/// windowed swapchain), so mpv must NOT flip either. Settled in the C0/C3b spike.
const RENDER_FLIP: bool = false;

/// Fallback wait so a missed wake (or a stop racing a wake) can never hang
/// teardown longer than this.
const WAIT_TIMEOUT: Duration = Duration::from_millis(100);

/// mpv resolves GL entry points through this (a plain `fn`, no captured state) →
/// the process-global ANGLE resolver.
fn get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
    resolve_gl_proc(name)
}

/// Cross-thread wake/stop signal for the render loop. mpv's render-update
/// callback raises `wake`; teardown raises `stop`.
struct RenderSignal {
    state: Mutex<SignalState>,
    cv: Condvar,
}

struct SignalState {
    wake: bool,
    stop: bool,
}

#[derive(PartialEq, Eq)]
enum WaitVerdict {
    Frame,
    Stop,
}

impl RenderSignal {
    fn new() -> Self {
        Self {
            state: Mutex::new(SignalState { wake: false, stop: false }),
            cv: Condvar::new(),
        }
    }

    /// Raised by mpv's update callback (any thread). MUST NOT call any mpv API —
    /// it only flips a flag and notifies, per the libmpv render-callback contract.
    fn wake(&self) {
        if let Ok(mut s) = self.state.lock() {
            s.wake = true;
            self.cv.notify_one();
        }
    }

    fn request_stop(&self) {
        if let Ok(mut s) = self.state.lock() {
            s.stop = true;
            self.cv.notify_one();
        }
    }

    /// Block until a frame is signalled or stop is requested.
    fn wait(&self) -> WaitVerdict {
        let Ok(mut s) = self.state.lock() else {
            return WaitVerdict::Stop;
        };
        loop {
            if s.stop {
                return WaitVerdict::Stop;
            }
            if s.wake {
                s.wake = false;
                return WaitVerdict::Frame;
            }
            match self.cv.wait_timeout(s, WAIT_TIMEOUT) {
                Ok((guard, _)) => s = guard,
                Err(_) => return WaitVerdict::Stop,
            }
        }
    }
}

/// Owns the mpv→DComp render thread. Drop (or [`stop`](Self::stop)) signals the
/// loop and joins it, which frees the `RenderContext` before the caller releases
/// its `Arc<Mpv>` — the ordering `mpv_render_context_free` before
/// `mpv_terminate_destroy` requires.
pub struct VideoRenderThread {
    signal: Arc<RenderSignal>,
    handle: Option<JoinHandle<()>>,
}

impl VideoRenderThread {
    /// Spawn the render thread. `mpv` is cloned so the thread keeps mpv alive
    /// for as long as its `RenderContext` exists; teardown stops+joins this
    /// thread before the final `Arc<Mpv>` drops.
    pub fn start(mpv: Arc<Mpv>, surfaces: VideoSurfaces) -> Self {
        let signal = Arc::new(RenderSignal::new());
        let signal_for_thread = Arc::clone(&signal);
        let handle = std::thread::Builder::new()
            .name("prexu-video-render".to_string())
            .spawn(move || {
                if let Err(e) = render_loop(mpv, surfaces, signal_for_thread) {
                    log::error!("[player:video] render thread error: {e}");
                }
                log::info!("[player:video] render thread exited");
            })
            .map_err(|e| log::error!("[player:video] spawn render thread failed: {e}"))
            .ok();
        Self { signal, handle }
    }

    /// Signal stop and join. Idempotent-safe via `Drop`.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.signal.request_stop();
        if let Some(h) = self.handle.take() {
            if h.join().is_err() {
                log::warn!("[player:video] render thread join failed (panicked)");
            }
        }
    }
}

impl Drop for VideoRenderThread {
    fn drop(&mut self) {
        if self.handle.is_some() {
            self.shutdown();
        }
    }
}

/// The render thread body: own the ANGLE GL context + mpv `RenderContext`, then
/// each woken frame: `update` → `render` into the shared texture → `CopyResource`
/// into the swapchain backbuffer → `Present`. Presenting a composition swapchain
/// updates the DComp video visual without a per-frame `Commit`.
fn render_loop(
    mpv: Arc<Mpv>,
    surfaces: VideoSurfaces,
    signal: Arc<RenderSignal>,
) -> Result<(), String> {
    let VideoSurfaces { device, swapchain, shared_tex, share_handle, width, height } = surfaces;

    // The immediate context is used ONLY on this thread (the main thread never
    // touches it after resource creation), so single-threaded use is sound even
    // though ID3D11DeviceContext is not free-threaded.
    let ctx: ID3D11DeviceContext =
        unsafe { device.GetImmediateContext() }.map_err(|e| format!("GetImmediateContext: {e:?}"))?;

    // ANGLE GL context is thread-affine — created and driven entirely here.
    let mut gl = AngleGl::create(width as i32, height as i32)?;
    let fbo = gl.import_share_handle_as_fbo(share_handle.0 as *mut c_void)?;

    // RenderContext over the live mpv handle. The handle is internally
    // synchronized and `mpv` outlives this thread (our Arc clone keeps it alive;
    // teardown joins us before its final Arc drops), so aliasing it here is sound.
    let mut render = {
        let handle = unsafe { &mut *mpv.ctx.as_ptr() };
        RenderContext::new(
            handle,
            vec![
                RenderParam::ApiType(RenderParamApiType::OpenGl),
                RenderParam::InitParams(OpenGLInitParams { get_proc_address, ctx: () }),
            ],
        )
        .map_err(|e| format!("RenderContext::new: {e:?}"))?
    };

    // Wake this loop whenever mpv has a new frame or needs a redraw.
    {
        let sig = Arc::clone(&signal);
        render.set_update_callback(move || sig.wake());
    }
    log::info!("[player:video] render thread up ({width}x{height}, fbo={fbo})");

    while signal.wait() == WaitVerdict::Frame {
        let flags = match render.update() {
            Ok(f) => f,
            Err(e) => {
                log::warn!("[player:video] render update failed: {e:?}");
                continue;
            }
        };
        if flags & libmpv2_sys::mpv_render_update_flag_MPV_RENDER_UPDATE_FRAME == 0 {
            continue;
        }
        if let Err(e) = render.render::<()>(fbo, width as i32, height as i32, RENDER_FLIP) {
            log::warn!("[player:video] render failed: {e:?}");
            continue;
        }
        gl.finish();
        match unsafe { swapchain.GetBuffer::<ID3D11Texture2D>(0) } {
            Ok(back) => {
                unsafe { ctx.CopyResource(&back, &shared_tex) };
                let _ = unsafe { swapchain.Present(1, Default::default()) }.ok();
            }
            Err(e) => log::warn!("[player:video] swapchain GetBuffer failed: {e:?}"),
        }
    }

    // Free the mpv render context HERE, before we drop our `Arc<Mpv>` clone, so
    // mpv_render_context_free runs before any mpv_terminate_destroy.
    log::info!("[player:video] render thread stopping; freeing RenderContext");
    drop(render);
    Ok(())
}
