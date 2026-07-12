# Linux development & packaging

Status: **runtime-verified** — Prexu builds **and runs** on Linux today (HTML5
`<video>` engine), verified on Nobara/Fedora 43 + KDE Plasma **Wayland** + NVIDIA
(prexu-duna.3). Playback works via Plex; non-H.264/AAC media transcodes (see
[Wayland runtime notes](#wayland-runtime-notes)). The native libmpv player is
Windows-only (see
[`adr-native-player-cross-platform.md`](adr-native-player-cross-platform.md)).
This doc captures what's known so a Linux dev session can start fast. Verify
package names on the actual machine — distro packages drift.

## Three separate concerns

| Concern | Distro-specific? | Status |
|---------|------------------|--------|
| **Compile + link** of `src-tauri` | No — source-level, distro-agnostic | ✅ CI-verified on ubuntu-22.04 (`linux-build` job) |
| **Dev environment** (devel packages) | Yes — apt vs dnf names differ | documented below, unverified on Fedora |
| **Runtime + packaging** (.rpm/.AppImage, codec support) | Yes | ⏳ needs a real Linux box |

The CI `linux-build` job proves the code compiles **and links** without libmpv
(it guards the `-lmpv` regression from prexu-nesp). It does **not** prove
runtime behaviour on any given distro — WebKitGTK codec support and the
eventual render-API player must be tested on hardware.

## Dev setup

### Fedora (target daily-driver distro)

Per the Tauri v2 Linux prerequisites — **verify exact package names on the box**
(`dnf search webkit2gtk` etc.):

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel
sudo dnf group install "C Development Tools and Libraries"
```

Then:
- Rust via [rustup](https://rustup.rs/) or mise (`mise use rust@latest`)
- Node 22 (mise or system)
- `npm ci`
- `npm run tauri dev` — runs the desktop app with the HTML5 player

### Debian/Ubuntu (matches CI)

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libssl-dev
```

### Issue tracker (beads) on a fresh clone

Issues live in an embedded Dolt database (`.beads/embeddeddolt/`, gitignored)
run in-process by `bd` 1.1+ — self-contained, no external dolt server or CLI.
The canonical sync channel is the Dolt remote riding this repo's git remote as
`refs/dolt/data` (`bd dolt push` / `bd dolt pull`, remote configured in
`.beads/config.yaml` `sync.remote`). The tracked `.beads/issues.jsonl` is a
passive export kept for grep/viewers and as a bootstrap fallback — not the
source of truth. On a fresh clone:

```bash
mise install        # provisions bd (the dolt CLI is optional in embedded mode)
bd bootstrap        # non-destructive setup: pulls from refs/dolt/data on
                    # origin, falling back to the tracked issues.jsonl
bd ready            # verify the queue is visible
```

## Packaging

Tauri's Linux bundler can emit three formats:

| Format | For | Notes |
|--------|-----|-------|
| `.deb` | Debian/Ubuntu | not useful on Fedora |
| `.rpm` | Fedora/RHEL | native install; declares a runtime dep on the system `webkit2gtk4.1`. Building it needs `rpmbuild` on the builder. |
| `.AppImage` | any glibc Linux | bundles dependencies; runs on Fedora regardless of distro. **Best first target.** |

Recommendation for the Fedora daily driver: **AppImage first** (portable,
build-once), add `.rpm` later for a native install. When the Linux release leg
is re-added to `release.yml`, set the Linux `bundle.targets` explicitly to
`["appimage", "rpm"]` rather than `"all"` and ensure `rpmbuild` is installed on
the runner.

### glibc baseline

CI builds on **ubuntu-22.04** (glibc 2.35). A binary built against an older
glibc runs on newer distros, so a Fedora target (newer glibc) is forward-
compatible. Keep the build runner on the oldest distro we want to support.

## Wayland runtime notes

Verified on KDE Plasma Wayland + NVIDIA (prexu-duna.3). Two Wayland-specific
quirks worth knowing:

### webkit2gtk DMABUF crash (handled in-app)

On Wayland with many GPUs (notably NVIDIA), webkit2gtk's DMABUF renderer
crashes at webview creation — `Gdk-Message: Error 71 (Protocol error)
dispatching to Wayland display` — killing the app before first paint. Prexu
sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` at startup on Linux (in `run()`, before
GTK init) to force the stable GL path, so **no user action is needed**
(prexu-z5mz). To debug the DMABUF path, override it: `WEBKIT_DISABLE_DMABUF_RENDERER=0 npm run tauri dev`
(expect the crash on affected GPUs).

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

## What still requires a Linux machine

- ~~Confirm WebKitGTK on Fedora decodes the target Plex codecs.~~ **Answered
  (prexu-duna.3):** the HTML5 path direct-plays only **H.264 + AAC**; HEVC
  (8- and 10-bit), AV1, and AC3/E-AC3/TrueHD/DTS audio all force a Plex
  transcode (~17% of the Movies library by video, ~170 titles by audio). So the
  native render-API player is warranted on Linux — those codecs are its
  must-cover scope.
- The native player render-API backend (mpv OpenGL/Vulkan → Wayland/X11
  surface). Wayland is the modern Fedora default and has no mpv `--wid`
  embedding, so this is the render-API path (ADR option L2), not the Windows
  `wid` design.
- Any `tauri dev` runtime / visual / interaction debugging.
