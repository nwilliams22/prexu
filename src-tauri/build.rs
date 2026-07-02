// `env` / `PathBuf` are only used by the Windows-only libmpv/ANGLE DLL-staging
// helpers below; other targets link libmpv via the system/bundle path.
#[cfg(target_os = "windows")]
use std::env;
#[cfg(target_os = "windows")]
use std::path::PathBuf;

fn main() {
    // Copy libmpv-2.dll into bin/ FIRST so tauri_build sees the bundled
    // resource exists when it validates tauri.conf.json.
    #[cfg(target_os = "windows")]
    copy_libmpv_dll();

    // Path C3d: place the ANGLE DLLs (libEGL/libGLESv2) next to the exe for the
    // dev runtime. Source is bin/ (the bundled resource), optionally refreshed
    // from ANGLE_SOURCE. SHA-256-pinned + Authenticode-verified at load time
    // (see player::angle_loader).
    #[cfg(target_os = "windows")]
    copy_angle_dlls();

    // Delay-load libmpv-2.dll. mpv's DllMain on Windows touches state that's
    // unsafe to use during DLL_PROCESS_ATTACH; static linking causes an
    // access violation at process startup. With /DELAYLOAD the DLL isn't
    // resolved until the first mpv_* call, by which time normal init is done.
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-arg=/DELAYLOAD:libmpv-2.dll");
        println!("cargo:rustc-link-arg=/DEFAULTLIB:delayimp.lib");
    }

    tauri_build::build();
}

#[cfg(target_os = "windows")]
fn copy_angle_dlls() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let bin = manifest_dir.join("bin");
    println!("cargo:rerun-if-env-changed=ANGLE_SOURCE");

    // Optionally refresh bin/ from a caller-provided ANGLE distribution.
    if let Some(src_dir) = env::var_os("ANGLE_SOURCE") {
        let src_dir = PathBuf::from(src_dir);
        for name in ["libEGL.dll", "libGLESv2.dll"] {
            let s = src_dir.join(name);
            if s.exists() {
                copy_if_newer(&s, &bin.join(name));
            }
        }
    }

    // Copy next to the built exe so dev/`tauri dev` finds them via the app dir.
    if let Ok(out_dir) = env::var("OUT_DIR") {
        let out_dir = PathBuf::from(out_dir);
        if let Some(target_dir) = out_dir.ancestors().nth(3) {
            for name in ["libEGL.dll", "libGLESv2.dll"] {
                let s = bin.join(name);
                println!("cargo:rerun-if-changed={}", s.display());
                if s.exists() {
                    copy_if_newer(&s, &target_dir.join(name));
                } else {
                    println!(
                        "cargo:warning=ANGLE {name} missing from bin/; Path C3d video render will fail until it is provided"
                    );
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn copy_libmpv_dll() {
    // MPV_SOURCE env var wins. In DEBUG builds falls back to C:\libmpv (the
    // install location documented in docs/native-player-status.md step 1.2).
    // The fallback exists because some launchers (npm.cmd → tauri-cli → cargo)
    // strip env vars on Windows, making MPV_SOURCE-only too brittle for
    // `npm run tauri dev`.
    //
    // In RELEASE builds the fallback is disabled: loading a DLL from a
    // world-writable well-known path is a DLL-planting vector. Release builds
    // must set MPV_SOURCE explicitly so the DLL origin is auditable.
    let profile = env::var("PROFILE").unwrap_or_default();
    let source = match env::var_os("MPV_SOURCE") {
        Some(val) => PathBuf::from(val),
        None => {
            if profile == "release" {
                // Hard error: do not fall back to a hardcoded path in release.
                // This aborts the build so the DLL-planting risk can never ship.
                eprintln!(
                    "cargo:error=MPV_SOURCE must be set for release builds; \
                     falling back to a hardcoded path is a DLL-planting risk"
                );
                panic!(
                    "MPV_SOURCE env var is required for release builds \
                     (set it to the directory containing 64\\libmpv-2.dll)"
                );
            }
            // Debug/dev convenience fallback only.
            PathBuf::from(r"C:\libmpv")
        }
    };
    let src = source.join("64").join("libmpv-2.dll");
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
    //    up at `tauri build` time. Idempotent — skipping when already current
    //    avoids a tauri-cli watcher rebuild loop on `npm run tauri dev`.
    let bundle_dir = manifest_dir.join("bin");
    let bundle_dest = bundle_dir.join("libmpv-2.dll");
    copy_if_newer(&src, &bundle_dest);

    // 2. Copy next to the built exe so `cargo run` / `tauri dev` find it via
    //    the application directory search path. OUT_DIR is
    //    target/<profile>/build/<crate>-<hash>/out — walk up to <profile>.
    if let Ok(out_dir) = env::var("OUT_DIR") {
        let out_dir = PathBuf::from(out_dir);
        if let Some(target_dir) = out_dir.ancestors().nth(3) {
            let dev_dest = target_dir.join("libmpv-2.dll");
            copy_if_newer(&src, &dev_dest);
        }
    }
}

#[cfg(target_os = "windows")]
fn copy_if_newer(src: &std::path::Path, dest: &std::path::Path) {
    let needs_copy = match (std::fs::metadata(src), std::fs::metadata(dest)) {
        (Ok(s), Ok(d)) => match (s.modified(), d.modified()) {
            (Ok(s_m), Ok(d_m)) => s_m > d_m || s.len() != d.len(),
            _ => true,
        },
        (Ok(_), Err(_)) => true,
        _ => false, // src missing — caller already handled this
    };
    if !needs_copy {
        return;
    }
    if let Err(e) = std::fs::copy(src, dest) {
        println!(
            "cargo:warning=Failed to copy libmpv-2.dll to {}: {}",
            dest.display(),
            e
        );
    }
}
