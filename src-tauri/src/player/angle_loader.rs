//! Path C3d (prexu-60mz.4): secure loading of the ANGLE DLLs (libEGL +
//! libGLESv2) that back mpv's OpenGL-ES RenderContext.
//!
//! Loading native DLLs is a classic Windows attack surface (DLL search-order
//! hijack / planting). Every load here is hardened:
//!   1. **No bare-name loads.** ANGLE is loaded by ABSOLUTE path from the
//!      application directory (`current_exe()`-derived), so the OS never walks
//!      CWD/`PATH` to resolve it.
//!   2. **Restricted dependency search.** `LoadLibraryEx` with
//!      `SEARCH_SYSTEM32 | SEARCH_DLL_LOAD_DIR` resolves ANGLE's own
//!      dependencies (libGLESv2 pulls d3dcompiler etc.) only from System32 and
//!      the DLL's own directory — never CWD/`PATH`.
//!   3. **Integrity pin.** Each DLL's exact bytes are pinned by SHA-256 and
//!      checked before load (always enforced).
//!   4. **Provenance.** Authenticode is verified with `WinVerifyTrust`
//!      (enforced in release; a warning in debug so a developer can swap a
//!      locally-built ANGLE after updating the pin).
//!   5. **Process-wide.** [`harden_dll_search_path`] removes CWD and `PATH`
//!      from the default search for ALL loads in the process, keeping only the
//!      app dir + System32.
//!
//! TODO(C3d release): the pinned DLLs are Microsoft-signed ANGLE binaries
//! sourced during development. Before shipping, re-pin against the vetted
//! upstream and keep Authenticode enforcement on in release.
#![cfg(target_os = "windows")]

use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use libloading::os::windows::{
    Library, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32,
};
use sha2::{Digest, Sha256};
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::Security::WinTrust::{
    WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
    WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
    WTD_STATEACTION_VERIFY, WTD_UI_NONE,
};
use windows::Win32::System::LibraryLoader::{
    SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_APPLICATION_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32 as W_SYSTEM32,
    LOAD_LIBRARY_SEARCH_USER_DIRS,
};

/// SHA-256 pins of the vetted (Microsoft-signed) ANGLE DLLs in `bin/`.
/// Update both the file and the pin together; a mismatch hard-fails the load.
const EGL_SHA256: &str = "a86422d6d679dda4c00bb0db813884eb14857924eb391fb48283dfca5be007ef";
const GLESV2_SHA256: &str =
    "b48565279ebfcc75675e9b88a1835bd9fd94016290641bc98108ae382962b2f3";

/// Remove CWD and `PATH` from the process-wide DLL search order, keeping only
/// the application directory + System32 (+ explicitly-added user dirs). Call
/// once, as early as possible in startup, BEFORE any third-party DLL loads.
///
/// The app dir is retained so the delay-loaded `libmpv-2.dll` and WebView2's
/// loader still resolve; only the attacker-controllable CWD/`PATH` entries are
/// dropped.
pub fn harden_dll_search_path() {
    let flags = W_SYSTEM32 | LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_USER_DIRS;
    match unsafe { SetDefaultDllDirectories(flags) } {
        Ok(()) => log::info!("[player:angle] DLL search path hardened (app dir + System32 only)"),
        Err(e) => log::warn!("[player:angle] SetDefaultDllDirectories failed: {:?}", e),
    }
}

/// Directory of the running executable (where bundled DLLs live).
fn app_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "exe has no parent dir".to_string())
}

/// Load both ANGLE DLLs, verified. Returns (libEGL, libGLESv2) kept alive by
/// the caller. libGLESv2 is loaded first so it is resident when libEGL pulls it.
// TODO(C3d increment 2): remove allow once the RenderContext path calls this.
#[allow(dead_code)]
pub fn load_verified_angle() -> Result<(Library, Library), String> {
    let dir = app_dir()?;
    let glesv2 = load_verified(&dir.join("libGLESv2.dll"), GLESV2_SHA256)?;
    let egl = load_verified(&dir.join("libEGL.dll"), EGL_SHA256)?;
    Ok((egl, glesv2))
}

fn load_verified(path: &Path, expected_sha256: &str) -> Result<Library, String> {
    if !path.exists() {
        return Err(format!("ANGLE DLL missing: {}", path.display()));
    }
    verify_sha256(path, expected_sha256)?;

    match verify_authenticode(path) {
        Ok(()) => log::info!("[player:angle] verified (sha256 + Authenticode): {}", path.display()),
        Err(e) => {
            if cfg!(debug_assertions) {
                log::warn!("[player:angle] Authenticode check failed (allowed in debug): {e}");
            } else {
                return Err(format!("Authenticode verification failed for {}: {e}", path.display()));
            }
        }
    }

    // Absolute path + restricted dependency search (System32 + the DLL's own
    // directory). Never CWD/PATH.
    unsafe {
        Library::load_with_flags(
            path,
            LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
        )
        .map_err(|e| format!("LoadLibraryEx {}: {e}", path.display()))
    }
}

/// Exact-bytes integrity check.
fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let digest = Sha256::digest(&bytes);
    let got = digest.iter().fold(String::with_capacity(64), |mut s, b| {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
        s
    });
    if got.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "sha256 pin mismatch for {}: expected {expected}, got {got}",
            path.display()
        ))
    }
}

/// Authenticode signature validation via WinVerifyTrust (chain to a trusted
/// root, no UI, no network revocation to keep it fast/offline-safe).
// The `dwStateAction = CLOSE` write is consumed by the second WinVerifyTrust
// through `pdata` (a raw pointer the borrow checker can't follow).
#[allow(unused_assignments)]
fn verify_authenticode(path: &Path) -> Result<(), String> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(wide.as_ptr()),
        ..Default::default()
    };

    let mut action: GUID = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let mut data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut file_info },
        dwStateAction: WTD_STATEACTION_VERIFY,
        ..Default::default()
    };

    // hwnd = null: never show UI (paired with WTD_UI_NONE).
    let hwnd = HWND(std::ptr::null_mut());
    let pdata = &mut data as *mut WINTRUST_DATA as *mut core::ffi::c_void;
    let status = unsafe { WinVerifyTrust(hwnd, &mut action, pdata) };

    // Always release the state data, regardless of the verdict.
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    let _ = unsafe { WinVerifyTrust(hwnd, &mut action, pdata) };

    if status == 0 {
        Ok(())
    } else {
        Err(format!("WinVerifyTrust status 0x{:08X}", status as u32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bin(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(name)
    }

    // The ANGLE DLLs are dev-provided + gitignored; skip when absent (CI).
    #[test]
    fn angle_dlls_match_sha256_pins() {
        for (f, sha) in [("libEGL.dll", EGL_SHA256), ("libGLESv2.dll", GLESV2_SHA256)] {
            let p = bin(f);
            if !p.exists() {
                eprintln!("skip {f}: not present");
                continue;
            }
            verify_sha256(&p, sha).unwrap_or_else(|e| panic!("{f}: {e}"));
        }
    }

    #[test]
    fn angle_dlls_authenticode_valid() {
        for f in ["libEGL.dll", "libGLESv2.dll"] {
            let p = bin(f);
            if !p.exists() {
                eprintln!("skip {f}: not present");
                continue;
            }
            verify_authenticode(&p).unwrap_or_else(|e| panic!("{f}: {e}"));
        }
    }
}
