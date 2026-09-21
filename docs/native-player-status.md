# Native player — current implementation status

Audited 2026-09-20 against local `main` at `dfe5d8c` and the local Beads database.
This describes source implementation, not a fresh hardware certification or a
claim that the current tree has shipped. Package version remains 0.7.1.

## Engines and architecture

| Platform | Current application behavior | Rendering |
| --- | --- | --- |
| Windows | Native by default; HTML5 selectable and runtime fallback supported | libmpv render API → ANGLE/D3D11 → DirectComposition, with composition-hosted WebView2 UI |
| Linux | Native by default; HTML5 selectable and runtime fallback supported | libmpv OpenGL render API → GtkGLArea below transparent WebKitWebView in GtkOverlay |
| macOS | HTML5 only in the application | WKWebView; native rendering proven in a separate spike, not integrated |

Engine choice is resolved once per player mount in
[`engineResolution.ts`](../src/hooks/player/engineResolution.ts). A runtime
failure requests a remount onto HTML5. Linux dynamically links system libmpv:
a missing loader dependency can prevent process startup, before fallback can run.

Windows no longer uses the original sibling `host_window.rs` / mpv `wid`
architecture. The [original rollout](archive/native-player-rollout.md) is
archived for historical context; its resume instructions are obsolete.

## Implemented behavior

- Native transport, volume/mute, track selection, subtitle styling, audio
  processing, fullscreen, and Plex timeline reporting.
- Player overlay with the application layout retained but hidden during full
  playback; in-window mini-player keeps the application navigable.
- Popout on Windows and Linux. Wayland placement/keep-above differs from X11:
  the window shrinks in place and compositor controls govern pinning.
- Mute persists across handoffs within a session; stopping and starting a new
  session resets mute. Volume is persisted separately.
- Linux first-frame reveal is armed on load and fired by the GLArea render
  handler. Transition chrome hides while geometry is changing.
- Linux mpv warmup, event-driven property observation, streaming local-file
  responses, and compositor quiescence outside active playback.

## Validation and remaining acceptance

The automation epic `prexu-pd1x` is closed. See
[validation coverage](test-automation-plan.md) and the
[hardware runbook](hw-probe-runbook.md). A green unit suite does not establish
GPU, window-manager, packaged-app, or per-codec correctness.

Beads still tracks Linux feature acceptance (`prexu-axj4.5`), hardware decode
coverage (`prexu-axj4.6`), distribution (`prexu-axj4.7`), codec verification
(`prexu-axj4.8`), and final gates (`prexu-axj4.9`). Some descriptions predate
merged fixes; read notes and current code before treating a title as missing
implementation. X11 verification (`prexu-5jxx`) is deferred.

Linux CI provisions libmpv and compiles/tests the native player. The release
workflow still lacks Linux libmpv provisioning; the Linux bundle config selects
AppImage/rpm but has no explicit rpm libmpv dependency. Self-contained AppImage
operation and LGPL build provenance remain acceptance work under `axj4.7`.

Known follow-ups include Windows IME (`prexu-x2bt`) and fullscreen transition
verification (`prexu-6p8k`), Linux packaged/dist black-webview investigation
(`prexu-p020`), and WebKitGTK large-resize presentation lag (`prexu-41cw`,
`prexu-v6pr`). The latter reproduces without the app compositor; further work
is presentation-layer profiling and an upstream evidence report.

macOS sequencing is `prexu-ttz9` (platform-aware HTML5 codec gate) before the
native-player children of `prexu-ia6w`. The accepted
[macOS ADR](adr-native-player-macos.md) describes intended native opt-in,
not current application support.

## Development invariants

- Keep the vendored Wry fork and Tauri's Wry dependency on the same version.
  Current fork: Wry 0.55.1; Tauri lockfile version: 2.11.5. An unpatched second Wry
  version can compile successfully while silently breaking composition hosting.
- Linux webview transparency must be requested at creation. The toplevel stays
  opaque; the webview widget composites transparently over video.
- Do not force `WEBKIT_DISABLE_DMABUF_RENDERER=1` for normal native playback:
  it breaks transparent compositing on the tested stack.
- Keep GTK/GL work on the main thread; GTK signal panics abort the process.
  Preserve the webview's parent/grandparent structure required by Wry resizing.
- Treat mpv's GL state as dirty after rendering; restore state before other GL work.
- Preserve synchronous audio cut with background teardown; do not put an event
  pump join back on the frontend's exit path.
- Keep `AppLayout` hidden with `visibility:hidden`, not `display:none`, during
  full playback so observer-driven grids retain their layout.

## Source map

| Area | Entry point |
| --- | --- |
| Engine selection | `src/hooks/player/engineResolution.ts` |
| Native player state | `src-tauri/src/player/mod.rs` |
| Commands | `src-tauri/src/player/commands/` |
| Events and timeline | `src-tauri/src/player/events.rs`, `timeline.rs` |
| Windows composition/rendering | `composition_host.rs`, `video_render.rs`, `angle_loader.rs` in the player directory |
| Linux compositor | `src-tauri/src/player/linux_compositor.rs` |
| Startup and diagnostic modes | `src-tauri/src/lib.rs` |
| Windows runtime staging | `src-tauri/build.rs`, [binary setup](../src-tauri/bin/README.md) |

## Picking up work

Session paused at the user's request on 2026-09-20. Resume only when requested.
Use `bd prime`, `bd ready`, and `bd show <id>` for live scope and acceptance.
Do not switch to an old release branch based on archived instructions.

Documentation refresh (`prexu-4fkl`) and relay security (`prexu-9f4s.4`) are
complete locally and closed in Beads. The security changes passed 40 relay tests,
mutation checks, clippy, production compilation, formatting and diff checks.
The user authorized committing and pushing this work after the pause. Use Git
history and remote status to verify source delivery; deployment remains pending.

The agreed pickup is **relay lifecycle `prexu-9f4s.5`**, followed by **client
lifecycle `prexu-9f4s.3`**, continuing the `prexu-9f4s` review-remediation epic.
Other remaining children cover startup robustness (`prexu-9f4s.8`) and player
teardown (`prexu-9f4s.7`); their relative order has not been selected. The native
visual harness (`prexu-vbb2`, driver `prexu-331f` first) remains a later testing
investment, not the immediate next task. Beads owns live status and dependencies.

The documentation refresh and relay fixes were prepared on `main`.
Preserve the pre-existing libmpv lifetime edits in
`src-tauri/vendor/libmpv2/src/mpv/events.rs` and `protocol.rs`, plus local
`PLAN.md` and `opencode.json`; they were not part of this work. Inspect the diff
before making further changes. The current commit/push authorization covers
this completed work; future work still follows the conservative repository policy.

Before deploying the relay, configure `--public-url ws(s)://host[:port]/ws`;
without it, invitations are disabled. See [relay setup](remote-access-setup.md).
This handoff is not a deployment instruction.
