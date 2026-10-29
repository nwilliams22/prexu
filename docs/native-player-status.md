# Native player — current implementation status

Audited 2026-09-20 against local `main` at `dfe5d8c` and the local Beads database.
This describes source implementation, not a fresh hardware certification.
Application metadata was prepared for 0.8.0, which was tagged on 2026-09-28 but
never published, and **0.8.1 was released on 2026-10-27** — in both cases with GPU,
audio and display-transition acceptance explicitly **not performed**; see the
changelog's *Known untested on Windows* section. Approval to ship is not evidence
of correctness; treat those paths as unverified. Linux support is experimental in
0.8.1: it is the first release since 0.7.1 to publish AppImage/rpm bundles, and
those bundles link system libmpv without provisioning it (`prexu-axj4.7`).

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
workflow installs `libmpv-dev` so the Linux target links (`-lmpv`); before that
was added, the 0.8.0 Linux release build failed at link time (`BAD-282`). That
covers build-time linking only — it is **not** runtime provisioning: the Linux
bundle config selects AppImage/rpm but has no explicit rpm libmpv dependency,
and the release runner's libmpv is API 1.x. Self-contained AppImage operation
and LGPL build provenance remain acceptance work under `axj4.7`. The 0.8.1
release publishes those bundles anyway, labelled experimental in the changelog
and in the release notes: no Linux release artifact has been installed or
launched from a published release.

Known follow-ups include Windows IME (`prexu-x2bt`) and fullscreen transition
verification (`prexu-6p8k`), Linux packaged/dist black-webview investigation
(`prexu-p020`), and WebKitGTK large-resize presentation lag (`prexu-41cw`,
`prexu-v6pr`). The latter reproduces without the app compositor; further work
is presentation-layer profiling and an upstream evidence report.

macOS sequencing is `prexu-ttz9` (platform-aware HTML5 codec gate) before the
native-player children of `prexu-ia6w`. The accepted
[macOS ADR](adr-native-player-macos.md) describes intended native opt-in,
not current application support.

The manual [Windows candidate workflow](windows-candidate.md) prepares NSIS/MSI
artifacts without publishing a release. Candidate run `36384566080` succeeded;
unattended acceptance run `36390510490` passed NSIS/MSI installation, frontend
readiness, upgrade/settings retention and uninstall. Negative run `36390513402`
failed both formats for a deliberately removed runtime DLL. See the candidate
guide for exact revisions and evidence. These checks (`prexu-vbb2.5`) do not
satisfy GPU/audio, authenticated media or updater acceptance (`prexu-0828`).

Those unsatisfied checks were **waived for the 0.8.x releases, not completed**. A
hosted runner has no graphics card and no audio device, so visible video output,
audible playback and window/DPI/fullscreen transitions could not be proven there;
the owner chose on 2026-09-28 to ship with the gap documented and re-affirmed that
for the published 0.8.1 release on 2026-10-27. The acceptance runs named above
were executed against candidate `707e865` and were not re-run against the 0.8.1
tree. Verification still needs a Windows machine with working GPU acceleration
(`prexu-0828`, `prexu-6p8k`, `prexu-wiyy`) or the automated composed-screen route
(`prexu-vbb2.4`, `prexu-vbb2.6`). Do not cite a 0.8.x release as evidence that
native Windows rendering works.

## Development invariants

- Keep the vendored Wry fork and Tauri's Wry dependency on the same version.
  Current fork: Wry 0.57.1; Tauri lockfile version: 2.12.5. An unpatched second Wry
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

## Framework updater compatibility

The desktop lockfile resolves Tauri 2.12.5, updater 2.14.1 and zip 9.1.3.
The Wry 0.57.1 fork retains Windows composition hosting and Linux creation-time
transparency. Windows bindings match Wry: windows 0.62 and webview2-com 0.39.
The updater requires Rust 1.90 or newer; archive support remains enabled.

Run `python3 scripts/check-updater-compatibility.py` (Windows: `python`). It
copies the resolved updater source into a temporary directory, verifies matching
framework/archive/signature versions, and runs its signature and payload tests.
Linux tests cover raw and tar.gz AppImage replacement in temporary directories;
Windows probes cover raw EXE/MSI and ZIP extraction without launching installers.
The harness also rejects duplicate Wry versions or bypassing the local fork.
Both native CI jobs run this check. It does not prove installed-app upgrading,
GPU composition, audio, or display transitions on physical hardware.

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

The documentation refresh and relay fixes were prepared on `main`. The libmpv
lifetime edits in `src-tauri/vendor/libmpv2/src/mpv/events.rs` and `protocol.rs`
are now committed: they apply rustc 1.94.1's own `mismatched_lifetime_syntaxes`
suggestion, and `cargo check -p libmpv2` reports 0 warnings with them and 2
without. Local `PLAN.md` and `opencode.json` remain untracked by choice and are
not part of any work here. Inspect the diff before making further changes;
future work still follows the conservative repository policy.

Before deploying the relay, configure `--public-url ws(s)://host[:port]/ws`;
without it, invitations are disabled. See [relay setup](remote-access-setup.md).
This handoff is not a deployment instruction.
