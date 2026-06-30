// Link the system libmpv (2.5.0, has render.h) and libepoxy (the GL dispatch
// library GTK already uses for GtkGLArea) so we can call mpv_render_* and a few
// GL entry points via raw FFI. gtk/webkit2gtk crates link themselves.
fn main() {
    let mpv = pkg_config::Config::new()
        .probe("mpv")
        .expect("system libmpv (mpv.pc) not found — install libmpv-devel");
    println!("[build] libmpv {}", mpv.version);
    // GL entry points are resolved at runtime via eglGetProcAddress (dlopen'd),
    // so we don't link libepoxy/libGL here.
}
