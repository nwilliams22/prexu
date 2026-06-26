# webview2-hosting spike — RUN & WHAT-TO-LOOK-FOR

THROWAWAY feasibility spike for **beads prexu-tfip / Path C1**. Do not ship; it
exists only to answer one question (the airspace killer for Path C):

> When a WebView2 is hosted in **VISUAL mode**
> (`ICoreWebView2Environment3::CreateCoreWebView2CompositionController` +
> `ICoreWebView2CompositionController::SetRootVisualTarget` into an app-owned
> DirectComposition tree), is the webview BOTH **clickable** (forwarded input
> reaches the page) AND **transparent** (a solid DComp visual placed *behind* it
> shows through the page's transparent regions)?

Windowed WebView2 hosting (what wry/Tauri use today) fails the transparency half:
the child HWND is opaque to anything composited behind it (airspace). The C0
spike (`spike/dcomp-capture`, prexu-jjbk) already proved a DComp video visual is
captured by Alt+Tab/WGC. Together they de-risk Path C.

## Prerequisites

1. A GPU + an **interactive desktop session** (WGC + a real DComp swapchain do
   not work headless / Session 0).
2. The **WebView2 Evergreen runtime** installed (the Tauri app already requires
   it; the spike calls `CreateCoreWebView2EnvironmentWithOptions`).
3. Windows 10 1903+ / Windows 11 (for `Direct3D11CaptureFramePool`).

No video file and no ANGLE DLLs are needed (unlike C0) — this spike only exercises
the webview + a solid-colored stand-in background.

## Build & run

```
cargo run --manifest-path spike/webview2-hosting/Cargo.toml
```

A window titled "Prexu WebView2 Visual-Hosting Spike (Path C1)" appears showing a
cyan **CLICK ME** button on a magenta field. The spike:

1. Builds a DComp tree: root -> [ magenta background swapchain (bottom),
   webview visual (top) ].
2. Creates the WebView2 composition controller, `SetRootVisualTarget`s the top
   visual, sets a transparent default background, full-window bounds,
   rasterization scale 1.0.
3. Navigates an inline page (transparent except the cyan button; `onclick` sets
   `document.title = "CLICKED"` and recolors the button green).
4. Synthesizes a click at the button center via `SendMouseInput`
   (MOVE / LEFT_DOWN / LEFT_UP) and polls `DocumentTitle()` for `"CLICKED"`.
5. Captures the window via WGC to `webview2_hosting_test.png` and samples two
   pixels.

## The verdict

The program prints ONE of:

- `VERDICT: LINCHPIN PASS` — `clicked && gap==magenta && button==webview-color`.
  Input forwarding works AND the background shows through the transparent webview
  AND the webview content composites above it. **Path C visual-hosting CONFIRMED.**
- `VERDICT: LINCHPIN FAIL` — see the printed flags:
  - `gap` NOT magenta → webview visual is opaque / airspace persists → **KILL
    SIGNAL for Path C.**
  - `button` is magenta → webview did not composite above the background.
  - `clicked=false` → input forwarding (`SendMouseInput`) failed.
- `VERDICT: INCONCLUSIVE` — the capture pipeline errored (see the logged reason).

Always also eyeball the live window and open the PNG.

## Result on first run (2026-06-23, this repo's dev machine)

```
[spike:input] click registered by page = true
[spike:verify] gap rgba=[255, 0, 255, 255] magenta=true ; button rgba=[0, 200, 0, 255] webview=true
VERDICT: LINCHPIN PASS
```

Clickable + transparent + captured, all confirmed in one composed surface.

## Logs

`RUST_LOG=trace` for maximum detail; default `debug`. Tags: `[spike:win]`,
`[spike:d3d]`, `[spike:dcomp]`, `[spike:input]`, `[spike:capture]`,
`[spike:verify]`.

## Relationship to Path C2 (prexu-k0i2)

This spike's magenta background visual stands in for the real mpv-rendered DComp
swapchain from C0. C2 = replace magenta with that video swapchain in the same
tree (video below, transparent webview above) and capture both together — now a
low-risk integration of two independently proven halves.
