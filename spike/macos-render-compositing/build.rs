// Link the system libmpv (2.5.0, Homebrew) and the macOS frameworks the PoC
// calls directly via FFI. libmpv2-sys emits `cargo:rustc-link-lib=mpv`; we add
// the Homebrew search path so the linker finds libmpv.dylib. GL entry points are
// resolved at runtime via dlsym on the OpenGL framework, so we link OpenGL too.
fn main() {
    // Homebrew libmpv (Apple Silicon prefix).
    println!("cargo:rustc-link-search=native=/opt/homebrew/lib");

    // Frameworks used through raw msg_send!/FFI (objc2 core does not auto-link
    // AppKit/WebKit; we resolve classes at runtime, so link the frameworks here).
    for fw in [
        "AppKit",
        "WebKit",
        "OpenGL",
        "QuartzCore",
        "CoreVideo",
        "CoreGraphics",
        "ImageIO",
        "CoreFoundation",
        "Foundation",
    ] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
}
