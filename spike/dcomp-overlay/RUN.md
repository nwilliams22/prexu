# dcomp-overlay spike — RUN & WHAT-TO-LOOK-FOR

THROWAWAY feasibility spike for **beads prexu-k0i2 / Path C2**. It combines the
two independently-proven halves of Path C into ONE DirectComposition tree on ONE
plain top-level window, standalone (outside Tauri):

- **C0** (`spike/dcomp-capture`, prexu-jjbk): mpv -> ANGLE GL -> shared D3D11
  texture -> composition swapchain -> a DComp **video** visual (z-below).
- **C1** (`spike/webview2-hosting`, prexu-tfip): WebView2 visual hosting
  (`CreateCoreWebView2CompositionController` + `SetRootVisualTarget`) -> a DComp
  **webview** visual (z-above), transparent + clickable.

It proves the whole Alt-tab-parity goal before any app surgery:
1. the webview UI overlays the video with **true alpha** (transparent page
   regions show the video; a translucent control bar alpha-blends over it), and
2. a **single WGC capture** (the Alt+Tab surface) contains BOTH video and UI.

It also fixes the **C0 vertical flip** (`MPV_RENDER_FLIP = false` — see below).

## Prerequisites

1. GPU + interactive desktop session.
2. WebView2 Evergreen runtime (the Tauri app already requires it).
3. ANGLE `libEGL.dll` + `libGLESv2.dll` on PATH or next to the exe (same as C0 —
   copy from an Edge/Electron/Tauri install).
4. Windows 10 1903+ / Windows 11.
5. A video source as `argv[1]`.

## Build & run

```
cargo run --manifest-path spike/dcomp-overlay/Cargo.toml -- "C:\path\to\sample.mp4"
```

No local file? Use an mpv synthetic source (also gives an unambiguous
orientation reference for the flip check):

```
cargo run --manifest-path spike/dcomp-overlay/Cargo.toml -- "av://lavfi:smptebars=size=1280x720:rate=30"
```

A window shows SMPTE color bars with a cyan **CLICK ME** button and a translucent
bottom control bar. The spike runs ~3s of video, synthesizes a click, then
captures itself to `dcomp_overlay_test.png` and prints a verdict.

## The verdict

- `VERDICT: LINCHPIN PASS` — `clicked && button_overlays && video_visible`. The
  transparent webview shows the video below, the button/bar overlay it, and WGC
  captured both. **Path C end-to-end CONFIRMED.**
- `VERDICT: PARTIAL PASS (no video file)` — overlay + capture confirmed but the
  video region was black (no `argv[1]`). Re-run with a video.
- `VERDICT: LINCHPIN FAIL` — see flags: video not visible => lower visual not
  showing through (z-order/alpha); button missing => webview not composited
  above; `clicked=false` => input forwarding failed.

Always also open the PNG and confirm the video is **right-side-up** (the flip
check). With `smptebars`, upright = bright color bars on top, dark PLUGE pattern
on the bottom.

## Result on first run (2026-06-23, this repo's dev machine)

```
[spike:input] click registered = true
[spike:verify] video@(200,150) rgba=[193,192,1] visible=true ; button rgba=[0,200,0] overlays=true ; bar rgba=[0,34,57]
VERDICT: LINCHPIN PASS
```

PNG confirmed: SMPTE bars upright (flip correct), green post-click button over
the video, translucent bar darkening the bottom strip — all in one captured
surface.

## The C0 flip fix

C0 rendered with mpv `flip=true` and the image came out upside-down in the
composition-swapchain path (there is no extra present-time flip there, unlike a
windowed swapchain). This spike uses `MPV_RENDER_FLIP = false` and the captured
SMPTE bars are upright — so the corrected value is `false` for the DComp path.

## Logs

`RUST_LOG=trace` for detail; default `debug`. Tags: `[spike:win]`, `[spike:d3d]`,
`[spike:egl]`, `[spike:gl]`, `[spike:mpv]`, `[spike:dcomp]`, `[spike:input]`,
`[spike:capture]`, `[spike:verify]`.

## Next (Path C3, prexu-60mz)

All three feasibility gates (C0, C1, C2) now pass standalone. C3 lands this in
the app: fork-or-bypass wry to own the WebView2 composition controller, drive mpv
through the render API instead of `--wid`, rewire geometry/fullscreen/popout, and
delete the WS_POPUP host + DWM taskbar workaround.
