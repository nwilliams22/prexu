use std::env;
use std::path::PathBuf;

fn main() {
    // Copy libmpv-2.dll into bin/ FIRST so tauri_build sees the bundled
    // resource exists when it validates tauri.conf.json.
    #[cfg(target_os = "windows")]
    copy_libmpv_dll();

    tauri_build::build();
}

#[cfg(target_os = "windows")]
fn copy_libmpv_dll() {
    let Some(source) = env::var_os("MPV_SOURCE") else {
        println!("cargo:warning=MPV_SOURCE unset; libmpv-2.dll will not be bundled");
        return;
    };
    let src = PathBuf::from(source).join("64").join("libmpv-2.dll");
    println!("cargo:rerun-if-changed={}", src.display());
    println!("cargo:rerun-if-env-changed=MPV_SOURCE");

    if !src.exists() {
        println!(
            "cargo:warning=libmpv-2.dll not found at {}; runtime load will fail",
            src.display()
        );
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());

    // 1. Copy into src-tauri/bin/ so tauri.conf.json bundle.resources picks it
    //    up at `tauri build` time.
    let bundle_dir = manifest_dir.join("bin");
    let bundle_dest = bundle_dir.join("libmpv-2.dll");
    if let Err(e) = std::fs::copy(&src, &bundle_dest) {
        println!(
            "cargo:warning=Failed to copy libmpv-2.dll to {}: {}",
            bundle_dest.display(),
            e
        );
    }

    // 2. Copy next to the built exe so `cargo run` / `tauri dev` find it via
    //    the application directory search path. OUT_DIR is
    //    target/<profile>/build/<crate>-<hash>/out — walk up to <profile>.
    if let Ok(out_dir) = env::var("OUT_DIR") {
        let out_dir = PathBuf::from(out_dir);
        if let Some(target_dir) = out_dir.ancestors().nth(3) {
            let dev_dest = target_dir.join("libmpv-2.dll");
            if let Err(e) = std::fs::copy(&src, &dev_dest) {
                println!(
                    "cargo:warning=Failed to copy libmpv-2.dll to {}: {}",
                    dev_dest.display(),
                    e
                );
            }
        }
    }
}
