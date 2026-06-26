# dcomp-capture spike — RUN & WHAT-TO-LOOK-FOR

THROWAWAY feasibility spike for **beads prexu-jjbk / Path C0**. Do not ship; do
not commit to main as product code. It exists only to answer one question:

> When mpv video is rendered onto a **DirectComposition visual** on a **plain
> top-level window** (no `WS_CHILD`, no `--wid`), does
> **Windows.Graphics.Capture** (the surface Alt+Tab / WGC previews use) capture
> the video?

Path A (`WS_CHILD`, see `src-tauri/src/player/host_window.rs`) already failed
in the app (airspace hides controls; child surface is not a shippable overlay).
Path C bets DComp gives ONE composed surface that both shows AND is captured.

## Prerequisites

1. **A GPU + an interactive desktop session.** WGC and a real DComp swapchain do
   not work over a headless/Session-0 context.
2. **ANGLE DLLs on the DLL search path**: `libEGL.dll` and `libGLESv2.dll`
   (the same ANGLE mpv/Chromium ship). Put them next to the built `.exe`, or on
   `PATH`. The spike loads them dynamically via `libloading`.
   - If you have a Chrome/Electron/Tauri install, copy its `libEGL.dll` +
     `libGLESv2.dll`. Or build ANGLE. Without these, step 2 fails immediately
     with a clear `load libEGL.dll (ANGLE)` error.
3. **A video file** to play, passed as `argv[1]`. Without it the window/capture
   still run but mpv has nothing to draw (frames will be black — that is NOT a
   linchpin failure, just no input).
4. **Windows 10 1903+ / Windows 11** for `Direct3D11CaptureFramePool`.

## Build

```
cargo build --manifest-path spike/dcomp-capture/Cargo.toml
```

First build compiles libmpv (`build_libmpv` feature) — slow, needs the mpv build
prerequisites the main app already satisfies (the repo builds libmpv2 the same
way in `src-tauri`).

## Run

```
cargo run --manifest-path spike/dcomp-capture/Cargo.toml -- "C:\path\to\sample.mp4"
```

Or run the built exe with the ANGLE DLLs beside it:

```
spike/dcomp-capture/target/debug/dcomp_capture.exe "C:\path\to\sample.mp4"
```

A window titled "Prexu DComp Capture Spike" appears and plays ~2s of the video,
then the program captures one frame of itself and writes `capture_test.png` in
the current directory.

## What to look for (the verdict)

The program prints ONE of:

- `VERDICT: LINCHPIN PASS` — `capture_test.png` center region is non-black, i.e.
  WGC captured the DComp-composited video. **Path C capture premise CONFIRMED.**
- `VERDICT: LINCHPIN FAIL` — center region is black. Cross-check the on-screen
  window:
  - **Window shows video but PNG is black** → DComp visual is NOT in the captured
    surface. **KILL SIGNAL for Path C.** Report loudly.
  - **Window is also black** → the failure is upstream (ANGLE share-handle import
    drew black, or mpv didn't render), NOT a statement about DComp capture →
    INCONCLUSIVE for the capture question.
- `VERDICT: INCONCLUSIVE` — the capture pipeline itself errored (see the logged
  reason).

Always open `capture_test.png` and also eyeball the live window; the printed
verdict plus those two observations are the deliverable.

## Logs

`RUST_LOG=trace` for maximum detail; default is `debug`. Tags: `[spike:win]`,
`[spike:d3d]`, `[spike:egl]`, `[spike:gl]`, `[spike:mpv]`, `[spike:dcomp]`,
`[spike:capture]`.

## Known risk legs (where it is most likely to fail at runtime)

1. **ANGLE D3D share-handle import (`step 4b`)** — `eglCreatePbufferFromClient
   Buffer` with `EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE` is historically prone to
   producing **black textures** and needing `IDXGIKeyedMutex` synchronization
   (ANGLE issue #141, Mozilla bug 1066312). If the window/PNG are black but the
   FBO reported "complete", suspect this leg, not DComp. This spike uses the
   *legacy* `GetSharedHandle` (no keyed mutex). If black, the next experiment is
   the keyed-mutex / NT-handle (`CreateSharedHandle`) variant.
2. **`IDCompositionVisual::SetContent` content type** — verified that it accepts
   only `IDCompositionSurface` or `IDXGISwapChain1`, NOT a raw `ID3D11Texture2D`.
   The spike therefore composites via a `CreateSwapChainForComposition`
   swapchain and `CopyResource`s the shared texture into the back buffer each
   frame.
3. **EGL ↔ D3D device mismatch** — ANGLE's default display creates its OWN D3D11
   device, while DComp + the shared texture use the spike's `D3D11CreateDevice`.
   The share handle bridges them, but if ANGLE picks a different adapter the
   import can fail. If so, the fix is to create the EGL display over the spike's
   own device via `eglGetPlatformDisplayEXT` +
   `EGL_ANGLE_d3d11_device` (not wired here to keep the spike small).

## Compile-status honesty

This file was authored in an environment where the build could NOT be executed
(cargo/registry access was sandboxed off). Every external API was verified
against docs.rs / the libmpv2 source / the Khronos EGL registry (see the report),
but the crate has **not been compiled here**. Expect to fix a small number of
windows-rs signature mismatches on first `cargo build` (most likely candidates:
the exact `windows::core::factory` path, `IDXGISwapChain1::Present` flag type,
and EGL version-trait gating on `create_pbuffer_from_client_buffer`). The code is
structured so each such fix is local to one call site.
