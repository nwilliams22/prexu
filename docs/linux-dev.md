# Linux development & packaging

Status: **scaffolding** — Prexu builds on Linux today (HTML5 `<video>` engine),
but no Linux build has been runtime-tested on hardware yet. The native
libmpv player is Windows-only (see
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

## What still requires a Linux machine

- Confirm WebKitGTK on Fedora decodes the target Plex codecs (if yes, the HTML5
  engine may be sufficient on Linux and a native player is lower priority).
- The native player render-API backend (mpv OpenGL/Vulkan → Wayland/X11
  surface). Wayland is the modern Fedora default and has no mpv `--wid`
  embedding, so this is the render-API path (ADR option L2), not the Windows
  `wid` design.
- Any `tauri dev` runtime / visual / interaction debugging.
