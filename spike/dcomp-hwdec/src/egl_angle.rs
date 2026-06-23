//! Step 2 + 4b: ANGLE EGL/GLES context and the shared-D3D11-texture -> GL FBO
//! bridge. THROWAWAY spike code (prexu-jjbk).
//!
//! Verified against:
//!   - khronos-egl 6.0.0 docs (Instance/DynamicInstance method signatures).
//!   - ANGLE EGL_ANGLE_d3d_share_handle_client_buffer extension spec
//!     (EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE = 0x3200; pbuffer-from-client-
//!     buffer creates a texture-backed pbuffer over the D3D share handle).
//!
//! KNOWN RISK (documented loudly in the report): ANGLE's share-handle import is
//! historically prone to producing BLACK textures and needs IDXGIKeyedMutex
//! synchronization (ANGLE issue #141 / Mozilla bug 1066312). If mpv draws but
//! capture is black, this leg is the prime suspect, not DComp.

#![cfg(target_os = "windows")]

use std::ffi::c_void;
use std::sync::OnceLock;

use khronos_egl as egl;
use libloading::Library;

// ANGLE extension enum (eglext_angle.h). Accepted as <buftype> by
// eglCreatePbufferFromClientBuffer. VERIFIED value via Khronos EGL registry.
const EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE: egl::Enum = 0x3200;

// ── GLES 2 function pointers we need for the FBO (resolved via eglGetProcAddress
//    / GetProcAddress through ANGLE's libGLESv2). Signatures from the GLES 2.0
//    spec / khrplatform. ─────────────────────────────────────────────────────
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
type PfnFramebufferTexture2D =
    extern "system" fn(GLenumT, GLenumT, GLenumT, GLuintT, GLintT);
type PfnCheckFramebufferStatus = extern "system" fn(GLenumT) -> GLenumT;
type PfnFinish = extern "system" fn();
type PfnGetError = extern "system" fn() -> GLenumT;

/// Process-global resolver so libmpv2's `OpenGLInitParams.get_proc_address`
/// (a plain `fn` pointer, no captured state) can reach the live EGL instance.
/// Set once in `AngleGl::create`.
static RESOLVER: OnceLock<ProcResolver> = OnceLock::new();

struct ProcResolver {
    egl: egl::DynamicInstance<egl::EGL1_4>,
    // ANGLE's libGLESv2: some core GL entry points are NOT returned by
    // eglGetProcAddress on Windows ANGLE; fall back to GetProcAddress on the
    // loaded GLESv2 module.
    glesv2: Library,
}

// The libraries hold raw OS handles; sharing the resolver across the (single-
// threaded) spike is fine. We only read from it.
unsafe impl Send for ProcResolver {}
unsafe impl Sync for ProcResolver {}

