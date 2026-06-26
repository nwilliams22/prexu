# dcomp-hwdec spike — RUN & WHAT-TO-LOOK-FOR

THROWAWAY feasibility spike for **beads prexu-60mz.2 / Path C3b** — the GATE that
settles the biggest unverified Path C risk:

> Does **hardware decode** (`hwdec=auto-safe`) survive the libmpv2 `RenderContext`
> + ANGLE EGL share-handle interop? C0/C2 ran `hwdec=no`. Production needs hwdec
> for codec breadth (the reason for the native player, see memory
> `prexu-player-native-required`).

It is the C2 overlay pipeline (one DComp tree: mpv video below, transparent
webview above) with hwdec turned ON, playing a REAL encoded clip and logging
mpv's actually-chosen decoder.

## Prerequisites

1. GPU + interactive desktop session + WebView2 runtime.
2. ANGLE `libEGL.dll` + `libGLESv2.dll` on PATH (same as C0/C2).
3. An **encoded** video file (lavfi/testsrc are CPU-decoded and never engage
   hwdec). Generate the bundled sample with ffmpeg:

```
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -t 6 -c:v libx264 \
  -pix_fmt yuv420p -g 30 -profile:v high -y spike/dcomp-hwdec/sample/test_h264.mp4
```

The `sample/*.mp4` is gitignored (don't commit the binary; regenerate as above).

## Build & run

```
cargo run --manifest-path spike/dcomp-hwdec/Cargo.toml -- "spike/dcomp-hwdec/sample/test_h264.mp4"
```

Probe specific decoders: `PREXU_HWDEC=d3d11va` (zero-copy), `d3d11va-copy`
(GPU decode + CPU roundtrip), `nvdec`, or `no` (software baseline).

## The verdict

Two lines print. The C3b one is `HWDEC VERDICT`:

- `HWDEC VERDICT: PASS` — `hwdec-current` is a hardware decoder (not `no`) AND the
  decoded frames rendered correctly (video sample non-black) and were WGC
  captured. **hwdec survives Path C rendering.**
- `HWDEC VERDICT: FAIL (software)` — mpv fell back to `no`. Hardware decode did
  not engage; try `PREXU_HWDEC=d3d11va`. If still software, the ANGLE default-
  display device mismatch (C0 risk #3) blocks d3d11va interop — fix = create the
  EGL display over our own D3D11 device via
  `eglGetPlatformDisplayEXT(EGL_ANGLE_d3d11_device)`.
- `HWDEC VERDICT: FAIL (black frames)` — hwdec engaged but frames did not render
  (decode texture on a different device than the ANGLE share path).

Always also open the PNG: the testsrc2 pattern carries a live timestamp +
frame counter, so a correct, non-corrupt frame proves real decoded video.

## Result on first run (2026-06-23, this repo's dev machine)

```
[spike:mpv] Mpv initialized (vo=libmpv, render API, hwdec=auto-safe)
[spike:hwdec] FINAL hwdec-current = "d3d11va" (hardware_active=true)
[spike:verify] video@(200,150) rgba=[255,24,0] visible=true ; button [0,200,0] ; bar [140,13,0]
HWDEC VERDICT: PASS
```

`hwdec=auto-safe` selected **zero-copy `d3d11va`** with no device-binding fix
needed. PNG confirmed: sharp testsrc2 bars + live timestamp, green CLICK ME
overlay, alpha-blended control bar — no corruption. The C0 device-mismatch fear
did not materialize: mpv's render API bridges its decode device to ANGLE's GL
device automatically.

## Conclusion for Path C

hwdec is NOT a blocker. C3d (in-app render context) can use `hwdec=auto-safe`
unchanged; no `eglGetPlatformDisplayEXT` device-binding workaround is required on
this hardware. Re-confirm on the production target GPUs (Intel/AMD/NVIDIA) during
C3d if they differ from this dev machine.

## Logs

`RUST_LOG=trace` for detail; default `debug`. Tags include `[spike:hwdec]`,
`[spike:mpv]`, `[spike:egl]`, `[spike:verify]`.
