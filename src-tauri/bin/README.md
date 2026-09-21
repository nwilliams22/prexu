# Windows native runtime binaries

These gitignored files are staged for development and bundled by
`src-tauri/tauri.windows.conf.json`: `libmpv-2.dll`, `libEGL.dll`, and
`libGLESv2.dll`. Linux uses system libmpv; these DLLs are Windows-only.

## libmpv

Set `MPV_SOURCE` to a directory containing `64/libmpv-2.dll` and the MSVC
import library `64/mpv.lib`. The build copies the runtime DLL into this directory
and beside the application executable. Debug builds can fall back to
`C:\libmpv`; release builds require `MPV_SOURCE` explicitly and abort if unset.
A missing source DLL produces a build warning; missing link or bundle inputs
may also fail the build. Do not treat a warning-only staging step as proof that
an executable can play video.

Use the pinned archive and SHA-256 procedure in
[release.yml](../../.github/workflows/release.yml); its Windows steps also show
how to generate `mpv.lib` from DLL exports with MSVC `dumpbin` and `lib`.
The archive's GNU `libmpv.dll.a` is not the MSVC import library.
[CI build inputs](../ci/mpv/README.md) contain the small import library/headers;
the runtime is downloaded, not committed. For Windows Rust tests, place the DLL
beside the test executable in `target/debug/deps/` as CI does.

## ANGLE

Provide the workflow-pinned `libEGL.dll` and `libGLESv2.dll` in this directory.
`ANGLE_SOURCE` optionally refreshes them from another directory; `build.rs`
stages them beside the executable. The runtime loader checks both pinned
SHA-256 and Authenticode; arbitrary replacement builds will fail verification.
Use the artifact URLs/hashes in the release workflow and checks in
`src-tauri/src/player/angle_loader.rs` as the authoritative pair.

Headless Windows CI supplies dummy ANGLE files solely to satisfy bundle-resource
validation. They cannot render video and are not valid development/release DLLs.
See [signing status](../../docs/code-signing.md) and
[current player architecture](../../docs/native-player-status.md).