/// Called by mpv (via OpenGLInitParams.get_proc_address) AND by us to load the
/// FBO entry points. Tries eglGetProcAddress first, then the GLESv2 module.
pub fn resolve_gl_proc(name: &str) -> *mut c_void {
    let Some(r) = RESOLVER.get() else {
        log::error!("[spike:gl] resolve_gl_proc('{name}') before AngleGl::create");
        return std::ptr::null_mut();
    };
    if let Some(f) = r.egl.get_proc_address(name) {
        // fn pointer -> data pointer: must go via *const () (direct fn->*mut cast
        // is rejected by rustc).
        return f as *const () as *mut c_void;
    }
    // Fallback: GetProcAddress on libGLESv2 for core entry points ANGLE's
    // eglGetProcAddress may not return. libloading::Library::get on a function
    // symbol returns a Symbol<fn()>; deref to the fn and cast to a void ptr.
    let cname = format!("{name}\0");
    unsafe {
        match r.glesv2.get::<extern "system" fn()>(cname.as_bytes()) {
            Ok(sym) => *sym as *const () as *mut c_void,
            Err(_) => {
                log::trace!("[spike:gl] '{name}' not found via egl or GLESv2");
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
    /// Step 2: load ANGLE, get the (default/D3D11) display, init, choose an
    /// ES2/3-capable pbuffer config, create + make-current a context.
    pub fn create(width: i32, height: i32) -> Result<Self, String> {
        // ANGLE ships libEGL.dll + libGLESv2.dll; both must be loadable.
        let egl_lib = unsafe { Library::new("libEGL.dll") }
            .map_err(|e| format!("load libEGL.dll (ANGLE): {e}"))?;
        let glesv2 = unsafe { Library::new("libGLESv2.dll") }
            .map_err(|e| format!("load libGLESv2.dll (ANGLE): {e}"))?;
        let egl_inst = unsafe { egl::DynamicInstance::<egl::EGL1_4>::load_required_from(egl_lib) }
            .map_err(|e| format!("DynamicInstance load: {e}"))?;

        RESOLVER
            .set(ProcResolver { egl: egl_inst, glesv2 })
            .map_err(|_| "RESOLVER already set".to_string())?;
        let egl = &RESOLVER.get().unwrap().egl;
        log::info!("[spike:egl] ANGLE libEGL/libGLESv2 loaded");

        // EGL_DEFAULT_DISPLAY == null native display. Annotate the null so the
        // pointer type resolves to khronos-egl's NativeDisplayType.
        let default_display: egl::NativeDisplayType = std::ptr::null_mut();
        let display = unsafe { egl.get_display(default_display) }
            .ok_or_else(|| "eglGetDisplay returned None".to_string())?;
        let (major, minor) = egl
            .initialize(display)
            .map_err(|e| format!("eglInitialize: {e}"))?;
        log::info!("[spike:egl] EGL {major}.{minor} initialized");

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

        // mpv's render API needs a current context (any surface; we make a 1x1
        // dummy pbuffer current first, then swap to the real one after import).
        // Make current with no surface is invalid on ES; create the real shared
        // pbuffer in import_share_handle_as_fbo and make it current there.
        log::info!("[spike:egl] context created (ES2); config chosen");

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

    /// Step 4b: import the D3D11 shared texture into ANGLE as a texture-backed
    /// pbuffer, bind it to a GL texture, attach to a new FBO, return the FBO id.
    ///
    /// `share_handle` is the HANDLE from IDXGIResource::GetSharedHandle, cast to
    /// a pointer (that is the EGLClientBuffer ANGLE expects for buftype
    /// EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE).
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
        log::info!("[spike:egl] imported D3D shared texture as texture-backed pbuffer");

        // Make the imported pbuffer current so GL calls and eglBindTexImage hit
        // the right surface/context.
        self.egl
            .make_current(
                self.display,
                Some(pbuffer),
                Some(pbuffer),
                Some(self.context),
            )
            .map_err(|e| format!("eglMakeCurrent(pbuffer): {e}"))?;
        log::info!("[spike:egl] context+pbuffer made current");

        // Resolve GL entry points now that a context is current.
        let gen_textures: PfnGenTextures = load("glGenTextures")?;
        let bind_texture: PfnBindTexture = load("glBindTexture")?;
        let gen_framebuffers: PfnGenFramebuffers = load("glGenFramebuffers")?;
        let bind_framebuffer: PfnBindFramebuffer = load("glBindFramebuffer")?;
        let framebuffer_texture_2d: PfnFramebufferTexture2D = load("glFramebufferTexture2D")?;
        let check_fb: PfnCheckFramebufferStatus = load("glCheckFramebufferStatus")?;
        let get_error: PfnGetError = load("glGetError")?;

        // glBindTexImage is an EGL call: bind the pbuffer to the bound GL tex.
        // khronos-egl exposes it as Instance::bind_tex_image.
        let mut tex: GLuintT = 0;
        gen_textures(1, &mut tex);
        bind_texture(GL_TEXTURE_2D, tex);
        self.egl
            .bind_tex_image(self.display, pbuffer, egl::BACK_BUFFER)
            .map_err(|e| format!("eglBindTexImage: {e}"))?;

        let mut fbo: GLuintT = 0;
        gen_framebuffers(1, &mut fbo);
        bind_framebuffer(GL_FRAMEBUFFER, fbo);
        framebuffer_texture_2d(
            GL_FRAMEBUFFER,
            GL_COLOR_ATTACHMENT0,
            GL_TEXTURE_2D,
            tex,
            0,
        );
        let status = check_fb(GL_FRAMEBUFFER);
        let err = get_error();
        if status != GL_FRAMEBUFFER_COMPLETE {
            return Err(format!(
                "FBO incomplete: status=0x{status:04X} glError=0x{err:04X}"
            ));
        }
        log::info!("[spike:gl] FBO {fbo} complete over shared texture (glError=0x{err:04X})");

        self.pbuffer = Some(pbuffer);
        Ok(fbo as i32)
    }

    pub fn finish(&self) {
        if let Ok(finish) = load::<PfnFinish>("glFinish") {
            finish();
        }
    }
}
