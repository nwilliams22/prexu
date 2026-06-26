# Path C3 — fork-vs-bypass decision (prexu-60mz.1 / C3a)

**Decision: FORK wry 0.54.2.** Add a composition-controller hosting path; keep
everything else. Bypass (own the whole WebView2 host + re-implement Tauri's IPC
bridge, custom protocol, init scripts, navigation, settings) is rejected — it
re-implements a large, working, security-sensitive surface for zero benefit.

## Evidence

1. **IPC survives composition hosting (runtime-proven, this spike).** Tauri's
   invoke/emit is built on `ICoreWebView2` primitives — init-script injection,
   `WebMessageReceived`, `PostWebMessageAsString`/`ExecuteScript`. This spike
   wired those exact calls on a composition-hosted webview and round-tripped a
   message (`PASS`). The `CoreWebView2` core is identical between windowed and
   composition controllers, so Tauri IPC is unaffected by the hosting mode.

2. **wry's IPC/protocol/navigation code is hosting-agnostic (source survey).**
   In `wry-0.54.2/src/webview2/mod.rs`, everything that matters to Tauri operates
   on the `CoreWebView2` obtained from the controller — NOT on the controller's
   hosting mode:
   - `init_webview()` (L416) gets `controller.CoreWebView2()` (L426) and wires
     IPC `add_WebMessageReceived` (L885), `AddScriptToExecuteOnDocumentCreated`
     (L1296), custom protocols, settings, navigation — all unchanged by hosting.
   - `SetBounds` (L1220 resize subclass, L1430 `set_bounds`) is on
     `ICoreWebView2Controller`, which a composition controller QIs to.

## The exact fork delta (small, localized)

`wry-0.54.2/src/webview2/mod.rs`:

1. **New controller branch.** Beside `create_controller()` (L365, which calls
   `CreateCoreWebView2ControllerWithOptions` / `CreateCoreWebView2Controller`),
   add `create_composition_controller()`:
   `env.cast::<ICoreWebView2Environment3>()` →
   `CreateCoreWebView2CompositionController(hwnd, handler)` →
   QI result to `ICoreWebView2Controller` for all existing code. Store the
   `ICoreWebView2CompositionController` too (needed for input + cursor + visual
   target).
2. **Expose `RootVisualTarget`.** Add a method on `InnerWebView` (and surface via
   wry's `WebView`) so the app can `SetRootVisualTarget(its IDCompositionVisual)`
   into the app-owned DComp tree, and the app owns the DComp device + `Commit`.
   The struct already holds `controller: ICoreWebView2Controller` (L61); add the
   composition controller next to it.
3. **Input forwarding (the only genuinely new behavior).** Windowed mode gets
   mouse/keyboard/pointer/IME for free via the controller's own child HWND.
   Composition mode requires the host to forward `SendMouseInput` /
   `SendPointerInput` / `SendKeyboardInput` and set the cursor from
   `Cursor()`/`CursorChanged` in `WM_SETCURSOR`. wry has no such forwarding today
   (it relies on the windowed child HWND). **This is C4 work (prexu-0oc3) and is
   required by ANY visual-hosting approach — it is not extra cost of forking.**
   C1 (prexu-tfip) already proved mouse + cursor forwarding; keyboard/IME remain.
4. **Opt-in.** A builder flag / platform attribute to select composition hosting
   so the windowed path stays the default for non-player windows.

Unchanged by the fork: IPC bridge, custom `tauri://`/asset protocol, init
scripts, navigation, settings, devtools, `SetBounds`. (Confirmed by the source
survey + the runtime IPC proof.)

## Integration mechanics (for C3c)

- Pin the fork via Cargo `[patch.crates-io] wry = { path/git = ... }` (or a
  vendored copy). Tauri 2.10 depends on wry 0.54.x; the patch must stay API-
  compatible with what Tauri calls.
- The app creates a Tauri window, then drives the forked wry to build the webview
  in composition mode against that window's HWND, and `SetRootVisualTarget`s into
  the DComp tree that also holds the mpv video visual (C3d/C3e).
- Maintenance burden: one patched file path in wry, re-based on wry version bumps
  when Tauri bumps. Acceptable vs. the bypass alternative.

## Residual risks pushed to later gates

- Keyboard input + **IME** under composition hosting — C4 (unverified).
- DPI / rasterization-scale handling — C4.
- drag/drop + native menus — C4.
- hwdec through the mpv render context — C3b (separate gate).
