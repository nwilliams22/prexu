# Linux development and packaging

Audited 2026-09-20. Linux native libmpv playback is implemented and has been
exercised on KDE Plasma Wayland/NVIDIA. Broad GPU/codec coverage and release
packaging acceptance remain open. See [implementation status](native-player-status.md).

## Dependencies and launch

Node 22 is configured in `mise.toml`; Rust is supplied by rustup. The native
player dynamically links system libmpv. Ubuntu CI installs these build packages:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libssl-dev libmpv-dev
npm ci
npm run tauri dev
```

For Fedora-family machines, install the equivalents providing WebKitGTK 4.1,
GTK 3, OpenSSL, AppIndicator, librsvg, patchelf, and libmpv development files
from the repositories enabled on that machine. Package names and libmpv
availability differ; the Ubuntu command is the configuration used in CI.

Native runtime tests need libmpv client API 2.x. The headless runtime CI uses
Ubuntu 24.04 for this reason; the compile/link job uses Ubuntu 22.04.

Use `npm run dev` for the browser frontend (HTML5 only). Desktop Settings can
select HTML5 explicitly; default/auto selects native on Linux. Runtime engine
failure can remount into HTML5, but a missing dynamically linked `libmpv.so`
can stop the process before application fallback is available.

## Fresh-clone task tracking

```bash
mise install
bd bootstrap
bd prime
bd ready
```

Beads uses an embedded Dolt database under `.beads/embeddeddolt/`. The tracked
`.beads/issues.jsonl` is a passive export, not the live database. Remote sync
uses `refs/dolt/data`; follow the repository's conservative commit/sync policy.

## Validation

```bash
mise run ci
npm run test:e2e -- --project=player-chrome
mise run hw-probe:selftest
```

The local gate includes frontend checks, relay and desktop Rust clippy/tests,
Chromium E2E, and probe self-tests. It does not run the real headless-mpv
integration test or certify GPU rendering. See [coverage](test-automation-plan.md),
[hardware scenarios](linux-on-hardware-test-plan.md), and [probe commands](hw-probe-runbook.md).

## Packaging status

`tauri.linux.conf.json` selects AppImage and rpm. The release workflow has a
Linux Ubuntu 22.04 matrix entry and installs rpm tooling, but still lacks
libmpv provisioning. The bundle config does not explicitly declare an rpm
libmpv dependency. CI's native-player build is ahead of release packaging.

`prexu-axj4.7` owns release provisioning, self-contained AppImage verification,
rpm runtime dependencies, and verification of the chosen libmpv build's
licensing/provenance. Do not infer portable packaged-app support from a passing
dev build. `prexu-p020` separately tracks a black webview/minimum-size issue
with a cargo-built debug binary using bundled frontend assets.

## Wayland and rendering diagnostics

The app requests a transparent WebKitWebView at creation and installs a
GtkOverlay/GtkGLArea compositor beneath it. The toplevel window remains opaque.
Do not export `WEBKIT_DISABLE_DMABUF_RENDERER=1` for normal native playback:
that fallback caused progressive darkening and stale transparent composites on
the tested stack. The app no longer sets it automatically. An explicit user
override is respected as a diagnostic escape hatch, with degraded rendering.

Two diagnostic modes exist in `src-tauri/src/lib.rs`:

```bash
PREXU_STOCK_WEBVIEW=1 npm run tauri dev
PREXU_NO_COMPOSITOR=1 npm run tauri dev
```

The first disables both creation-time transparency and the compositor; the
second retains transparency but skips the compositor. Both disable native
rendering. These switches are presence-based: unset them to restore normal
behavior; setting `=0` does not disable the switch. In these modes, the app
sets `__NV_DISABLE_EXPLICIT_SYNC=1` unless the user supplied a value, addressing
the recorded NVIDIA/KWin explicit-sync protocol crash. Normal mode is unchanged.

`prexu-41cw` / `prexu-v6pr` record large-resize presentation stalls on the tested
WebKitGTK/NVIDIA/KWin stack. DOM layout can catch up before visible pixels do;
the stall also reproduces in stock/no-compositor modes. Remaining investigation
is WebProcess/presentation profiling and an upstream evidence report, not proof
that more React resize changes will fix it.

### Window position is not restored on Wayland — use a KWin rule

`tauri-plugin-window-state` restores window **size** but **not position** on
Wayland: the protocol forbids a client from placing its own toplevel window —
the compositor decides — so position-restore is a silent no-op and KWin
re-centers the window on the primary monitor every launch (prexu-80s0). There
is no reliable in-app fix on native Wayland.

Workaround — a KWin **window rule** pins it where you want:

1. Right-click the Prexu titlebar → **More Actions → Configure Special
   Application Settings…** (or System Settings → Window Management → Window
   Rules → New).
2. **Window matching:** Window class (application) → **Exact Match** → `prexu`.
3. **Size & Position → Add property → Position** → set mode **Apply Initially**
   and the `x y` of the target monitor's top-left corner.
4. **OK**, then relaunch Prexu.

Find a monitor's top-left coordinate with `kscreen-doctor -o` (look at each
output's `Geometry: X,Y WxH`). Example: a monitor reported as
`Geometry: 3840,0 3840x2160` is placed to the right of a primary 4K panel, so
its origin is `x=3840 y=0` — set Position to `3840 x 0` to open Prexu there.

If "Apply Initially" doesn't stick (some apps re-assert geometry after start),
also add the property **Ignore requested geometry → Yes** (KWin notes this in
the rule dialog). "Apply Initially" places the window on open but still lets you
move it afterward; use **Force** only if you want it locked.


## Acceptance still requiring hardware

- Remaining playback/transition scenarios and X11 sweep (`prexu-axj4.5`, deferred `prexu-5jxx`).
- Intel/AMD VAAPI and wider NVIDIA decode coverage (`prexu-axj4.6`).
- Native per-codec verification against the recorded HTML5 gap (`prexu-axj4.8`).
- Packaged runtime and final gates (`prexu-axj4.7`, `prexu-axj4.9`).

The old HTML5 H.264/AAC observations describe the app's selected playback path,
including its codec allow-list; they are not a universal measurement of every
WebKitGTK codec capability.
